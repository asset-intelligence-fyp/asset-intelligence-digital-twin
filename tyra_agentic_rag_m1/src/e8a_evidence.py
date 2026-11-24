"""E8-A: compact, timestamp-safe evidence for a separate LLM verification.

All evidence comes from E7's unlabeled EvidenceLedger. This module does not
read hidden labels, make anomaly decisions, or relax numeric verification.
"""
from __future__ import annotations

import json
from typing import Any

from .e7_validation import EvidenceLedger, validate_verification

REVIEW_SYSTEM = """You are an independent evidence reviewer of the CURRENT building sensor reading.
Return JSON conforming exactly to the verification schema:
status = normal | suspect | anomaly | unknown;
evidence_ids = list of OBS IDs;
comparisons = list of {left_id,right_id,relation}; explanation = short text.
The initial screening decision is an opinion, NOT ground truth.

RULES:
1) Classify the TARGET reading at AS_OF, not an earlier reading.
2) Always cite CURRENT_ID for a normal/suspect/anomaly decision.
3) For suspect/anomaly, also cite an EARLIER reading of the SAME target sensor,
   and copy at least one factual CURRENT-VS-EARLIER comparison from
   SUGGESTED_COMPARISONS (only left_id, right_id, relation). Include BOTH IDs in evidence_ids.
4) The suggested comparisons are arithmetic facts, NOT automatic fault evidence.
   Small changes, unchanged readings, and ordinary operating variation are
   not faults by themselves. Use historical context and persistence to decide.
5) Never compare values across different sensors/units. Setpoints are NOT
   temperature measurements. Missing context is NOT evidence of normality.
6) Do not invent OBS IDs, values, timestamps, equipment states, or causes.
7) If evidence does not support a definite decision, return unknown.
The program independently validates every cited comparison. JSON only."""


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def evidence_packet(retriever, recent: dict, trajectory: dict, evidence: list[dict],
                    ledger: EvidenceLedger) -> dict:
    """Return a bounded evidence menu containing mechanically true comparisons.

    The candidate table presents CURRENT vs observed earlier readings; it
    never estimates a missing value and never adds observations to the ledger.
    """
    current = recent.get("current")
    if not current:
        raise ValueError("E8-A requires an actual current reading")
    sensor_id = str(retriever.sensor_id)
    if current["sensor_id"] != sensor_id or current["timestamp"] != ledger.origin:
        raise ValueError("Current evidence does not match target sensor/cutoff")
    latest = [r for r in recent.get("readings", [])
              if r.get("sensor_id") == sensor_id and r.get("timestamp") <= ledger.origin]
    latest = latest[-13:]
    anchors = []
    for lag in ("1h", "3h", "6h", "24h"):
        entry = (trajectory.get("current_changes") or {}).get(lag) or {}
        ref = entry.get("from_id")
        if ref in ledger.entries and ledger.entries[ref]["sensor_id"] == sensor_id:
            anchors.append({"lag": lag, **ledger.entries[ref]})

    earlier = []
    seen = {current["id"]}
    # Most recent samples plus 1/3/6/24h anchors, no duplicates.
    for row in [*list(reversed(latest[:-1]))[:7], *(a for a in anchors)]:
        ref = row.get("id")
        if ref not in ledger.entries or ref in seen:
            continue
        observed = ledger.entries[ref]
        if observed["timestamp"] >= current["timestamp"]:
            continue
        seen.add(ref)
        earlier.append(observed)
    # 12 choices is ample; 24h anchors are included after recent samples.
    earlier = earlier[:12]
    comparisons = []
    computed_differences = []
    for row in earlier:
        x, y = current["value"], row["value"]
        relation = "rose_since" if x > y else ("fell_since" if x < y else "equal_to")
        comparisons.append({
            "left_id": current["id"], "right_id": row["id"],
            "relation": relation,
        })
        computed_differences.append({"current_id": current["id"],
                                     "earlier_id": row["id"],
                                     "difference": round(x - y, 6)})
    history = trajectory.get("historical_change_reference") or {}
    history_summary = {lag: {k: stat.get(k) for k in
                         ("n", "median", "p10", "p90", "current_delta")}
                       for lag, stat in history.items() if isinstance(stat, dict)}
    options = [e for e in evidence if e.get("tool") != "trajectory"]
    return {
        "target": sensor_id,
        "as_of": ledger.origin,
        "current_id": current["id"],
        "current_observation": current,
        "recent_observations": latest[-9:],
        "earlier_observations": earlier,
        "suggested_comparisons": comparisons,
        "computed_differences": computed_differences,
        "historical_change_reference": history_summary,
        "optional_retrieval": options[:2],
        "caution": "Comparisons are descriptive facts, not anomaly labels. No future data used.",
    }


