"""E7.1 factual evidence ledger and independent quality checking.

No anomaly thresholds, labels, statistical classifiers or LLM-generated arithmetic.
Evidence quality describes factual support, NOT the truth of a fault diagnosis.
"""
from __future__ import annotations

from typing import Any


def build_facts(recent: dict, trajectory: dict, operational: dict) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    def add(kind: str, detail: dict, ids: list[str] | None = None) -> None:
        result.append({"id": f"F{len(result)+1:03d}", "kind": kind,
                       "detail": detail, "observed_ids": ids or []})

    current = recent.get("current")
    if current:
        add("current_observation", {"timestamp": current["timestamp"],
                                    "value": current["value"], "sensor_id": current["sensor_id"]},
            [current["id"]])
    for window in ("1h", "3h", "6h", "24h"):
        entry = (trajectory.get("current_changes") or {}).get(window)
        if entry and entry.get("from_id") and entry.get("to_id"):
            add("observed_change", {"window": window, "delta": entry["delta"],
                                    "from_id": entry["from_id"], "to_id": entry["to_id"]},
                [entry["from_id"], entry["to_id"]])
            ref = (trajectory.get("historical_change_reference") or {}).get(window) or {}
            if ref.get("n", 0) and ref.get("median") is not None:
                add("historical_change_reference", {"window": window, "history_n": ref.get("n"),
                    "historical_median": ref["median"], "historical_p10": ref.get("p10"),
                    "historical_p90": ref.get("p90"), "observed_delta": entry["delta"],
                    "delta_minus_reference_median": round(entry["delta"]-ref["median"], 5)},
                    [entry["from_id"], entry["to_id"]])
    for observation in operational.get("observations", [])[:12]:
        add("operational_context", {
            "context_id": observation["id"], "kind": observation["kind"],
            "timestamp": observation["timestamp"], "attribute": observation["attribute"],
            "value": observation["value"], "zone": observation["zone"],
            "source": observation["source"]}, [])
    return result


def check_review(proposal: dict, facts: list[dict], current: dict | None,
                 ledger=None) -> dict[str, Any]:
    """Factual integrity check; never changes the LLM's review status.

    `supported_status` is an optional STRICT reporting channel; 'unknown' if the
    source citations are incomplete. The primary review is never overwritten.
    """
    known = {f["id"]: f for f in facts}
    chosen = list(dict.fromkeys(proposal.get("fact_ids") or []))
    invalid = [x for x in chosen if x not in known]
    cited = [known[x] for x in chosen if x in known]
    evidence_ids = list(dict.fromkeys(proposal.get("evidence_ids") or []))
    valid_obs = [x for x in evidence_ids if ledger is not None and x in ledger.entries]
    invalid_obs = [x for x in evidence_ids if ledger is None or x not in ledger.entries]
    current_fact = any(f["kind"] == "current_observation" for f in cited)
    target_change = any(f["kind"] in ("observed_change", "historical_change_reference") for f in cited)
    proposed = proposal.get("status", "unknown")
    if invalid or invalid_obs:
        quality = "invalid_evidence_ids"
    elif proposed == "unknown":
        quality = "abstained"
    elif not current_fact:
        quality = "partial_evidence"
    elif proposed in ("suspect", "anomaly") and not target_change:
        quality = "partial_evidence"
    else:
        quality = "factual_references_valid"
    return {
        "review_status": proposed, "supported_status": proposed if quality == "factual_references_valid" else "unknown",
        "evidence_status": quality, "selected_fact_ids": chosen,
        "valid_fact_ids": [x["id"] for x in cited], "invalid_fact_ids": invalid,
        "valid_observation_ids": valid_obs, "invalid_observation_ids": invalid_obs,
        "current_fact_cited": current_fact, "change_fact_cited": target_change,
        "factual_evidence": cited,
        "note": "Factual references valid does not mean a diagnosis is correct. Review status is never overwritten.",
    }
