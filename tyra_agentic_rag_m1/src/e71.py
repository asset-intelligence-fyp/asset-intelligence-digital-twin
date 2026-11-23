"""E7.1: screening + true LLM-selected retrieval + operational-context review.

The normal/anomaly screen is kept verbatim. A separate review status is assessed
against factual precomputed observations; imperfect citations are audited but
never silently convert that review decision into an abstention.

No label data, future sensor observations, trained anomaly model or threshold
classifier is accessed by this module.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal, TypedDict

from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel, Field

from .e7 import SCREEN_SYSTEM, _initial_prompt
from .e7_tools import make_recent, historical_trajectory, adaptive_tool_evidence
from .e7_validation import EvidenceLedger
from .e71_context import retrieve_context, DEFAULT_DB
from .e71_facts import build_facts, check_review
from .schemas import AnomalyAnswer

OPTIONAL = ("reference", "related", "summary", "seasonal", "similar", "context", "operational_context")


class E71FirstPlan(BaseModel):
    action: Literal["reference", "related", "summary", "seasonal", "similar", "context", "operational_context"]
    reason: str = Field(min_length=1)
    lookback_days: int = Field(default=30, ge=1, le=90)


class E71LaterPlan(BaseModel):
    action: Literal["reference", "related", "summary", "seasonal", "similar", "context", "operational_context", "finish"]
    reason: str
    lookback_days: int = Field(default=30, ge=1, le=90)


class E71Review(BaseModel):
    status: Literal["normal", "suspect", "anomaly", "unknown"]
    fact_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    explanation: str


class E71State(TypedDict, total=False):
    evidence: list[dict[str, Any]]
    trace: list[dict[str, Any]]
    rounds: int
    plan: dict[str, Any]
    review: dict[str, Any]
    validation: dict[str, Any]


PLAN_SYSTEM = """You plan ADDITIONAL causal retrieval for a building Digital Twin.
The initial LLM screening is provisional. The program has already retrieved
multiscale trajectories and available HVAC/occupancy/weather context.
Choose a tool that could materially strengthen the final decision:
reference=same-weekday/time levels; related=nearby room sensors;
summary=long-term statistics; seasonal=other historical windows;
similar=past signal shapes; context=room/sensor metadata;
operational_context=latest indexed HVAC, occupancy, outdoor weather.
Choose ONE action from the schema; do not repeat tools that were already used.
The first optional tool MUST be an actual retrieval; never 'finish' immediately.
On later rounds you may finish if extra evidence is genuinely unnecessary.
Do not request future data, ground truth or fault labels. The retrieval cutoff
is enforced by the program. JSON only."""

REVIEW_SYSTEM = """You independently REVIEW the CURRENT building sensor behaviour.
Classify normal, suspect, anomaly or unknown after analyzing initial screening,
prior temporal trajectories, and any AVAILABLE operating context.
Current observation, 1h/3h/6h/24h changes, comparable historical deltas and
operating context are supplied as PRECOMPUTED FACTS with identifiers F001 etc.
You do NOT need to invent numeric comparisons: Python has computed facts.
Include a SHORT list of fact_ids from the provided FACTS, especially the current
observation and a temporal change if identifying a fault. evidence_ids (OBS####)
are optional. Do not invent identifiers, values or timestamps. A missing HVAC,
headcount or weather observation is NOT evidence that these systems were normal.
Do not claim 'statistically significant' without a test. A temperature rise
can be normal under HVAC/occupancy changes; equally, being within a broad level
range cannot by itself rule out persistent drift. Give a brief, coherent
explanation about the as-of observation, not unrelated historical days.
Your output is reviewed for factual citation quality. Incorrect/missing fact
IDs do NOT overwrite your proposed classification; they are recorded separately.
Do not treat label data as available. JSON only."""


def _compact_context(context: dict) -> dict:
    return {"available": context.get("available"), "observations": context.get("observations", [])[:12],
            "metadata": context.get("metadata", [])[:8], "warnings": context.get("warnings", [])[:3]}


def _dump(x) -> str:
    return json.dumps(x, ensure_ascii=False, default=str, separators=(",", ":"))


def _prompt_plan(retriever, screening, trajectory, context, state, first):
    return (
        f"AS_OF={state['evidence'][0].get('as_of')} TARGET={retriever.sensor_id} ZONE={retriever.zone}\n"
        f"INITIAL SCREEN={_dump({'status': screening['status'], 'explanation': screening.get('explanation','')[:350]})}\n"
        f"TRAJECTORY CHANGE REFERENCE={_dump(trajectory.get('historical_change_reference', {}))}\n"
        f"OPERATIONAL CONTEXT COVERAGE={_dump({'available': context.get('available'), 'counts': context.get('source_counts')})}\n"
        f"ALREADY RETRIEVED={_dump([x['tool'] for x in state['trace']])}\n"
        f"OPTIONAL EVIDENCE={_dump([x for x in state['evidence'][2:]][:2])[:1800]}\n"
        + ("Choose ONE additional retrieval tool, not finish." if first else "Choose a DIFFERENT additional tool, or finish.")
    )


def _prompt_review(retriever, screening, recent, trajectory, context, state, facts):
    # Keep the small local model within context; full facts and citations are
    # already present in the machine-readable record for auditing.
    compact_recent = {"current": recent["current"], "recent_last": recent["readings"][-8:],
                      "earliest_3h": recent["readings"][0] if recent["readings"] else None}
    compact_trajectory = {
        "current_changes": trajectory.get("current_changes", {}),
        "historical_change_reference": trajectory.get("historical_change_reference", {}),
        "historical_samples": trajectory.get("historical_samples")}
    optional = [e for e in state["evidence"] if e.get("tool") not in ("trajectory", "operational_context")]
    return (
        f"TARGET={retriever.sensor_id} AS_OF={recent['as_of']}\n"
        f"INITIAL SCREENING={_dump(screening)}\n"
        f"RECENT SENSOR={_dump(compact_recent)}\n"
        f"TRAJECTORY={_dump(compact_trajectory)}\n"
        f"BUILDING OPERATIONS={_dump(_compact_context(context))}\n"
        f"OPTIONAL RETRIEVAL={_dump(optional)[:2200]}\n"
        f"PRECOMPUTED FACTS (cite IDs, do not recalculate): {_dump(facts[:24])[:5400]}\n"
        "Return an independent classification, supporting fact_ids, and explanation."
    )


def run_e71_detection(retriever, llm, max_rounds: int = 2,
                       context_db: str | Path | None = None,
                       use_context: bool = True,
                       screening_override: dict | None = None) -> dict:
    """Run E7.1. Output `answer` remains original screening for CLI compatibility."""
    budget = max(0, min(3, int(max_rounds)))
    ledger = EvidenceLedger(retriever.as_of)
    recent = make_recent(retriever, ledger, hours=3)
    if not recent.get("current"):
        empty = AnomalyAnswer(status="unknown", anomaly_type="missing_current_observation",
                              confidence=0, evidence_timestamps=[],
                              explanation="No exact current sensor reading at cutoff").model_dump()
        return {"answer": empty, "screening": empty, "screening_status": "unknown",
                "review_status": "unknown", "supported_status": "unknown",
                "evidence_status": "missing_current", "validation": {}, "trace": []}

    if screening_override is None:
        screening = llm.ask(SCREEN_SYSTEM, _initial_prompt(retriever, recent), AnomalyAnswer).model_dump()
        screening_source = "llm_generated"
    else:
        screening = AnomalyAnswer.model_validate(screening_override).model_dump()
        screening_source = "cached_inference"
    try:
        trajectory = historical_trajectory(retriever, ledger)
    except Exception as exc:
        trajectory = {"tool": "trajectory", "error": f"{type(exc).__name__}: {exc}"}
    if not use_context:
        operational = {"tool": "operational_context", "as_of": ledger.origin,
                       "available": False, "observations": [], "metadata": [],
                       "source_counts": {}, "warnings": ["Context disabled by explicit E7.1 ablation"]}
    else:
        try:
            operational = retrieve_context(ledger.origin, retriever.zone, retriever.sensor_id,
                                           Path(context_db) if context_db else DEFAULT_DB)
        except Exception as exc:
            operational = {"tool": "operational_context", "as_of": ledger.origin,
                           "available": False, "observations": [], "metadata": [],
                           "source_counts": {}, "warnings": [f"Context lookup failed: {type(exc).__name__}: {exc}"]}
    facts = build_facts(recent, trajectory, operational)
    evidence = [trajectory, operational]
    trace = [{"tool": "trajectory", "source": "mandatory_E71"},
             {"tool": "operational_context", "source": "mandatory_E71",
              "available": bool(operational.get("available")),
              "source_counts": operational.get("source_counts", {})}]

    def plan(state: E71State):
        n = state.get("rounds", 0)
        if n >= budget:
            return {"plan": {"tool": "finish", "reason": "retrieval budget exhausted", "source": "budget"}}
        used = {x.get("tool") for x in state.get("trace", [])}
        first = n == 0
        schema = E71FirstPlan if first else E71LaterPlan
        try:
            result = llm.ask(PLAN_SYSTEM, _prompt_plan(retriever, screening, trajectory, operational,
                                                       state, first), schema)
            action = result.action
            if action in used:
                remaining = [x for x in OPTIONAL if x not in used]
                if first and remaining:
                    action = remaining[0]
                    src = "fallback_duplicate"
                else:
                    action = "finish"
                    src = "duplicate_skipped"
            else:
                src = "LLM_selected"
            return {"plan": {"tool": action, "source": src, "reason": result.reason,
                             "lookback_days": result.lookback_days}}
        except Exception as exc:
            if first:
                # Clearly report fallback: not misrepresented as LLM adaptivity.
                return {"plan": {"tool": "reference", "reason": str(exc)[:200],
                                 "source": "fallback_planner_error", "lookback_days": 30}}
            return {"plan": {"tool": "finish", "reason": str(exc)[:200], "source": "planner_error"}}

    def route(state: E71State):
        return "review" if state["plan"]["tool"] == "finish" else "retrieve"

    def retrieve(state: E71State):
        p = state["plan"]
        if p["tool"] == "operational_context":
            ev = operational
        else:
            try:
                ev = adaptive_tool_evidence(retriever, ledger, p["tool"],
                                           lookback_days=p.get("lookback_days", 30))
            except Exception as exc:
                ev = {"tool": p["tool"], "error": f"{type(exc).__name__}: {exc}"}
        return {"evidence": state["evidence"]+[ev],
                "trace": state["trace"] + [{"tool": p["tool"], "source": p["source"],
                                            "reason": p.get("reason", ""),
                                            "available": "error" not in ev}],
                "rounds": state.get("rounds", 0)+1}

    def review(state: E71State):
        try:
            proposal = llm.ask(REVIEW_SYSTEM, _prompt_review(retriever, screening, recent, trajectory,
                                                              operational, state, facts), E71Review).model_dump()
            checked = check_review(proposal, facts, recent.get("current"), ledger)
            return {"review": proposal, "validation": checked}
        except Exception as exc:
            return {"review": {"status": "unknown", "fact_ids": [], "evidence_ids": [],
                               "explanation": "Review failed; screening preserved"},
                    "validation": {"review_status": "unknown", "supported_status": "unknown",
                                   "evidence_status": "review_error", "error": str(exc)[:350]}}

    graph = StateGraph(E71State)
    graph.add_node("plan", plan)
    graph.add_node("retrieve", retrieve)
    graph.add_node("review", review)
    graph.add_edge(START, "plan")
    graph.add_conditional_edges("plan", route, {"retrieve": "retrieve", "review": "review"})
    graph.add_edge("retrieve", "plan")
    graph.add_edge("review", END)
    try:
        state = graph.compile().invoke({"evidence": evidence, "trace": trace, "rounds": 0},
                                       config={"recursion_limit": 12+2*budget})
    except Exception as exc:
        state = {"evidence": evidence, "trace": trace,
                 "review": {"status": "unknown", "fact_ids": [], "evidence_ids": [],
                            "explanation": "Graph failure; screening preserved"},
                 "validation": {"review_status": "unknown", "supported_status": "unknown",
                                "evidence_status": "graph_error", "error": str(exc)[:350]}}
    validation = state["validation"]
    return {
        "answer": screening, "screening": screening, "screening_status": screening["status"],
        "screening_source": screening_source,
        "review": state["review"], "review_status": validation.get("review_status", "unknown"),
        "supported_status": validation.get("supported_status", "unknown"),
        "evidence_status": validation.get("evidence_status", "review_error"),
        "validation": validation, "trace": state.get("trace", trace),
        "trajectory": trajectory, "operational_context": _compact_context(operational),
        "context_enabled": bool(use_context), "retrieval_budget": budget,
        "fact_count": len(facts), "factual_reference": facts[:24],
        "optional_retrieval_count": sum(1 for t in state.get("trace", trace)
                                        if t.get("source", "").startswith("LLM_selected")),
        "note": "answer=original screening; review=independent LLM; supported=strict evidence-quality sensitivity check. No labels read.",
    }
