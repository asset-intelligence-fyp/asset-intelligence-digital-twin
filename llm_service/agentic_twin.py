"""Read-only, contextual Agentic RAG investigation for TwinLabs synthetic sensors.

This is an E8-A-informed WEBSITE ADAPTER, not the frozen E8-A research model.
The evaluation numbers for E8-A cannot be claimed for this adapter.
No fault labels, injection settings, arbitrary SQL or future data are exposed.
"""
from __future__ import annotations
import calendar
import json
import math
import os
import sqlite3
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from llm_service.shared_llm.ollama import OllamaClient
from llm_service.validated_room import resolve_history_path

MAX_READINGS = 18000
CATEGORIES = {"temperature", "humidity", "co2", "light", "power", "occupancy", "water_leakage"}
BOUNDS = {
    "temperature": (-20, 65), "humidity": (0, 100), "co2": (0, 10000),
    "light": (0, 200000), "power": (0, 10000),
}
INVESTIGATION_FORMAT = {
    "type": "object", "properties": {
        "assessment": {"type": "string", "enum": ["explained_variation", "investigate", "insufficient_evidence"]},
        "finding": {"type": "string"},
        "possible_explanations": {"type": "array", "items": {"type": "string"}},
        "recommended_checks": {"type": "array", "items": {"type": "string"}},
        "evidence_ids": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"}},
    }, "required": ["assessment", "finding", "possible_explanations", "recommended_checks",
                    "evidence_ids", "limitations"], "additionalProperties": False,
}
PLAN_FORMAT = {
    "type": "object", "properties": {
        "tool": {"type": "string", "enum": ["historical", "related", "incidents", "finish"]},
        "reason": {"type": "string"},
    }, "required": ["tool", "reason"], "additionalProperties": False,
}
FORECAST_FORMAT = {
    "type": "object", "properties": {
        "projected_value": {"type": "number"}, "lower_scenario": {"type": "number"},
        "upper_scenario": {"type": "number"},
        "direction": {"type": "string", "enum": ["increasing", "decreasing", "stable", "uncertain"]},
        "explanation": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    }, "required": ["projected_value", "lower_scenario", "upper_scenario",
                    "direction", "explanation", "assumptions"], "additionalProperties": False,
}

def parse_time(value):
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamp must contain a timezone")
    return dt.astimezone(timezone.utc)

def stamp(dt):
    return dt.isoformat().replace("+00:00", "Z")

def round_number(v):
    return round(float(v), 4)

def scrub(text, limit=400):
    return str(text)[:limit].strip()

def _llm(config):
    model = config.get("model", "qwen3:1.7b")
    if model not in ("qwen3:1.7b", "qwen3:4b"):
        raise ValueError("Only Qwen3 1.7B and 4B are approved for local forecasting")
    return OllamaClient(base_url=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
                        model=model, timeout=150, temperature=0)

def ask_json(client, system, payload, schema):
    response = client.chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}],
        format=schema,
    )
    body = (response.get("message") or {}).get("content") or ""
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Qwen did not return a JSON object")
    return data

def prepare(request):
    if not isinstance(request, dict):
        raise ValueError("Expected an investigation request")
    cutoff = parse_time(request.get("as_of"))
    points = request.get("points")
    if not isinstance(points, list) or not 1 <= len(points) <= 18:
        raise ValueError("A registered room and its sensors are required")
    by_code = {p["code"]: p for p in points if isinstance(p, dict) and
               isinstance(p.get("code"), str) and p.get("sensorType") in CATEGORIES}
    target = request.get("sensor_id")
    if target not in by_code:
        raise ValueError("The selected sensor is not in this room")
    raw = request.get("history")
    if not isinstance(raw, list) or len(raw) > MAX_READINGS:
        raise ValueError("Sensor history must contain at most 18000 rows")
    rows = {}
    for row in raw:
        if not isinstance(row, dict) or row.get("point_code") not in by_code:
            continue
        value = row.get("value")
        if type(value) not in (int, float) or not math.isfinite(value):
            continue
        if str(row.get("quality", "")).lower() in ("bad", "invalid", "error", "fault", "missing"):
            continue
        try:
            t = parse_time(row.get("timestamp"))
        except (TypeError, ValueError):
            continue
        if t <= cutoff:
            rows[(row["point_code"], t)] = {"sensor_id": row["point_code"],
                "timestamp": stamp(t), "value": round_number(value), "_time": t}
    indexed = defaultdict(list)
    for row in sorted(rows.values(), key=lambda r: r["_time"]):
        indexed[row["sensor_id"]].append(row)
    if not indexed.get(target):
        raise ValueError("No valid observations are available for the selected sensor")
    return cutoff, by_code, target, indexed

