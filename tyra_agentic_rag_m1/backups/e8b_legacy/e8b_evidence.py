"""E8-B: context-grounded review with abnormality basis verification.

The LLM decides, not Python.  Python checks a *claimed* basis against
causally observed historical reference statistics and named context citations.
No ground-truth labels are loaded, and out-of-band values are not auto-alerts.
"""
from __future__ import annotations
from typing import Any
from datetime import timedelta
from .e8a_evidence import (evidence_packet as e8a_packet, compact_json,
                            validate_e8a)
from .e8b_context import contextual_signals, WEATHER_RAIN, WEATHER_RH, WEATHER_TEMP, WEATHER_SOLAR, OCCUPANCY, HVAC

REVIEW_SYSTEM = """You independently review the CURRENT target sensor at AS_OF.
Return schema-conforming JSON: status, evidence_ids, comparisons, explanation,
context_ids, diagnosis_basis, reference_window, context_effect.
SCREENING IS AN OPINION, NOT A LABEL. Cite current OBS id for definite decisions.
For an alert, cite an earlier SAME-SENSOR OBS ID and an EXACT suggested comparison.

CRITICAL PHYSICS AND CONTEXT:
- Rain/wet weather may be associated with higher OUTDOOR humidity. An INDOOR
  humidity increase can be delayed, damped or absent depending on infiltration,
  ventilation and HVAC. Rain does NOT prove that any indoor rise is normal.
- More occupants can increase CO2 through respiration, but ventilation, mixing,
  time lag and actual CO2 magnitude matter. Higher occupancy does NOT make any
  CO2 level automatically acceptable; a flat headcount does not prove a fault.
- HVAC operation can influence temperature, humidity and electric power.
  A *setpoint* is not a measured room temperature. Never compare these directly.
- Never confuse outdoor RH with room RH, or compare different sensor units.
- Motion, water-leak and rain sensors are discrete/event-like; never treat their
  zero/one state like a continuous temperature slope.
- Context can explain an ordinary variation; do not issue alerts for a mere
  correct numeric change. Prefer normal when supported by a historical pattern
  and compatible operating context. Prefer unknown when the evidence is inadequate.

For suspect/anomaly, choose a concrete diagnosis_basis:
  'historical_change_outlier': an observed 1h/3h/6h/24h change is outside a
       sufficiently populated historical p10-p90 band.
  'historical_level_outlier': current level is outside the historical same-time
       level p10-p90 band.
  'sustained_level_outlier': at least six recent measurements persist outside
       historical same-time level p10-p90.
  'context_contradiction': observed context fails to account for an outlying
       level or change (NOT just because context is absent).
For normal choose 'consistent_with_context' or 'ordinary_variation'.
For unknown choose 'insufficient'. Use reference_window='1h','3h','6h',
'24h','level', or 'none', matching your basis. Outliers are merely candidates;
you still decide if there is a credible fault. No future observations or labels.
Only cite real OBS and CTX ids. When relevant CURRENT context observations
are provided (weather for humidity, occupancy for CO2, HVAC/weather for
thermal/power signals), cite the context IDs you actually used. If describing
an occupancy INCREASE, cite both a current and earlier occupancy CTX ID.
If rain is observed when reviewing humidity, cite the observed rain context ID.
Context references must come from the supplied current or historical snapshots.
JSON only."""

ALERT_BASES = {"historical_change_outlier", "historical_level_outlier",
               "sustained_level_outlier", "context_contradiction"}


