"""E8-A: evidence-grounding repair experiment; E7 is preserved unchanged.

Stage 1: LLM screening (retained verbatim)
Stage 2: mandatory causal trajectory evidence + LLM-selected optional tools
Stage 3: independent LLM evidence review + deterministic citation/numeric validation

The verified channel may abstain, but NEVER replaces the screening channel.
No labels, future observations, or trained anomaly models are consulted.
"""
from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END

from .schemas import AnomalyAnswer
from .e7_tools import make_recent, historical_trajectory, adaptive_tool_evidence
from .e7_validation import EvidenceLedger, utc_stamp
from .e8a_evidence import evidence_packet, verify_with_repair


class E7Plan(BaseModel):
    action: Literal["reference", "related", "summary", "seasonal", "similar", "context", "finish"]
    reason: str
    lookback_days: int = Field(default=30, ge=1, le=90)


class E7Comparison(BaseModel):
    left_id: str
    right_id: str
    relation: Literal["higher_than", "lower_than", "equal_to", "rose_since", "fell_since"]


class E7Verification(BaseModel):
    status: Literal["normal", "suspect", "anomaly", "unknown"]
    evidence_ids: list[str] = Field(default_factory=list)
    comparisons: list[E7Comparison] = Field(default_factory=list)
    explanation: str


class E7AgentState(TypedDict, total=False):
    evidence: list[dict[str, Any]]
    trace: list[dict[str, Any]]
    plan: dict[str, Any]
    rounds: int
    verification: dict[str, Any]
    validation: dict[str, Any]
    review_audit: dict[str, Any]


SCREEN_SYSTEM = """You are the INITIAL SCREENING LLM for a 5-minute building sensor.
Classify the current reading, not historical timestamps.
Consider isolated changes, slow drift, level shifts, persistent faults, and subtle
trajectory changes. A value within a broad historical range does not automatically
mean normal. A rising trajectory is not automatically a fault either.
Use only observed data. Do not invent causes or ground-truth labels.
Return status normal, suspect, anomaly, or unknown. Include recent timestamps in
evidence_timestamps if possible, but do not refuse to flag a potential fault only
because your citation formatting is uncertain. This screening output is retained.
Return schema-conforming JSON only."""

PLAN_SYSTEM = """You are the RETRIEVAL PLANNER, not the anomaly classifier.
A causal multiscale trajectory comparison has ALREADY been retrieved. You may
retrieve ONE optional tool per round:
- reference: prior same-weekday and clock-time sensor levels
- related: other room/zone sensors (different sensors may have different units)
- summary: long-term descriptive statistics
- seasonal: historical nearby windows at comparable dates
- similar: historically similar numerical shapes
- context: available sensor and room metadata (may be empty)
- finish: sufficient evidence for an independent evidence review
Choose additional evidence based on the current screening uncertainty and gaps.
Do not repeatedly retrieve the same tool. Do not request labels or future data.
Do not describe 'related' as a shape similarity tool. JSON only."""



def _dump_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))


def _compact_recent(recent: dict) -> dict:
    rows = recent.get("readings", [])
    # Include 3-hour endpoint and the 13 most recent points; the full recent
    # window was already given to the screening LLM.
    return {"tool": "recent", "current": recent.get("current"),
            "first_3h": rows[0] if rows else None,
            "last_13": rows[-13:]}


def _initial_prompt(retriever, recent: dict) -> str:
    return (
        f"TARGET={retriever.sensor_id} AS_OF={recent['as_of']} "
        "INTERVAL=5 minutes.\n"
        "CLASSIFY ONLY THIS TARGET observation and its trajectory.\n"
        "CAUSAL RECENT SENSOR READINGS (each has an observed ID):\n"
        + _dump_json(recent)
    )


def _planning_prompt(retriever, screening: dict, state: E7AgentState) -> str:
    return (
        f"TARGET={retriever.sensor_id} AS_OF={state['evidence'][0].get('as_of')}\n"
        f"INITIAL SCREENING (not ground truth): {_dump_json(screening)}\n"
        f"USED TOOLS: {_dump_json([t.get('tool') for t in state.get('trace', [])])}\n"
        f"CURRENT EVIDENCE: {_dump_json(state['evidence'])}\n"
        "Select the next useful tool or finish."
    )




