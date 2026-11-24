"""E7 compact, causal trajectory and optional adaptive retrieval tools.

All measurements are drawn from the unlabeled `readings` table. The as-of
cutoff comes from TemporalRetriever (the application), never the LLM.
"""
from __future__ import annotations

from datetime import timedelta
from statistics import mean
from typing import Any

from .db import db_connect, get_series, stamp
from .e7_validation import EvidenceLedger


LAGS_HOURS = (1, 3, 6, 24)


def quantile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(float(v) for v in values)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 5)


def compact_stats(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"n": 0, "median": None, "p10": None, "p90": None}
    return {
        "n": len(values), "median": quantile(values, 0.5),
        "p10": quantile(values, 0.1), "p90": quantile(values, 0.9),
    }


def make_recent(retriever, ledger: EvidenceLedger, hours: int = 3) -> dict:
    raw = retriever.recent(hours)
    readings = ledger.add_rows(retriever.sensor_id, raw.get("readings", []), source="recent")
    current = next((r for r in reversed(readings) if r["timestamp"] == ledger.origin), None)
    return {
        "tool": "recent", "sensor_id": retriever.sensor_id,
        "as_of": ledger.origin, "current": current,
        "readings": readings,
        "warning": "Readings are original historical observations, not ground-truth labels",
    }


def historical_trajectory(retriever, ledger: EvidenceLedger,
                          weeks: int = 12) -> dict:
    """Compare exact changes with prior same-weekday and same-clock changes.

    Uses one bounded SQL query (not 12 separate full-history scans).
    Never issues anomaly decisions, and does not assume reference weeks are normal.
    """
    weeks = max(4, min(16, int(weeks)))
    origin = retriever.as_of
    anchors = [origin - timedelta(days=7 * w) for w in range(1, weeks + 1)]
    times = {origin}
    for a in [origin, *anchors]:
        times.add(a)
        times.update(a - timedelta(hours=h) for h in LAGS_HOURS)
    candidates = sorted(t for t in times if t <= origin)
    placeholders = ",".join("?" for _ in candidates)
    con = db_connect(True, retriever.db_path)
    try:
        rows = con.execute(
            f"""SELECT timestamp, value FROM readings
            WHERE sensor_id=? AND timestamp IN ({placeholders})
              AND timestamp<=? ORDER BY timestamp""",
            [retriever.sensor_id, *candidates, origin],
        ).fetchall()
    finally:
        con.close()
    observed = {t: float(value) for t, value in rows}

    def record(t, source):
        if t not in observed:
            return None
        key = ledger.add(retriever.sensor_id, stamp(t), observed[t], source=source)
        return ledger.entries[key].copy()

    cur = record(origin, "trajectory")
    current_changes = {}
    for hours in LAGS_HOURS:
        before = record(origin - timedelta(hours=hours), "trajectory")
        current_changes[f"{hours}h"] = (
            {"delta": round(cur["value"] - before["value"], 5),
             "from_id": before["id"], "to_id": cur["id"]}
            if cur and before else None
        )

    historical = []
    delta_samples = {f"{h}h": [] for h in LAGS_HOURS}
    for anchor in anchors:
        anchor_row = record(anchor, "historical_trajectory")
        if anchor_row is None:
            continue
        changes = {}
        for hours in LAGS_HOURS:
            prev_row = record(anchor - timedelta(hours=hours), "historical_trajectory")
            if prev_row is None:
                continue
            delta = round(anchor_row["value"] - prev_row["value"], 5)
            changes[f"{hours}h"] = {
                "delta": delta, "from_id": prev_row["id"], "to_id": anchor_row["id"]
            }
            delta_samples[f"{hours}h"].append(delta)
        historical.append({"anchor": anchor_row, "changes": changes})

    comparison = {
        window: {**compact_stats(values), "current_delta":
                 current_changes[window]["delta"] if current_changes[window] else None}
        for window, values in delta_samples.items()
    }
    return {
        "tool": "trajectory", "as_of": ledger.origin,
        "current": cur, "current_changes": current_changes,
        "historical_change_reference": comparison,
        "historical_samples": len(historical),
        "examples": historical[:4],  # small prompt; all 12 feed the descriptive summaries
        "caution": (
            "Historical samples can include faults or different HVAC/occupancy states. "
            "No numerical comparison is itself an anomaly classification."
        ),
    }


def adaptive_tool_evidence(retriever, ledger: EvidenceLedger, action: str,
                           *, lookback_days: int = 30) -> dict:
    """Return bounded evidence suitable for the small local model context window."""
    if action == "reference":
        ev = retriever.reference()
        histories = ledger.add_rows(retriever.sensor_id,
                                   ev.get("same_weekday_and_clock", []), source="historical_reference")
        return {"tool": action, "summary": ev.get("reference_summary"),
                "recent_trend": ev.get("recent_trend"),
                "comparison_readings": histories[:8],
                "caution": ev.get("caution")}
    if action == "related":
        ev = retriever.related()
        related = []
        for r in ev.get("related", [])[:3]:
            readings = ledger.add_rows(r["sensor_id"], r.get("readings", [])[-6:],
                                       source="related")
            related.append({"sensor_id": r["sensor_id"], "readings": readings})
        return {"tool": action, "zone_id": ev.get("zone_id"), "related": related,
                "caution": "Other sensor values may use different physical units."}
    if action == "summary":
        ev = retriever.summary(max(1, min(90, int(lookback_days))))
        buckets = ev.get("buckets", [])
        vals = [float(b["mean"]) for b in buckets if b.get("mean") is not None]
        return {"tool": action, "resolution": ev.get("resolution"),
                "days_requested": ev.get("days_requested"),
                "number_of_returned_buckets": len(buckets),
                "historical_bucket_means": compact_stats(vals),
                "older_half_mean": round(mean(vals[:len(vals)//2]), 5) if len(vals) >= 2 else None,
                "newer_half_mean": round(mean(vals[len(vals)//2:]), 5) if len(vals) >= 2 else None,
                "warning": "Aggregates describe historical context, not a current fault."}
    if action == "seasonal":
        ev = retriever.seasonal()
        periods = []
        for p in ev.get("historical_periods", [])[:4]:
            readings = ledger.add_rows(retriever.sensor_id, p.get("readings", [])[-5:],
                                       source="seasonal")
            periods.append({"days_ago": p.get("days_ago"),
                            "historical_end": p.get("end"), "readings": readings})
        return {"tool": action, "historical_periods": periods}
    if action == "similar":
        ev = retriever.similar(3)
        matches = []
        for match in ev.get("matches", [])[:2]:
            # Match arrays are 5-minute readings ending at the historical_end.
            from .db import valid_timestamp
            end = valid_timestamp(match["historical_end"])
            values = match.get("values", [])
            rows = [{"timestamp": stamp(end - timedelta(minutes=5*(len(values)-1-i))),
                     "value": v} for i, v in enumerate(values)]
            readings = ledger.add_rows(retriever.sensor_id, rows[-5:], source="similar")
            matches.append({"historical_end": match["historical_end"],
                            "distance": match.get("distance"), "readings": readings})
        return {"tool": action, "matching_method": ev.get("matching_method"),
                "matches": matches}
    if action == "context":
        ev = retriever.context()
        return {"tool": action, "sensor_id": retriever.sensor_id,
                "zone_id": ev.get("zone_id"), "sensor_metadata": ev.get("sensor_metadata", {}),
                "note": ev.get("note", "")}
    raise ValueError(f"Unsupported E7 tool: {action}")
