"""E7 factual grounding. No labels, anomaly thresholds, or predictive models.

The validator checks whether a claim references actual observed readings and
whether simple numerical comparisons are true. It does NOT judge fault status.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utc_stamp(value: str | datetime) -> str:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class EvidenceLedger:
    """Maps citation IDs to actual causal measurements, deduplicated by sensor and time."""

    def __init__(self, origin: str):
        self.origin = utc_stamp(origin)
        self.entries: dict[str, dict[str, Any]] = {}
        self._by_key: dict[tuple[str, str], str] = {}

    def add(self, sensor_id: str, timestamp: str, value: float, *, source: str) -> str:
        ts = utc_stamp(timestamp)
        if ts > self.origin:
            raise ValueError("E7 blocked a future observation")
        key = (str(sensor_id), ts)
        if key in self._by_key:
            return self._by_key[key]
        import math
        nval = float(value)
        if not math.isfinite(nval):
            raise ValueError("Non-finite observed measurement")
        ref = f"OBS{len(self.entries)+1:04d}"
        self.entries[ref] = {
            "id": ref, "sensor_id": str(sensor_id), "timestamp": ts,
            "value": round(nval, 6), "source": source,
        }
        self._by_key[key] = ref
        return ref

    def add_rows(self, sensor_id: str, rows: list[dict], *, source: str) -> list[dict]:
        out = []
        for row in rows:
            ref = self.add(sensor_id, row["timestamp"], row["value"], source=source)
            out.append(self.entries[ref].copy())
        return out

    def entries_for(self, ids: list[str]) -> list[dict]:
        return [self.entries[k].copy() for k in ids if k in self.entries]


def validate_comparison(c: dict, ledger: EvidenceLedger) -> dict:
    left_id, right_id = c.get("left_id"), c.get("right_id")
    relation = c.get("relation")
    if left_id not in ledger.entries or right_id not in ledger.entries:
        return {"valid": False, "reason": "unrecognized_evidence_id", "claim": c}
    a, b = ledger.entries[left_id], ledger.entries[right_id]
    if a["sensor_id"] != b["sensor_id"]:
        return {"valid": False, "reason": "different_sensor_units", "claim": c}
    x, y = a["value"], b["value"]
    if relation == "higher_than":
        truth = x > y
    elif relation == "lower_than":
        truth = x < y
    elif relation == "equal_to":
        truth = x == y
    elif relation == "rose_since":
        truth = a["timestamp"] > b["timestamp"] and x > y
    elif relation == "fell_since":
        truth = a["timestamp"] > b["timestamp"] and x < y
    else:
        return {"valid": False, "reason": "unknown_relation", "claim": c}
    return {
        "valid": bool(truth),
        "reason": "validated" if truth else "numeric_or_temporal_contradiction",
        "claim": c, "left": a.copy(), "right": b.copy(),
        "difference_left_minus_right": round(x - y, 6),
    }


def validate_verification(verification: dict, ledger: EvidenceLedger,
                          sensor_id: str) -> dict:
    """Grounding check, not a fault classifier.

    A positive verified status requires a cited target/recent observation and
    at least one valid, factual comparison of that sensor. A normal decision
    needs a cited current observation. All invalid citations are preserved in
    diagnostics. Screening is NEVER altered by this function.
    """
    proposed = verification.get("status", "unknown")
    ids = verification.get("evidence_ids", []) or []
    claims = verification.get("comparisons", []) or []
    valid_ids = [e for e in ids if e in ledger.entries]
    invalid_ids = [e for e in ids if e not in ledger.entries]
    comparison_checks = [validate_comparison(c, ledger) for c in claims]
    bad_comparisons = [c for c in comparison_checks if not c["valid"]]
    current_cited = any(
        ledger.entries[e]["sensor_id"] == sensor_id
        and ledger.entries[e]["timestamp"] == ledger.origin
        for e in valid_ids
    )
    target_cited = any(
        ledger.entries[e]["sensor_id"] == sensor_id
        and ledger.entries[e]["source"] in ("recent", "trajectory", "historical_trajectory")
        for e in valid_ids
    )
    comparison_grounded = any(
        c["valid"] and c["claim"]["left_id"] in valid_ids
        and c["claim"]["right_id"] in valid_ids
        and c["left"]["sensor_id"] == sensor_id
        for c in comparison_checks
    )
    if invalid_ids:
        evidence_status = "invalid_citation"
    elif bad_comparisons:
        evidence_status = "invalid_numeric_comparison"
    elif proposed == "unknown":
        evidence_status = "insufficient"
    elif not current_cited:
        evidence_status = "insufficient"
    elif proposed in ("suspect", "anomaly") and (not target_cited or not comparison_grounded):
        evidence_status = "insufficient"
    else:
        evidence_status = "grounded"

    return {
        "proposed_status": proposed,
        "verified_status": proposed if evidence_status == "grounded" else "unknown",
        "evidence_status": evidence_status,
        "valid_evidence_ids": valid_ids,
        "invalid_evidence_ids": invalid_ids,
        "current_observation_cited": current_cited,
        "validated_comparisons": comparison_checks,
        "grounded_observations": ledger.entries_for(valid_ids),
        "note": (
            "Grounded means the citations and structured numerical claims match historical measurements; "
            "it does not establish that an anomaly classification is correct."
        ),
    }