def historical_levels(retriever, weeks: int = 16) -> dict:
    """Compute 1/week same-weekday/same-clock reference using only past readings.

    Historical samples are descriptive and can contain faults or different
    occupancy/HVAC conditions.  This is not a labeled normal-only baseline.
    """
    from .db import db_connect
    from .e7_tools import compact_stats
    origin = retriever.as_of
    anchors = [origin - timedelta(days=7*i) for i in range(1, weeks+1)]
    con = db_connect(True, retriever.db_path)
    try:
        query = ','.join('?' for _ in anchors)
        rows = con.execute(f"SELECT timestamp,value FROM readings WHERE sensor_id=? AND "
            f"timestamp IN ({query}) AND timestamp<? ORDER BY timestamp",
            [retriever.sensor_id, *anchors, origin]).fetchall()
    finally:
        con.close()
    vals = [float(r[1]) for r in rows]
    stats = compact_stats(vals)
    stats['current_value'] = None
    stats['method'] = 'previous_16_weekly_same_clock_same_weekday_values'
    stats['caution'] = ('Historical data can include faults and different operational contexts; '
                         'p10-p90 is descriptive, not an anomaly label')
    return stats


def packet_for_e8b(retriever, recent: dict, trajectory: dict, evidence: list[dict], ledger,
                   context: dict) -> dict:
    packet = e8a_packet(retriever, recent, trajectory, evidence, ledger)
    # Retrieve all earlier weekly anchors (not only four prompt examples).
    # This is a fixed, timestamp-safe reference; it does not read labels.
    level = historical_levels(retriever)
    level["current_value"] = recent["current"]["value"]
    packet["historical_level_reference"] = level
    # Fit Qwen3 1.7B's small context budget: omit redundant same-sensor
    # comparisons and irrelevant room/weather modalities, but never fabricate.
    earlier = packet.get("earlier_observations", [])
    chosen = earlier[:3] + earlier[-3:]
    chosen_ids = {x["id"] for x in chosen}
    packet["earlier_observations"] = [x for x in earlier if x["id"] in chosen_ids]
    packet["suggested_comparisons"] = [x for x in packet["suggested_comparisons"]
                                        if x["right_id"] in chosen_ids]
    packet["computed_differences"] = [x for x in packet["computed_differences"]
                                      if x["earlier_id"] in chosen_ids]
    packet["recent_observations"] = packet.get("recent_observations", [])[-5:]
    packet["optional_retrieval"] = [
        {"tool": x.get("tool"), "summary": x.get("summary"),
         "historical_bucket_means": x.get("historical_bucket_means")}
        for x in packet.get("optional_retrieval", [])[:2]
    ]
    kind = str(retriever.sensor_id).split("-", 1)[0].upper()
    fields = {
        "RH": {"weather": set(WEATHER_RAIN+WEATHER_RH), "hvac": {"ac_on", "ventilation_level"}},
        "CO2": {"occupancy": set(OCCUPANCY), "hvac": {"ventilation_level", "ac_on"}},
        "TEMP": {"weather": set(WEATHER_TEMP+WEATHER_SOLAR), "hvac": set(HVAC)},
        "PWR": {"occupancy": set(OCCUPANCY), "hvac": set(HVAC)},
        "LUX": {"weather": set(WEATHER_SOLAR), "occupancy": set(OCCUPANCY)},
        "PIR": {"occupancy": set(OCCUPANCY)},
        "RAIN": {"weather": set(WEATHER_RAIN)},
        "LEAK": {},
    }.get(kind, {})
    def needed(row):
        return row.get("attribute") in fields.get(row.get("kind"), set())
    def relevant(group):
        return [x for x in context[group] if needed(x)]
    packet["operational_context"] = {
        "available": context["available"], "room": context["room"],
        "ac_zone": context["ac_zone"],
        "current": relevant("current"),
        "historical_1h": relevant("historical_1h"),
        "historical_3h": relevant("historical_3h"),
        "changes": [c for c in context["changes"] if
                    c["attribute"].split(".", 1)[1] in fields.get(c["attribute"].split(".", 1)[0], set())],
        "warnings": context["warnings"],
    }
    packet["context_signals"] = contextual_signals(retriever.sensor_id, context, trajectory)
    packet["requirement"] = ("For alert, cite current OBS, a prior same-sensor OBS, "
        "a factual comparison AND a supported abnormality basis. Context correlations "
        "are not definitive fault/normal labels. Unknown is not treated as normal.")
    return packet


