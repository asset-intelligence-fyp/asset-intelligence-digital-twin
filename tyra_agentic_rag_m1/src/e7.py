"""E7: dual-output, agentic temporal evidence detection using the existing local LLM.

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
from .e7_validation import EvidenceLedger, validate_verification


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

VERIFY_SYSTEM = """You are the SECOND LLM evidence reviewer for a CURRENT observation.
You must independently review the original screening decision and the retrieved
sensor evidence. Return a proposed normal/suspect/anomaly/unknown status.
CITE observed sensor values using the provided OBS#### evidence IDs, including
the CURRENT id. For suspect/anomaly, provide at least one true numeric comparison
of two cited readings from the TARGET sensor. Allowed relation syntax:
- rose_since: left is later in time and numerically higher than right
- fell_since: left is later and lower than right
- higher_than: left value is greater than right
- lower_than: left value is less than right
- equal_to: values equal
The program will verify citations and numerical relationships against the database.
Use readings that actually exist. Do not invent numbers, dates, HVAC conditions, or
statistical significance. Prior-day differences alone do not establish a current fault.
Do not treat a missing citation as proof that the original screening was normal.
Uncertainty is allowed; it will be recorded only in the VERIFIED channel.
The SCREENING channel will never be overwritten. JSON only."""


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


def _verification_prompt(retriever, screening: dict, state: E7AgentState,
                         recent: dict, ledger: EvidenceLedger) -> str:
    current = recent.get("current")
    return (
        f"TARGET SENSOR: {retriever.sensor_id}\n"
        f"CURRENT AS_OF: {ledger.origin}\n"
        f"CURRENT EVIDENCE ID: {current['id'] if current else 'MISSING'}\n"
        f"SCREENING CLASSIFICATION (do not overwrite): {_dump_json(screening)}\n"
        f"RECENT OBSERVED EVIDENCE: {_dump_json(_compact_recent(recent))}\n"
        f"RETRIEVED CAUSAL EVIDENCE: {_dump_json(state.get('evidence', []))}\n"
        "Use the cited OBS IDs. For positive alerts, cite current and supporting "
        "readings, and one factually true comparison. Do not invent readings."
    )


def run_e7_detection(retriever, llm, max_rounds: int = 2) -> dict:
    """Runs E7; compatible with src.cli.batch and its existing E6 retriever.

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
    screening = llm.ask(SCREEN_SYSTEM, _initial_prompt(retriever, recent),
                        AnomalyAnswer).model_dump()

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
        # Stage 3: review in its OWN channel. Failure cannot destroy screening.
        try:
            proposal = llm.ask(
                VERIFY_SYSTEM,
                _verification_prompt(retriever, screening, state, recent, ledger),
                E7Verification,
            ).model_dump()
            validation = validate_verification(proposal, ledger, retriever.sensor_id)
            return {"verification": proposal, "validation": validation}
        except Exception as exc:
            return {
                "verification": {"status": "unknown", "evidence_ids": [],
                                 "comparisons": [],
                                 "explanation": "Verification call failed; screening retained."},
                "validation": {
                    "verified_status": "unknown", "evidence_status": "verification_error",
                    "error": f"{type(exc).__name__}: {exc}",
                },
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
        "verification": state["verification"],
        "verified_status": validation.get("verified_status", "unknown"),
        "evidence_status": validation.get("evidence_status", "verification_error"),
        "validation": validation,
        "trace": state.get("trace", trace),
        "evidence_count": 1 + len(state.get("evidence", evidence)),
        "trajectory": trajectory,
        "current_observation": recent["current"],
        "note": "answer is screening; use e7_export to evaluate verified channel separately.",
    }