def review_prompt(screening: dict, packet: dict) -> str:
    slim_screen = {"status": screening.get("status"),
                   "explanation": str(screening.get("explanation", ""))[:300]}
    return ("INITIAL SCREENING (not truth): " + compact_json(slim_screen) + "\n"
            "CAUSAL EVIDENCE MENU: " + compact_json(packet) + "\n"
            "Return an independently reasoned decision. Cite CURRENT_ID. "
            "If alerting, copy a suggested comparison exactly.")


def validate_e8a(proposal: dict, ledger: EvidenceLedger, sensor_id: str,
                 current_id: str) -> dict:
    """E7's numeric validator plus a current-vs-earlier check for alerts."""
    result = validate_verification(proposal, ledger, sensor_id)
    status = proposal.get("status", "unknown")
    if status == "unknown":
        result["evidence_status"] = "abstained"
        result["verified_status"] = "unknown"
        result["current_comparison_grounded"] = False
        return result

    valid_ids = set(result.get("valid_evidence_ids", []))
    matched = False
    if status in ("suspect", "anomaly"):
        for c in result.get("validated_comparisons", []):
            claim = c.get("claim", {})
            right_id = claim.get("right_id")
            if (c.get("valid") and claim.get("left_id") == current_id
                    and right_id != current_id and right_id in valid_ids
                    and current_id in valid_ids and right_id in ledger.entries
                    and ledger.entries[right_id]["sensor_id"] == sensor_id
                    and ledger.entries[right_id]["timestamp"] < ledger.origin):
                matched = True
                break
        if result.get("evidence_status") == "grounded" and not matched:
            result["evidence_status"] = "missing_current_comparison"
            result["verified_status"] = "unknown"
    result["current_comparison_grounded"] = matched
    return result


def repair_prompt(proposal: dict, validation: dict, packet: dict) -> str:
    bad = [{"claim": c.get("claim"), "reason": c.get("reason")}
           for c in validation.get("validated_comparisons", []) if not c.get("valid")]
    diagnostic = {
        "failure": validation.get("evidence_status"),
        "missing_current_id": not validation.get("current_observation_cited", False),
        "invalid_evidence_ids": validation.get("invalid_evidence_ids", []),
        "invalid_comparisons": bad,
        "current_comparison_grounded": validation.get("current_comparison_grounded"),
    }
    return (
        "ONE EVIDENCE REPAIR ATTEMPT. Your prior JSON was not grounded.\n"
        "PRIOR PROPOSAL: " + compact_json(proposal) + "\n"
        "VALIDATION ERRORS: " + compact_json(diagnostic) + "\n"
        "AVAILABLE CURRENT ID: " + compact_json(packet["current_id"]) + "\n"
        "TRUE CURRENT-TO-EARLIER COMPARISONS (COPY EXACTLY): "
        + compact_json(packet["suggested_comparisons"]) + "\n"
        "Correct ONLY factual references and reasoning errors. Do not claim a "
        "fault just because a comparison exists. You may change your classification "
        "when the evidence warrants it. If no justified conclusion is possible, "
        "choose unknown. Never invent any citation or numeric fact. JSON only."
    )


def verify_with_repair(llm, schema, screening: dict, packet: dict,
                       ledger: EvidenceLedger, sensor_id: str) -> tuple[dict, dict, dict]:
    """One original review and at most one grounding-focused repair.

    Caller handles LLM/schema exceptions as an explicit abstention. An explicit
    model 'unknown' is never coerced to a decision or automatically retried.
    """
    first = llm.ask(REVIEW_SYSTEM, review_prompt(screening, packet), schema).model_dump()
    initial = validate_e8a(first, ledger, sensor_id, packet["current_id"])
    audit = {"attempts": 1, "repair_attempted": False,
             "first_proposal": first, "first_evidence_status": initial["evidence_status"]}
    if initial["evidence_status"] in {"grounded", "abstained"}:
        return first, initial, audit
    audit["repair_attempted"] = True
    audit["attempts"] = 2
    try:
        second = llm.ask(REVIEW_SYSTEM, repair_prompt(first, initial, packet), schema).model_dump()
        final = validate_e8a(second, ledger, sensor_id, packet["current_id"])
        audit["final_evidence_status"] = final["evidence_status"]
        return second, final, audit
    except Exception as exc:
        audit["repair_error"] = f"{type(exc).__name__}: {exc}"
        return first, initial, audit