def summarize(rows, cutoff, minutes=None):
    series = [r for r in rows if minutes is None or r["_time"] >= cutoff-timedelta(minutes=minutes)]
    if not series:
        return {"available": False}
    values = [r["value"] for r in series]
    first, last = series[0], series[-1]
    out = {"available": True, "count": len(series), "first_time": first["timestamp"],
           "last_time": last["timestamp"], "first": first["value"], "latest": last["value"],
           "minimum": round_number(min(values)), "maximum": round_number(max(values)),
           "mean": round_number(statistics.fmean(values)),
           "change": round_number(last["value"]-first["value"]),
           "span_minutes": round((last["_time"]-first["_time"]).total_seconds()/60, 2)}
    if len(series) > 1:
        out["previous"] = series[-2]["value"]
        out["last_step_change"] = round_number(last["value"]-series[-2]["value"])
        out["last_step_minutes"] = round((last["_time"]-series[-2]["_time"]).total_seconds()/60, 2)
    return out

def recent_evidence(indexed, target, cutoff):
    records = indexed[target]
    return {"id": "RECENT", "tool": "recent", "sensor_id": target,
            "last_15_min": summarize(records, cutoff, 15),
            "last_60_min": summarize(records, cutoff, 60),
            "last_180_min": summarize(records, cutoff, 180),
            "whole_available_window": summarize(records, cutoff),
            "latest_observations": [
                {"timestamp": r["timestamp"], "value": r["value"]}
                for r in records[-12:]
            ]}

def context_evidence(request, by_code, target, cutoff):
    source = request.get("simulation") or {}
    sim = source.get("simulation") if isinstance(source, dict) else {}
    if not isinstance(sim, dict):
        sim = {}
    room = by_code[target].get("simulatorRoomId")
    weather = sim.get("weather") or {}
    calendar_data = sim.get("calendar") or {}
    operation = sim.get("operation") or {}
    heads = sim.get("simulated_headcounts") or {}
    if not isinstance(weather, dict): weather = {}
    if not isinstance(calendar_data, dict): calendar_data = {}
    if not isinstance(operation, dict): operation = {}
    if not isinstance(heads, dict): heads = {}
    weather_ok = False
    try:
        weather_ok = abs((cutoff-parse_time(weather.get("timestamp"))).total_seconds()) <= 35*60
    except (ValueError, TypeError):
        pass
    return {"id": "CONTEXT", "tool": "context",
            "source": source.get("name") if isinstance(source, dict) else None,
            "room_id": room, "sensor_type": by_code[target].get("sensorType"),
            "unit": by_code[target].get("unit"),
            "weather": {k:weather.get(k) for k in
                ("scene", "outdoor_temp_c", "outdoor_humidity_pct", "rainfall_mm_per_h") if k in weather} if weather_ok else None,
            "calendar": {k:calendar_data.get(k) for k in
                ("day_type", "is_workday", "holiday_name") if k in calendar_data} if weather_ok else None,
            "operation": {k:operation.get(k) for k in
                ("ac_mode", "setpoint_c", "ventilation", "attendance_factor") if k in operation} if weather_ok else None,
            "headcount": heads.get(room) if weather_ok else None,
            "note": "Current synthetic conditions; missing fields are unknown. No injected-fault settings are supplied."}