def _outside(value, stats: dict) -> bool:
    if not isinstance(stats, dict) or (stats.get("n") or 0) < 6:
        return False
    lo, hi = stats.get("p10"), stats.get("p90")
    try:
        return lo is not None and hi is not None and (float(value) < float(lo) or float(value) > float(hi))
    except (TypeError, ValueError):
        return False


def _alert_basis_supported(p: dict, packet: dict) -> tuple[bool, str]:
    basis = p.get("diagnosis_basis")
    window = p.get("reference_window")
    historical = packet.get("historical_change_reference") or {}
    level = packet.get("historical_level_reference") or {}
    if basis == "historical_change_outlier":
        if window not in ("1h", "3h", "6h", "24h"):
            return False, "missing_valid_change_window"
        data = historical.get(window) or {}
        return _outside(data.get("current_delta"), data), "change_not_beyond_reference_band"
    if basis == "historical_level_outlier":
        return _outside(level.get("current_value"), level), "level_reference_insufficient_or_not_outlying"
    if basis == "sustained_level_outlier":
        if (level.get("n") or 0) < 6:
            return False, "level_reference_insufficient"
        recent = packet.get("recent_observations") or []
        if len(recent) < 6:
            return False, "not_enough_recent_observations"
        vals = [r.get("value") for r in recent[-6:]]
        try:
            lo, hi = float(level["p10"]), float(level["p90"])
            return bool(all(float(x) > hi for x in vals) or all(float(x) < lo for x in vals)), "not_a_persistent_level_outlier"
        except (TypeError, ValueError, KeyError):
            return False, "invalid_level_reference"
    if basis == "context_contradiction":
        # A contradiction requires a dated context signal AND an actual
        # numerical deviation; context absence is never itself anomalous.
        if not p.get("context_ids") or p.get("context_effect") != "contradictory":
            return False, "context_contradiction_not_cited"
        any_delta = any(_outside(x.get("current_delta"), x)
                        for x in historical.values() if isinstance(x, dict))
        return any_delta or _outside(level.get("current_value"), level), "no_objective_outlier_for_context_claim"
    return False, "missing_supported_anomaly_basis"


