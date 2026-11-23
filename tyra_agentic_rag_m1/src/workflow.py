"""Real LangGraph StateGraph: LLM planning -> dynamic tool -> LLM planning -> answer.

Compare the SAME underlying LLM with no retrieval, fixed RAG, and Agentic RAG.
"""
from __future__ import annotations
import json
from typing import TypedDict, Any
from langgraph.graph import StateGraph, START, END
from .config import SETTINGS
from .schemas import AnomalyAnswer, ForecastAnswer, RetrievalPlan
from .retrieval import TemporalRetriever
from .db import stamp, valid_timestamp

BASE_SYSTEM = """You analyze 5-minute building sensor time series.
The TASK is to classify the observation at the CURRENT as-of timestamp,
not to label the historical reference periods. Historical variation by itself
is not evidence that the current observation is anomalous.
Use the current reading, its trajectory, and comparable historical/operating
observations. To classify suspect/anomaly, give a concrete current discrepancy
and at least one valid recent evidence timestamp in evidence_timestamps.
Historical averages alone do not prove measurement errors or equipment faults.
Normal requires supporting observations; unknown means evidence is insufficient.
Never invent measurements, external operating conditions, or ground-truth labels.
For forecasts, output exactly H finite numerical values; never use future data.
Return JSON conforming to the response schema only."""

PLANNER_SYSTEM = """You plan temporal retrieval for a 5-minute building sensor.
Select ONE useful retrieval tool at a time or finish. Tools:
- reference: same-weekday/same-clock historical comparator, current vs past
- recent: raw observations for 1 to 6 hours
- summary: aggregated statistics for longer drift investigation
- seasonal: earlier comparable windows
- similar: numerical analogue sequences, with past continuations for forecasts
- related: other sensors in the same room/zone, NOT pattern similarity
- context: sensor metadata
For current anomaly evaluation, prefer reference to unrelated daily mean changes.
Do not treat unrelated historical daily fluctuation as a current fault.
Do not repeat tools. Never request ground truth or inaccessible future values.
Choose the next useful tool; finish when evidence is sufficient.
Return only a JSON object in the requested schema."""