def historical_evidence(target, cutoff, config):
    path = resolve_history_path(config.get("history_db") or os.environ.get("LLM_HISTORY_DB", ""))
    if not path:
        return {"id": "HISTORY", "tool": "historical", "available": False,
                "reason": "No normal-history SQLite configured"}
    try:
        uri = Path(path).resolve().as_uri()+"?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            result = con.execute("""SELECT substr(timestamp,1,7), COUNT(*), AVG(value), MIN(value), MAX(value)
                FROM sensor_readings
                WHERE dataset='normal' AND sensor_id=? AND timestamp<? AND value IS NOT NULL
                GROUP BY substr(timestamp,1,7) ORDER BY 1 DESC LIMIT 12""",
                (target, stamp(cutoff))).fetchall()
        finally:
            con.close()
    except (OSError, sqlite3.Error) as exc:
        return {"id": "HISTORY", "tool": "historical", "available": False,
                "reason": "Historical reference could not be read"}
    return {"id": "HISTORY", "tool": "historical", "available": bool(result),
            "months": [{"month":m, "count":int(n), "mean":round_number(avg),
                        "min":round_number(low), "max":round_number(high)}
                       for m,n,avg,low,high in result],
            "note": "Separate synthetic normal-history source, not the current live stream. Does not prove a fault."}

def related_evidence(indexed, by_code, target, cutoff):
    others = [k for k in by_code if k != target and indexed.get(k)]
    return {"id": "RELATED", "tool": "related", "related": [
        {"sensor_id": code, "sensor_type": by_code[code].get("sensorType"),
         "unit": by_code[code].get("unit"), "summary": summarize(indexed[code], cutoff, 60)}
        for code in others[:5]],
        "note": "Do not compare numerical values across different physical units."}

def incidents_evidence(request, target, cutoff):
    alerts = request.get("incidents") or []
    if not isinstance(alerts, list):
        alerts = []
    result=[]
    for alert in alerts[:30]:
        if not isinstance(alert, dict) or alert.get("point_code") != target:
            continue
        try:
            occurred = parse_time(alert.get("time"))
            if occurred > cutoff:
                continue
        except (ValueError, TypeError):
            continue
        result.append({"time": stamp(occurred), "title": scrub(alert.get("title",""), 120),
                       "level": scrub(alert.get("level",""), 25),
                       "description": scrub(alert.get("description",""), 300),
                       "resolved_at": scrub(alert.get("resolved_at",""), 45)})
    return {"id": "INCIDENTS", "tool": "incidents", "records": result[:6],
            "note": "These are rule-generated synthetic alerts, not confirmed maintenance diagnoses."}

def investigate(request, config):
    cutoff,by_code,target,indexed = prepare(request)
    rec=recent_evidence(indexed,target,cutoff)
    ctx=context_evidence(request,by_code,target,cutoff)
    evidence=[rec,ctx]
    trace=[{"tool":"recent","reason":"Current and recent readings","source":"mandatory"},
           {"tool":"context","reason":"Current operational conditions when available","source":"mandatory"}]
    optional={"historical":lambda:historical_evidence(target,cutoff,config),
              "related":lambda:related_evidence(indexed,by_code,target,cutoff),
              "incidents":lambda:incidents_evidence(request,target,cutoff)}
    try:
        client=_llm(config)
        model_error=None
    except Exception as exc:
        client=None
        model_error=f"Qwen initialization unavailable: {type(exc).__name__}"
    used=set()
    for _ in range(2 if client is not None else 0):
        try:
            plan=ask_json(client,
                "You are a bounded retrieval planner for a building sensor. Choose ONE useful new tool or finish. "
                "Prefer historical for past normal levels; related for room context; incidents for prior rule alerts. "
                "No labels or future observations. JSON only.",
                {"question":scrub(request.get("question",""),900),"target":target,
                 "evidence":evidence,"used_optional_tools":sorted(used)},
                PLAN_FORMAT)
            choice=plan.get("tool","finish")
            if choice=="finish" or choice in used or choice not in optional:
                break
            used.add(choice)
            evidence.append(optional[choice]())
            trace.append({"tool":choice, "reason":scrub(plan.get("reason",""),160),
                          "source":"LLM_planned"})
        except Exception as exc:
            model_error=f"Planner unavailable: {type(exc).__name__}"
            break
    # History is useful even if the small planner stops prematurely. Include it as
    # a clearly labelled mandatory comparator whenever configured, not an invisible model decision.
    if "historical" not in used:
        history=historical_evidence(target,cutoff,config)
        if history.get("available"):
            evidence.append(history)
            trace.append({"tool":"historical","reason":"Reference comparison for interpretability","source":"backend_reference"})
    first=rec["whole_available_window"]
    factual=(f"Latest {target} reading: {first['latest']} {by_code[target].get('unit','')} "
             f"at {first['last_time']}; {first['count']} readings available. "
             f"Observed change across available window: {first['change']} {by_code[target].get('unit','')}.")
    supported={item["id"] for item in evidence}
    output={"status":"investigation","sensor_id":target,"room_id":request.get("room_id"),
            "as_of":stamp(cutoff),"finding":factual,
            "assessment":"insufficient_evidence",
            "possible_explanations":[],
            "recommended_checks":["Compare the pattern with room occupancy and ventilation before diagnosing a fault."],
            "evidence":evidence,"trace":trace,"numeric_verification_passed":False,
            "human_review_required":True,"llm_used":False,
            "limitations":["Synthetic measurements; this is not a confirmed equipment diagnosis.",
                           "E8-A research accuracy metrics do not apply to this live contextual adapter.",
                           "Citations are source-checked, but the model's narrative is not independently numerically verified."]}
    try:
        if client is None: raise RuntimeError('Local inference client unavailable')
        verdict=ask_json(client,
            "You are the TwinLabs contextual investigation assistant, NOT an automatic fault alarm. "
            "Use observed readings, retrieved historical data and occupancy/HVAC/weather where available. "
            "Explain current behaviour even when fault status is uncertain. "
            "A normal operating change is not a sensor fault. A rule alert is not a confirmed diagnosis. "
            "Never invent readings, observations, past incidents, operating states or unsupported causes. "
            "Cite evidence IDs supplied in the input. Return concise JSON only.",
            {"question":scrub(request.get("question",""),900),
             "target":target,"as_of":stamp(cutoff),
             "evidence":evidence},INVESTIGATION_FORMAT)
        ids=verdict.get("evidence_ids",[])
        if not isinstance(ids,list):ids=[]
        cited=[x for x in ids if isinstance(x,str) and x in supported]
        if cited:
            output.update({"finding":scrub(verdict.get("finding",factual),1400) or factual,
                           "assessment":verdict.get("assessment") if verdict.get("assessment") in ("explained_variation","investigate","insufficient_evidence") else "insufficient_evidence",
                           "possible_explanations":[scrub(x,300) for x in verdict.get("possible_explanations",[])[:5]],
                           "recommended_checks":[scrub(x,300) for x in verdict.get("recommended_checks",[])[:5]],
                           "cited_evidence_ids":cited,"llm_used":True})
            output["limitations"].extend(scrub(x,220) for x in verdict.get("limitations",[])[:4])
        else:
            output["limitations"].append("Model did not cite an available evidence source; the factual summary is shown instead.")
    except Exception as exc:
        model_error=f"Qwen investigation unavailable: {type(exc).__name__}"
    if model_error:
        output["limitations"].append(model_error)
    return output

def forecast_one_month(request, config):
    cutoff,by_code,target,indexed=prepare(request)
    point=by_code[target]
    kind=point.get("sensorType")
    if kind not in ("temperature","humidity","co2","power","light"):
        raise ValueError("One-month projection supports numeric environmental sensors only")
    recent=recent_evidence(indexed,target,cutoff)
    context=context_evidence(request,by_code,target,cutoff)
    historical=historical_evidence(target,cutoff,config)
    monthly=historical.get("months",[]) if historical.get("available") else []
    last=indexed[target][-1]
    # A one-calendar-month-ahead point, not a fabricated month-long time series.
    # Calendar-month arithmetic uses Malaysia local time, then restores UTC.
    malaysia=cutoff.astimezone(timezone(timedelta(hours=8)))
    m=malaysia.month+1
    year=malaysia.year+(m-1)//12
    month=(m-1)%12+1
    target_dt=malaysia.replace(year=year,month=month,day=min(malaysia.day,calendar.monthrange(year,month)[1])).astimezone(timezone.utc)
    coverage=recent["whole_available_window"]
    enough=bool(monthly) or coverage["span_minutes"] >= 14*24*60
    payload={"task":"one calendar month ahead single-point projection",
             "sensor_id":target,"unit":point.get("unit"),"sensor_type":kind,
             "as_of":stamp(cutoff),"target_time":stamp(target_dt),
             "recent_evidence":recent,"historical_reference":historical,
             "current_context":context,
             "warning":"Future HVAC, weather and occupancy are unknown; scenario bounds are not confidence intervals."}
    output={"status":"unavailable","sensor_id":target,"unit":point.get("unit"),
            "model":config.get("model", "qwen3:1.7b"),
            "target_time":stamp(target_dt),"as_of":stamp(cutoff),
            "horizon_months":1,"method":"qwen_one_month_contextual_scenario",
            "trained_forecast":False,"data_basis":"historical_reference" if monthly else "short_current_stream",
            "coverage":{"observed_samples":coverage["count"],"span_minutes":coverage["span_minutes"],
                        "historical_months":len(monthly)},
            "limitations":["An exploratory scenario, not a validated one-month forecasting model.",
                           "Lower and upper values are possible scenarios, not statistical confidence intervals.",
                           "No actual future weather, HVAC, occupancy or fault information is available."]}
    try:
        forecast=ask_json(_llm(config),
            "You produce an EXPLORATORY single-point sensor projection one calendar month after the observed cutoff. "
            "Use ONLY supplied past values, historical summaries and present conditions; never claim known future weather "
            "or occupancy. Output a central value, plausible lower/upper scenarios, direction and short explanation. "
            "No invented historical observations. No confidence intervals. Structured JSON only.",
            payload,FORECAST_FORMAT)
        values=[forecast.get(k) for k in ("lower_scenario","projected_value","upper_scenario")]
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):
            raise ValueError("Non-finite projection")
        lo,mid,hi=values
        physical=BOUNDS[kind]
        if not(physical[0]<=lo<=mid<=hi<=physical[1]):
            raise ValueError("Projection does not respect ordering or physical bounds")
        output.update({"status":"llm_projection" if enough else "exploratory_scenario",
                       "projected_value":round_number(mid),"lower_scenario":round_number(lo),
                       "upper_scenario":round_number(hi),
                       "direction":forecast.get("direction","uncertain"),
                       "explanation":scrub(forecast.get("explanation",""),1600),
                       "assumptions":[scrub(x,260) for x in forecast.get("assumptions",[])[:5]]})
        if not enough:
            output["limitations"].insert(0,"Less than 14 days of history and no normal reference: low-evidence illustrative estimate.")
    except Exception as exc:
        output["reason"]=f"Qwen could not provide a valid projection: {type(exc).__name__}"
    return output