def validate_e8b(proposal: dict, ledger, sensor_id: str, packet: dict) -> dict:
    result = validate_e8a(proposal, ledger, sensor_id, packet["current_id"])
    # Context IDs must reference an actual, at-or-before-AS_OF indexed row.
    all_context = {x["id"]: x for section in ("current", "historical_1h", "historical_3h")
                   for x in (packet.get("operational_context") or {}).get(section, [])}
    cited = list(dict.fromkeys(proposal.get("context_ids") or []))
    invalid = [x for x in cited if x not in all_context]
    future = [x for x in cited if x in all_context and all_context[x]["timestamp"] > ledger.origin]
    result["valid_context_ids"] = [x for x in cited if x in all_context and x not in future]
    result["invalid_context_ids"] = invalid + future
    result["diagnosis_basis"] = proposal.get("diagnosis_basis")
    result["reference_window"] = proposal.get("reference_window")
    result["context_effect"] = proposal.get("context_effect")
    status = proposal.get("status", "unknown")
    if invalid or future:
        result["evidence_status"] = "invalid_context_citation"
        result["verified_status"] = "unknown"
        return result
    # If relevant operational context is supplied, a definite classification
    # must visibly use it; an unsupported claim of unavailable context is not
    # accepted. This is evidence-use validation, not an automatic diagnosis.
    if status != "unknown" and result["evidence_status"] == "grounded":
        current_ctx = (packet.get("operational_context") or {}).get("current") or []
        prefix = str(sensor_id).split("-", 1)[0].upper()
        priority = {"RH": {"weather"}, "CO2": {"occupancy"},
                    "TEMP": {"hvac", "weather"}, "PWR": {"hvac", "occupancy"},
                    "LUX": {"weather"}, "PIR": {"occupancy"}}.get(prefix, set())
        relevant = {r["id"] for r in current_ctx if r.get("kind") in priority}
        if relevant and not relevant.intersection(cited):
            result["evidence_status"] = "missing_relevant_context_citation"
            result["verified_status"] = "unknown"
            return result
        if relevant and proposal.get("context_effect") == "unavailable":
            result["evidence_status"] = "context_available_but_marked_unavailable"
            result["verified_status"] = "unknown"
            return result
        if prefix == "RH":
            rain_ids = {r["id"] for r in current_ctx if r.get("kind") == "weather"
                and r.get("attribute") in WEATHER_RAIN and isinstance(r.get("value"), (int,float))
                and float(r.get("value")) > 0}
            if rain_ids and not rain_ids.intersection(cited):
                result["evidence_status"] = "rain_context_not_cited"
                result["verified_status"] = "unknown"
                return result
        if prefix == "CO2" and proposal.get("context_effect") == "expected":
            rising = [r for r in (packet.get("operational_context") or {}).get("changes", [])
                if r.get("attribute", "").startswith("occupancy.") and r.get("window") == "1h"
                and (r.get("delta") or 0) > 0]
            if rising and not any({r["current_id"],r["earlier_id"]}.issubset(set(cited)) for r in rising):
                result["evidence_status"] = "occupancy_growth_not_fully_cited"
                result["verified_status"] = "unknown"
                return result
    if status in ("suspect", "anomaly") and result["evidence_status"] == "grounded":
        supported, why = _alert_basis_supported(proposal, packet)
        result["abnormality_basis_supported"] = bool(supported)
        if not supported:
            result["evidence_status"] = "unsupported_abnormality_basis"
            result["verified_status"] = "unknown"
            result["basis_issue"] = why
        else:
            result["basis_issue"] = None
    return result


def _prompt(screening, packet):
    return "SCREENING (not truth): " + compact_json({"status": screening.get("status"),
                "explanation": str(screening.get("explanation", ""))[:160]}) + "\nEVIDENCE: " + compact_json(packet)


def _repair(proposal: dict, validation: dict, packet: dict) -> str:
    return ("Your previous decision failed deterministic factual/basis validation. "
      "An OBS comparison proves arithmetic, not a fault. Evaluate from scratch; "
      "normal or unknown are allowed. Do not fabricate evidence. "
      "If a change/outlier is plausible but fully explained, consider normal. "
      "If there is an outlier and evidence of a fault, cite it precisely. "
      "ONE repair attempt only.\nFailure: " + compact_json({"status": validation.get("evidence_status"),
      "basis_issue": validation.get("basis_issue"),
      "invalid_context_ids": validation.get("invalid_context_ids"),
      "invalid_evidence_ids": validation.get("invalid_evidence_ids"),
      "suggested_comparisons": packet.get("suggested_comparisons")}) +
      "\nPRIOR: " + compact_json(proposal) + "\nEVIDENCE: " + compact_json(packet))


def verify_e8b(llm, schema, screening: dict, packet: dict, ledger, sensor_id: str):
    proposal = llm.ask(REVIEW_SYSTEM, _prompt(screening, packet), schema).model_dump()
    result = validate_e8b(proposal, ledger, sensor_id, packet)
    audit = {"attempts": 1, "repair_attempted": False,
             "first_proposal": proposal, "first_evidence_status": result["evidence_status"]}
    if result["evidence_status"] in ("grounded", "abstained"):
        return proposal, result, audit
    audit["repair_attempted"] = True
    audit["attempts"] = 2
    try:
        correction = llm.ask(REVIEW_SYSTEM, _repair(proposal, result, packet), schema).model_dump()
        last = validate_e8b(correction, ledger, sensor_id, packet)
        audit["final_evidence_status"] = last["evidence_status"]
        return correction, last, audit
    except Exception as exc:
        audit["repair_error"] = f"{type(exc).__name__}: {exc}"
        return proposal, result, audit