def compact_evidence_for_detection(evidence: list[dict]) -> list[dict]:
    """Reduce distracting evidence without making anomaly decisions."""
    compact = []
    for ev in evidence:
        tool = ev.get("tool")
        if tool == "summary":
            buckets = ev.get("buckets", [])
            means = [float(b["mean"]) for b in buckets if b.get("mean") is not None]
            if means:
                import statistics
                split = max(1, len(means) // 2)
                summary = {
                    "number_of_buckets": len(means),
                    "resolution": ev.get("resolution"),
                    "days_requested": ev.get("days_requested"),
                    "min_historical_bucket_mean": round(min(means), 4),
                    "max_historical_bucket_mean": round(max(means), 4),
                    "older_half_mean": round(statistics.mean(means[:split]), 4),
                    "newer_half_mean": round(statistics.mean(means[split:]), 4)
                    if len(means) > split else None,
                }
            else:
                summary = {"number_of_buckets": 0}
            compact.append({
                "tool": "summary", "historical_aggregate": summary,
                "caution": "Background drift context ONLY; no classification of the as-of observation."
            })
        elif tool == "related":
            compact.append({"tool": "related", "zone_id": ev.get("zone_id"),
                            "related": [{"sensor_id": row.get("sensor_id"),
                                         "readings": row.get("readings", [])[-6:]}
                                        for row in ev.get("related", [])[:3]]})
        elif tool == "seasonal":
            compact.append({"tool": "seasonal",
                            "historical_periods": [
                                {"days_ago": row.get("days_ago"),
                                 "end": row.get("end"),
                                 "readings": row.get("readings", [])[-4:]}
                                for row in ev.get("historical_periods", [])[:4]]})
        elif tool == "similar":
            compact.append({"tool": "similar", "matches": ev.get("matches", [])[:3],
                            "matching_method": ev.get("matching_method")})
        else:
            compact.append(ev)
    return compact


class AgentState(TypedDict, total=False):
    evidence: list[dict[str,Any]]
    trace: list[dict[str,Any]]
    plan: dict[str,Any]
    rounds: int
    answer: dict[str,Any]


def prompt_for(task: str, sensor: str, origin: str, horizon: int, evidence: list[dict]):
    goal=(f"Detect abnormal behaviour at {origin} and provide a status and supporting evidence."
          if task=="detect" else f"Forecast exactly {horizon} next 5-minute values after {origin}.")
    target_context = ""
    if task == "detect":
        # Extract exactly the target observation from the causal, one-hour seed.
        # No labels or future measurements are used in this deterministic summary.
        seed = next((ev for ev in evidence if ev.get("tool") == "recent"), {})
        rows = seed.get("readings", [])
        current = next((row for row in rows if row.get("timestamp") == origin), None)
        if current is not None:
            target_context = (
                f"TARGET OBSERVATION: timestamp={origin}, value={current['value']}\n"
                "A historical date is relevant only if it helps explain whether "
                "THIS observation/trajectory is abnormal.\n"
            )
            if len(rows) >= 2:
                initial = rows[0]
                change = round(float(current["value"]) - float(initial["value"]), 5)
                target_context += (
                    f"OBSERVED RECENT CHANGE: from {initial['timestamp']} "
                    f"({initial['value']}) to {origin} ({current['value']}): "
                    f"delta={change} in sensor units. This difference alone "
                    "is not an anomaly threshold.\n"
                )
        else:
            target_context = (
                f"TARGET OBSERVATION: no reading exists exactly at {origin}. "
                "Do not claim that a nearby reading is the target.\n"
            )
    return (f"Task: {task}\nSensor: {sensor}\nAs-of cutoff: {origin}\n{goal}\n"
            + target_context
            + f"EVIDENCE (historical-only):\n{json.dumps(compact_evidence_for_detection(evidence) if task == 'detect' else evidence,ensure_ascii=False,default=str)}")


def run_method(task: str, method: str, retriever: TemporalRetriever, llm,
               horizon: int = 12, max_rounds: int | None = None) -> dict:
    if task not in ("detect","forecast"):
        raise ValueError("task must be detect or forecast")
    if method not in ("baseline","traditional","agentic","agentic_verify"):
        raise ValueError("method must be baseline, traditional, agentic or agentic_verify")
    budget = max(1,min(4,max_rounds or SETTINGS.max_rounds))
    origin = stamp(retriever.as_of)
    # Same compact initial context in all methods.
    seed = retriever.recent(1)
    evidence=[seed]
    trace=[]
    Schema=AnomalyAnswer if task=="detect" else ForecastAnswer

    if method == "traditional":
        for tool in ("summary","seasonal","similar"):
            ev=retriever.execute(tool,days=7)
            evidence.append(ev)
            trace.append({"tool":tool,"source":"fixed_RAG"})
    elif method.startswith("agentic"):
        # One dynamic retrieval decision per planning round. No hidden future data.
        def plan(state:AgentState):
            p = llm.ask(PLANNER_SYSTEM,
                prompt_for(task,retriever.sensor_id,origin,horizon,state["evidence"])
                + "\nAlready used tools: " + str([r['tool'] for r in state['trace']])
                + "\nChoose the NEXT useful tool, or finish.", RetrievalPlan)
            choice=p.action
            used={r['tool'] for r in state['trace']}
            if state['rounds'] == 0 and choice=='finish':
                choice='reference' if task=='detect' else 'similar'
            if choice in used:
                choice='finish'
            # Evaluation variant: require at least one relevant temporal
            # reference; related sensors alone do not establish historic normality.
            if (task == 'detect' and 'reference' not in used
                    and state['rounds'] < budget
                    and (choice == 'finish' or state['rounds'] == budget - 1)):
                choice = 'reference'
            if state['rounds']>=budget:
                choice='finish'
            reason=p.reason
            if choice=='reference' and p.action!=choice:
                reason=('Current-reference safeguard: compare CURRENT sensor with same-weekday/time historical readings; planner originally chose ' + p.action)
            return {"plan":{"tool":choice,"hours":p.lookback_hours,
                            "days":p.lookback_days,"reason":reason}}

        def route(state:AgentState):
            return "answer" if state["plan"]["tool"]=="finish" else "retrieve"

        def retrieve(state:AgentState):
            p=state["plan"]
            try:
                result=retriever.execute(p["tool"],hours=p["hours"],days=p["days"])
            except (ValueError,TypeError) as e:
                result={"tool":p["tool"],"error":str(e)}
            return {"evidence":state["evidence"]+[result],
                    "trace":state["trace"]+[{"tool":p["tool"],"reason":p["reason"]}],
                    "rounds":state["rounds"]+1}

        def answer(state:AgentState):
            a=llm.ask(BASE_SYSTEM,
                prompt_for(task,retriever.sensor_id,origin,horizon,state["evidence"]),Schema)
            return {"answer":a.model_dump()}

        graph=StateGraph(AgentState)
        graph.add_node("plan",plan)
        graph.add_node("retrieve",retrieve)
        graph.add_node("answer",answer)
        graph.add_edge(START,"plan")
        graph.add_conditional_edges("plan",route,{"retrieve":"retrieve","answer":"answer"})
        graph.add_edge("retrieve","plan")
        graph.add_edge("answer",END)
        result=graph.compile().invoke({"evidence":evidence,"trace":[],"rounds":0},
                                       config={"recursion_limit":16})
        evidence=result["evidence"]
        trace=result["trace"]
        final=result["answer"]
        if method=="agentic_verify":
            # An independent LLM verification using only the same historical evidence.
            final=llm.ask(BASE_SYSTEM + "\nSecond-pass evidence check. Be conservative about unsupported explanations.",
                          prompt_for(task,retriever.sensor_id,origin,horizon,evidence)
                          +"\nFirst-pass answer: "+json.dumps(final),Schema).model_dump()
    else:
        final=llm.ask(BASE_SYSTEM,
                      prompt_for(task,retriever.sensor_id,origin,horizon,evidence),Schema).model_dump()
    if method=="traditional":
        final=llm.ask(BASE_SYSTEM,
                      prompt_for(task,retriever.sensor_id,origin,horizon,evidence),Schema).model_dump()
    validation = {}
    if task == "detect" and method.startswith("agentic"):
        # Check whether claimed positive evidence truly includes an observed recent time.
        # This is evidence validation, NOT an algorithmic anomaly detector.
        recent_times = {row["timestamp"] for row in seed.get("readings", [])}
        def supported_positive(ans: dict) -> bool:
            if ans.get("status") not in ("suspect", "anomaly"):
                return True
            for ts in ans.get("evidence_timestamps", []):
                try:
                    if stamp(valid_timestamp(ts)) in recent_times:
                        return True
                except (ValueError, TypeError):
                    continue
            return False

        original_status = final.get("status")
        if not supported_positive(final):
            # Reconsider using only compact causal evidence; no labels are shown.
            repair = (prompt_for(task, retriever.sensor_id, origin, horizon, evidence)
                      + "\nYOUR PREVIOUS CLASSIFICATION WAS UNSUPPORTED: "
                      + json.dumps(final, ensure_ascii=False)
                      + "\nThe proposed positive alert had no supporting timestamp "
                        "from the target's recent observations. Reassess the CURRENT "
                        "timestamp, not unrelated historical dates. Return normal only "
                        "if evidence supports it; suspect/anomaly require real recent "
                        "evidence_timestamps AND an explained current discrepancy; "
                        "otherwise use unknown. Do not invent evidence.")
            final = llm.ask(BASE_SYSTEM, repair, AnomalyAnswer).model_dump()
            validation["evidence_recheck_performed"] = True
        if not supported_positive(final):
            final = {
                "status": "unknown", "anomaly_type": "unsupported_evidence",
                "confidence": 0.0, "evidence_timestamps": [],
                "explanation": (
                    "An LLM positive alert was not supported by any valid timestamp "
                    "in the target's recent observed history; abstaining."
                ),
            }
            validation["evidence_guard_abstained"] = True
        validation["original_first_pass_status"] = original_status
        validation["final_alert_has_observed_recent_timestamp"] = (
            supported_positive(final) if final.get("status") in ("suspect", "anomaly") else None
        )
    if task=="forecast" and len(final["values"])!=horizon:
        raise ValueError(f"Forecast returned {len(final['values'])} steps; expected {horizon}")
    return {"answer":final,"trace":trace,"evidence_count":len(evidence),
            "retrieved_reference": next((ev for ev in reversed(evidence)
                                         if ev.get("tool") == "reference"), None),
            "validation":validation}