def run_e8a_detection(retriever, llm, max_rounds: int = 2,
                      screening_override: dict | None = None) -> dict:
    """Runs the separate E8-A variant using the existing E7 retrieval pipeline.

    The `answer` key intentionally equals SCREENING for backward-compatible
    inference JSONL. Run `python -m src.e7_export` to independently evaluate
    both screening and verified decision channels.
    """
    budget = max(0, min(3, int(max_rounds)))
    ledger = EvidenceLedger(retriever.as_of)
    recent = make_recent(retriever, ledger, hours=3)
    if recent["current"] is None:
        empty = AnomalyAnswer(
            status="unknown", anomaly_type="missing_current_observation",
            confidence=0.0, evidence_timestamps=[],
            explanation="No sensor observation exists at the requested as-of timestamp.",
        ).model_dump()
        return {"answer": empty, "screening": empty, "screening_status": "unknown",
                "verified_status": "unknown", "verification": {"status": "unknown"},
                "evidence_status": "insufficient", "validation": {"error": "missing_current"},
                "trace": [], "evidence_count": 0}

    # Stage 1: independent recall-oriented screening. Keep its raw decision.
    if screening_override is None:
        screening = llm.ask(SCREEN_SYSTEM, _initial_prompt(retriever, recent),
                            AnomalyAnswer).model_dump()
        screening_source = "llm_generated"
    else:
        screening = AnomalyAnswer.model_validate(screening_override).model_dump()
        if any(utc_stamp(ts) > ledger.origin for ts in screening.get("evidence_timestamps", [])):
            raise ValueError("Cached E7 screening references a future observation")
        screening_source = "cached_E7_screening"

    # Stage 2: mandatory observed trajectory representation, then LLM-controlled
    # retrieval decisions. This tool does not classify any fault.
    try:
        trajectory = historical_trajectory(retriever, ledger)
    except Exception as exc:
        trajectory = {"tool": "trajectory", "error": f"{type(exc).__name__}: {exc}"}
    evidence = [trajectory]
    trace = [{"tool": "trajectory", "source": "mandatory_E7", "reason":
              "Current and historical trajectory changes before optional retrieval"}]

    def plan(state):
        if state.get("rounds", 0) >= budget:
            return {"plan": {"tool": "finish", "reason": "retrieval budget exhausted"}}
        used = {x.get("tool") for x in state.get("trace", [])}
        try:
            p = llm.ask(PLAN_SYSTEM, _planning_prompt(retriever, screening, state), E7Plan)
            action = p.action
            if action in used:
                action = "finish"
            return {"plan": {"tool": action, "reason": p.reason,
                             "lookback_days": p.lookback_days}}
        except Exception as exc:
            return {"plan": {"tool": "finish", "reason":
                             f"Planner error: {type(exc).__name__}: {exc}"}}

    def route(state):
        return "verify" if state["plan"]["tool"] == "finish" else "retrieve"

    def retrieve(state):
        p = state["plan"]
        try:
            ev = adaptive_tool_evidence(retriever, ledger, p["tool"],
                                        lookback_days=p.get("lookback_days", 30))
        except Exception as exc:
            ev = {"tool": p["tool"], "error": f"{type(exc).__name__}: {exc}"}
        return {
            "evidence": state["evidence"] + [ev],
            "trace": state["trace"] + [{"tool": p["tool"], "source": "LLM_planned",
                                       "reason": p.get("reason", "")}],
            "rounds": state["rounds"] + 1,
        }

    def verify(state):
        # E8-A keeps the same retrieval/planner, but supplies deterministic
        # numeric comparisons and one controlled grounding correction attempt.
        try:
            packet = evidence_packet(retriever, recent, trajectory,
                                     state.get("evidence", []), ledger)
            proposal, validation, audit = verify_with_repair(
                llm, E7Verification, screening, packet, ledger, retriever.sensor_id)
            return {"verification": proposal, "validation": validation,
                    "review_audit": audit}
        except Exception as exc:
            return {
                "verification": {"status": "unknown", "evidence_ids": [],
                                 "comparisons": [],
                                 "explanation": "Evidence review failed; original screening retained."},
                "validation": {"verified_status": "unknown",
                               "evidence_status": "verification_error",
                               "error": f"{type(exc).__name__}: {exc}"},
                "review_audit": {"attempts": 0, "repair_attempted": False},
            }

    graph = StateGraph(E7AgentState)
    graph.add_node("plan", plan)
    graph.add_node("retrieve", retrieve)
    graph.add_node("verify", verify)
    graph.add_edge(START, "plan")
    graph.add_conditional_edges("plan", route, {"retrieve": "retrieve", "verify": "verify"})
    graph.add_edge("retrieve", "plan")
    graph.add_edge("verify", END)
    try:
        state = graph.compile().invoke(
            {"evidence": evidence, "trace": trace, "rounds": 0},
            config={"recursion_limit": 12 + 2 * budget},
        )
    except Exception as exc:
        state = {
            "evidence": evidence, "trace": trace,
            "verification": {"status": "unknown", "evidence_ids": [], "comparisons": [],
                             "explanation": "Agent graph failed; screening retained."},
            "validation": {"verified_status": "unknown", "evidence_status": "verification_error",
                           "error": f"{type(exc).__name__}: {exc}"},
        }
    validation = state["validation"]
    return {
        "answer": screening,  # backward-compatible AND intentionally not verified
        "screening": screening,
        "screening_status": screening["status"],
        "screening_source": screening_source,
        "verification": state["verification"],
        "verified_status": validation.get("verified_status", "unknown"),
        "evidence_status": validation.get("evidence_status", "verification_error"),
        "validation": validation,
        "review_audit": state.get("review_audit", {}),
        "trace": state.get("trace", trace),
        "evidence_count": len(state.get("evidence", evidence)),
        "trajectory": trajectory,
        "current_observation": recent["current"],
        "note": "E8-A variant: answer is screening; use e8a_export for verified channel.",
    }
