#!/usr/bin/env python3
"""Frozen-Qwen historical forecasting ablation: B structured, C analogue, D agentic.

All inference uses ONLY per-case visible dates prior to 2026-01-01 and
known-in-advance future calendar/climatology. Hidden January truth is opened
ONLY by the explicit score command. No weights, embeddings, LSTM, fine-tuning,
or trained forecasting model are used. Python standard library only.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import qwen4b_one_month_backtest as base

MODES = ("structured", "analogue", "agentic")
MODELS = ("qwen3:1.7b", "qwen3:4b")
METRICS = tuple(base.SENSORS)
FORECAST_SCHEMA = {
    "type": "object",
    "properties": {
        "predictions": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in METRICS},
            "required": list(METRICS), "additionalProperties": False,
        },
        "interpretation": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "evidence_ids": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["predictions", "interpretation", "assumptions", "evidence_ids"],
    "additionalProperties": False,
}
TOOLS = ("calculate_trends", "find_similar_periods", "get_sensor_history",
         "get_operational_context", "get_historical_outcomes", "finish")
TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "tool": {"type": "string", "enum": list(TOOLS)},
        "metric": {"type": "string", "enum": list(METRICS)},
        "window_days": {"type": "integer", "enum": [7, 14, 31, 90]},
        "reason": {"type": "string"},
    },
    "required": ["tool", "metric", "window_days", "reason"],
    "additionalProperties": False,
}
SYSTEM = (
    "You forecast a synthetic Malaysian building's JANUARY MONTHLY AVERAGE OF DAILY "
    "peak temperature (°C), daily mean humidity (%RH), daily peak CO2 (ppm) and "
    "daily energy (kWh/day). You are a FROZEN Qwen model, not a fitted time-series model. "
    "Use only cited historical evidence ending before the cutoff, plus known future "
    "calendar and climate normals. Future actual weather, headcount, HVAC state and "
    "sensor readings are unknown. Historical analogues are imperfect. "
    "Do not confuse association with causation, or invent certain future trends. "
    "Estimate four numbers; make use of baselines, observed slopes, historical outcomes "
    "and operating schedules where provided. Evidence IDs must come from input. "
    "Be conservative and cite evidence IDs. Respond in required JSON schema."
)
PLANNER_SYSTEM = (
    "You are a bounded historical-data retrieval planner, not the forecaster. "
    "Choose ONE useful next tool from the list to improve a 31-day monthly-average "
    "building sensor forecast. Prefer calculate_trends for changes, "
    "find_similar_periods for similar historical patterns and subsequent outcomes, "
    "get_operational_context for occupancy/HVAC/weather; avoid repeats. "
    "get_historical_outcomes requires a previous analogue retrieval. "
    "Only tool names and metric names listed are valid. JSON only."
)


def num(value, digits=3):
    return round(float(value), digits)


def avg(values):
    return statistics.fmean(values) if values else 0.0


def slopes(values):
    """OLS per observed day; computed numerically, never an LLM hallucination."""
    n = len(values)
    if n < 3:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = avg(values)
    den = sum((i - mean_x)**2 for i in range(n))
    return sum((i - mean_x) * (y - mean_y) for i, y in enumerate(values)) / den


def correlation(x, y):
    if len(x) != len(y) or len(x) < 3:
        return None
    mx, my = avg(x), avg(y)
    sx = math.sqrt(sum((v-mx)**2 for v in x))
    sy = math.sqrt(sum((v-my)**2 for v in y))
    return round(sum((a-mx)*(b-my) for a,b in zip(x,y))/(sx*sy), 3) if sx*sy > 1e-9 else None


def guard_case(history, known, request):
    """Reject leakage, mismatched case IDs, nonchronological/cross-case retrieval."""
    if len(history) != 90 or len(known) != 31:
        raise ValueError("Exactly 90 observed days and 31 known-calendar days required")
    cutoff = date.fromisoformat(request["prompt"]["as_of_date"])
    if len({r["case_id"] for r in history + known}) != 1:
        raise ValueError("Cannot mix independent counterfactual cases")
    if request["case_id"] != history[0]["case_id"]:
        raise ValueError("History does not belong to request's case")
    hist_dates = [date.fromisoformat(r["date"]) for r in history]
    if hist_dates != [cutoff - timedelta(days=90-i) for i in range(90)]:
        raise ValueError("History dates are not contiguous and strictly pre-cutoff")
    future_dates = [date.fromisoformat(r["future_date"]) for r in known]
    if future_dates != [cutoff + timedelta(days=i) for i in range(31)]:
        raise ValueError("Only known calendar for January is permitted")
    if any(r["as_of_date"] != str(cutoff) for r in history+known):
        raise ValueError("Future/reference cutoff inconsistent")
    return cutoff


def cases(out):
    # This function never opens any hidden-target file.
    if not base.prepared_path(out).exists():
        base.prepare(out)
    requests = {r["case_id"]: r for r in base.read_jsonl(base.prepared_path(out))}
    histories = base.group_case(base.csv_rows(base.VISIBLE_HISTORY))
    calendars = base.group_case(base.csv_rows(base.VISIBLE_FUTURE))
    if set(requests) != set(histories) or set(requests) != set(calendars):
        raise ValueError("Prepared requests and visible case groups must match")
    result = {}
    for cid, request in requests.items():
        history = sorted(histories[cid], key=lambda x: x["date"])
        cutoff_date = date.fromisoformat(request["prompt"]["as_of_date"])
        target_end = base.month_after(cutoff_date)
        known = sorted((r for r in calendars[cid]
                        if cutoff_date <= date.fromisoformat(r["future_date"]) < target_end),
                       key=lambda x: x["future_date"])
        cutoff = guard_case(history, known, request)
        result[cid] = {"request":request,"history":history,"known":known,
                       "cutoff":str(cutoff)}
    return result


def series(history, metric):
    col = base.SENSORS[metric][0]
    return [float(r[col]) for r in history]


def trends(history):
    result = {}
    current = history[-28:]
    earlier = history[-56:-28]
    work_current = [r for r in current if float(r["open_office_headcount_avg"])>0]
    work_earlier = [r for r in earlier if float(r["open_office_headcount_avg"])>0]
    result["attendance_workdays"] = {
        "observed_workdays":len(work_current),
        "current_mean":num(avg([float(r["open_office_headcount_avg"]) for r in work_current])),
        "previous_mean":num(avg([float(r["open_office_headcount_avg"]) for r in work_earlier])),
        "recent_workday_slope_per_workday":num(slopes([float(r["open_office_headcount_avg"]) for r in work_current]),4),
    }
    result["operating_conditions"] = {
        "ac_on_days_last28":sum(r["ac_operating"]=="1" for r in current),
        "rain_days_last28":sum(r["local_rain_detected"]=="1" for r in current),
        "mean_rain_mm_last28":num(avg([float(r["local_rain_mm_total"]) for r in current])),
        "days_observed":len(current),
    }
    for metric in METRICS:
        v = series(history, metric)
        result[metric] = {
            "unit":base.SENSORS[metric][1],
            "recent_14_mean":num(avg(v[-14:])),
            "prior_14_mean":num(avg(v[-28:-14])),
            "recent_28_slope_per_day":num(slopes(v[-28:]),4),
            "last_31_mean":num(avg(v[-31:])),
            "previous_31_mean":num(avg(v[-62:-31])),
            "historical_90_mean":num(avg(v)),
        }
    heads=[float(r["open_office_headcount_avg"]) for r in work_current]
    for metric in ("co2","temperature","energy","humidity"):
        ys=[float(r[base.SENSORS[metric][0]]) for r in work_current]
        result[metric]["workday_headcount_pearson_r_last28"] = correlation(heads,ys)
    return result


def known_future(known):
    return {
        "days":len(known),
        "planned_workdays":sum(r["planned_workday"]=="1" for r in known),
        "public_holidays":sum(r["known_public_holiday"]=="1" for r in known),
        "climate_normals_only": {
            "mean_daily_min_temp_c":num(avg([float(r["climatology_daily_min_temp_c"]) for r in known])),
            "mean_daily_max_temp_c":num(avg([float(r["climatology_daily_max_temp_c"]) for r in known])),
            "expected_rain_mm_per_day":num(avg([float(r["climatology_expected_rain_mm_day"]) for r in known])),
        },
        "headcount_plan_information":sorted(set(r["headcount_plan_known"] for r in known)),
        "actual_future_weather_occupancy_hvac_or_sensor_data": "NOT AVAILABLE",
    }


def compact_history(history, window=7):
    return [{
        "date":r["date"],
        "temperature_c":num(r["indoor_temp_daily_peak_c"],2),
        "humidity_rh":num(r["indoor_humidity_mean_pct"],2),
        "co2_ppm":num(r["co2_daily_peak_ppm"],1),
        "energy_kwh_day":num(r["floor_energy_kwh"],2),
        "occupants":num(r["open_office_headcount_avg"],1),
        "ac_on":int(r["ac_operating"]), "rain":int(r["local_rain_detected"]),
    } for r in history[-window:]]


def dtw_distance(a,b,band=2):
    """Numeric DTW over multivariate sequences; no embeddings or LLM needed."""
    n,m=len(a),len(b)
    if n!=m or n==0:
        raise ValueError("DTW needs equal nonempty windows")
    prev=[math.inf]*(m+1);prev[0]=0.0
    for i in range(1,n+1):
        curr=[math.inf]*(m+1)
        for j in range(max(1,i-band),min(m,i+band)+1):
            cost=sum(abs(x-y) for x,y in zip(a[i-1],b[j-1]))
            curr[j]=cost+min(curr[j-1],prev[j],prev[j-1])
        prev=curr
    return prev[-1]/n


def analogues(history, metric, window=14, horizon=31, top_k=3):
    """Return analogues with outcomes entirely BEFORE the newest query window.

    With 90 days, analogues are necessarily short and may be weak: 14-day
    observed precedents, followed by 31-day observed outcomes, all pre-cutoff.
    Retrieval is confined to the SAME synthetic counterfactual case.
    """
    if metric not in METRICS:
        raise ValueError("Unknown metric")
    query_start=len(history)-window
    if query_start < horizon+window or top_k<1:
        return []
    values=series(history,metric)
    heads=[float(r["open_office_headcount_avg"]) for r in history]
    sd_value=max(statistics.pstdev(values),.05)
    sd_head=max(statistics.pstdev(heads),1.0)
    mv,mh=avg(values),avg(heads)
    def vector(i):
        return [((values[j]-mv)/sd_value*.70,
                 (heads[j]-mh)/sd_head*.27,
                 (1 if history[j]["ac_operating"]=="1" else 0)*.02,
                 (1 if history[j]["local_rain_detected"]=="1" else 0)*.01)
                for j in range(i,i+window)]
    q=vector(query_start)
    latest_level=avg(values[query_start:])
    nearest=[]
    # Candidate outcome must END before current query window BEGINS.
    for start in range(query_start-window-horizon+1):
        pre=history[start:start+window]
        following=history[start+window:start+window+horizon]
        if not following or following[-1]["date"] >= history[query_start]["date"]:
            raise ValueError("Analogue outcome overlaps current query")
        observed_pre=avg(values[start:start+window])
        observed_outcome=avg(values[start+window:start+window+horizon])
        dist=dtw_distance(q,vector(start))
        dist+=.18*abs(observed_pre-latest_level)/sd_value
        if date.fromisoformat(pre[0]["date"]).weekday()!=date.fromisoformat(history[query_start]["date"]).weekday():
            dist+=.03
        nearest.append({
            "id":f"AN-{metric}-{start:03}",
            "metric":metric,
            "input_start":pre[0]["date"],
            "input_end":pre[-1]["date"],
            "outcome_start":following[0]["date"],
            "outcome_end":following[-1]["date"],
            "distance":num(dist,5),
            "input_mean":num(observed_pre,4),
            "subsequent_31d_mean":num(observed_outcome,4),
            "historical_change":num(observed_outcome-observed_pre,4),
            "source":"same_case_observed_pre_cutoff",
        })
    return sorted(nearest,key=lambda a:(a["distance"],a["input_start"]))[:top_k]


def analogue_baseline(history):
    """No-LLM retrieval predictor, evaluated alongside both Qwen and naive means."""
    result={}
    for metric in METRICS:
        matches=analogues(history,metric)
        if not matches:
            result[metric]=None
            continue
        weights=[1/(.2+a["distance"]) for a in matches]
        change=sum(w*a["historical_change"] for w,a in zip(weights,matches))/sum(weights)
        result[metric]=round(avg(series(history,metric)[-14:])+change,5)
    return result


def evidence_structured(case, mode):
    history,known=case["history"],case["known"]
    summary=base.context_summary(history,known)
    e=[
        {"id":"HISTORY","tool":"get_sensor_history",
         "source":"visible_history_same_case",
         "recent_daily_readings":compact_history(history,7),
         "recent_weekly_summaries":summary["historical_weekly_averages"][-5:],
         "last_31d_means":summary["last_31d_means"],
         "last_90d_means":summary["last_90d_means"]},
        {"id":"TRENDS","tool":"calculate_trends","source":"visible_history_same_case",
         "result":trends(history)},
        {"id":"FUTURE_KNOWN","tool":"get_operational_context",
         "source":"known_calendar_and_climate_normals_only",
         "result":known_future(known)},
        {"id":"BASELINES","tool":"historical_reference_methods",
         "source":"computed_from_observed_history","result":case["request"]["baselines"]},
    ]
    if mode=="analogue":
        e.append({"id":"ANALOGUES","tool":"find_similar_periods",
                  "source":"same_case_only_pre_cutoff_DTW",
                  "matches":{m:analogues(history,m,top_k=2) for m in METRICS},
                  "analogue_only_forecasts":analogue_baseline(history)})
    return e


def tool_result(case, tool, metric, window, retrieved):
    history,known=case["history"],case["known"]
    if tool=="get_sensor_history":
        return {"metric":metric,"unit":base.SENSORS[metric][1],
                "rows":[{"date":r["date"],"value":num(r[base.SENSORS[metric][0]],3),
                         "occupancy":num(r["open_office_headcount_avg"],1),
                         "ac":int(r["ac_operating"]),"rain":int(r["local_rain_detected"])}
                        for r in history[-min(window,31):]]}
    if tool=="calculate_trends":
        report=trends(history)
        return {"requested_metric":metric,"metric_trend":report[metric],
                "occupancy_trend":report["attendance_workdays"],
                "operating_conditions":report["operating_conditions"]}
    if tool=="get_operational_context":
        recent=history[-min(window,31):]
        return {"observed_recent":{
                    "occupancy_workday_mean":num(avg([float(r["open_office_headcount_avg"]) for r in recent if float(r["open_office_headcount_avg"])>0])),
                    "ac_on_days":sum(r["ac_operating"]=="1" for r in recent),
                    "rain_days":sum(r["local_rain_detected"]=="1" for r in recent),
                    "days":len(recent)},
                "known_in_advance_future":known_future(known)}
    if tool=="find_similar_periods":
        return {"metric":metric,"similarity_method":"multivariate_scaled_numeric_DTW",
                "no_embeddings":True,"matches":analogues(history,metric,top_k=3)}
    if tool=="get_historical_outcomes":
        retrieved_matches=[a for evidence in retrieved if evidence["tool"]=="find_similar_periods"
                          for a in evidence["result"].get("matches",[])
                          if a["metric"]==metric]
        if not retrieved_matches:
            return {"metric":metric,"available":False,
                    "reason":"Call find_similar_periods for this metric first"}
        # Revalidate against case-local source, not an untrusted model-provided date.
        allowed={a["id"]:a for a in analogues(history,metric,top_k=3)}
        return {"metric":metric,"available":True,
                "historical_outcomes":[allowed[a["id"]] for a in retrieved_matches if a["id"] in allowed]}
    raise ValueError("Tool not permitted")


def ollama_chat(system, prompt, schema, args):
    """Bounded local Ollama JSON request. No remote API, embeddings or model updates."""
    host=args.ollama_url.rstrip("/")
    if not (host.startswith("http://127.0.0.1:") or host.startswith("http://localhost:")):
        raise ValueError("Only localhost Ollama is allowed")
    data={
        "model":args.model,"stream":False,"think":False,"format":schema,
        "options":{"temperature":0,"num_ctx":args.context},
        "messages":[{"role":"system","content":system},
                    {"role":"user","content":json.dumps(prompt,ensure_ascii=False,separators=(",",":"))}],
    }
    req=Request(host+"/api/chat",data=json.dumps(data).encode(),method="POST",
                headers={"Content-Type":"application/json"})
    began=time.monotonic()
    try:
        with urlopen(req,timeout=args.timeout) as resp:
            envelope=json.loads(resp.read().decode())
    except URLError as exc:
        raise RuntimeError("Cannot reach Ollama; start ollama serve") from exc
    except HTTPError as exc:
        raise RuntimeError(f"Ollama HTTP {exc.code}") from exc
    content=(envelope.get("message") or {}).get("content","")
    output=json.loads(content)
    if not isinstance(output,dict):
        raise ValueError("Model returned non-object JSON")
    meta={"latency_ms":round((time.monotonic()-began)*1000,1),
          "tokens_input":envelope.get("prompt_eval_count"),
          "tokens_output":envelope.get("eval_count")}
    return output,meta


def forecast_from_evidence(case, mode, evidence, args, calls, trace):
    packet={
        "case_id":case["request"]["case_id"],
        "as_of_date":case["cutoff"],
        "target_start":case["request"]["prompt"]["forecast_start"],
        "target_end_exclusive":case["request"]["prompt"]["forecast_end_exclusive"],
        "forecast_type":"monthly mean of four DAILY metrics",
        "no_future_actuals":True,
        "evidence":evidence,
    }
    output,meta=ollama_chat(SYSTEM,packet,FORECAST_SCHEMA,args)
    raw=output.get("predictions")
    if not isinstance(raw,dict):
        raise ValueError("Predictions object missing")
    pred={}
    for metric in METRICS:
        _col,_unit,minimum,maximum=base.SENSORS[metric]
        value=raw.get(metric)
        if type(value) not in (float,int) or not math.isfinite(value) or not minimum<=value<=maximum:
            raise ValueError(f"{metric} prediction is invalid: {value!r}")
        pred[metric]=round(float(value),5)
    available={e["id"] for e in evidence}
    cited=[v for v in output.get("evidence_ids",[]) if isinstance(v,str) and v in available]
    return {
        "status":"valid","predictions":pred,
        "interpretation":str(output.get("interpretation",""))[:1000],
        "assumptions":[str(v)[:240] for v in output.get("assumptions",[])[:6]],
        "evidence_ids":list(dict.fromkeys(cited)),
        "uncited_or_invalid_evidence_ids":len(output.get("evidence_ids",[]))-len(cited),
        "citation_verified":bool(cited),
        "tool_trace":trace,"tool_calls":len(trace),"llm_calls":calls+1,
        "latency_ms":meta["latency_ms"],
        "tokens_input_forecaster":meta["tokens_input"],
        "tokens_output_forecaster":meta["tokens_output"],
        "evidence_source_ids":sorted(available),
    }


def execute_case(case,mode,args):
    start=time.monotonic()
    if mode in ("structured","analogue"):
        evidence=evidence_structured(case,mode)
        result=forecast_from_evidence(case,mode,evidence,args,0,[])
    else:
        evidence=[
            {"id":"BASELINES","tool":"historical_reference_methods",
             "result":case["request"]["baselines"]},
            {"id":"FUTURE_KNOWN","tool":"known_future",
             "result":known_future(case["known"])},
            {"id":"RECENT_OBSERVATIONS","tool":"get_sensor_history",
             "result":compact_history(case["history"],7)},
        ]
        trace=[]
        retrieved=[]
        calls=0
        seen=set()
        for iteration in range(args.max_tools):
            planner_input={
                "case_id":case["request"]["case_id"],
                "forecast_target":"January mean of daily peak temp, daily mean humidity, daily peak CO2, daily energy",
                "cutoff":case["cutoff"],"available_tools":list(TOOLS),
                "steps_remaining":args.max_tools-iteration,
                "history_coverage_days":90,"current_evidence":evidence,
                "already_used_tools":sorted(seen),
                "require_one_actual_tool_call":not bool(trace),
                "no_future_actual_data":True,
            }
            plan,meta=ollama_chat(PLANNER_SYSTEM,planner_input,TOOL_SCHEMA,args)
            calls+=1
            tool=plan.get("tool","finish")
            metric=plan.get("metric","co2")
            window=plan.get("window_days",14)
            if tool=="finish" and trace:
                break
            if tool not in TOOLS or metric not in METRICS or window not in (7,14,31,90):
                raise ValueError("Planner selected unrecognized tool or arguments")
            if tool=="finish":
                tool="calculate_trends" # Minimum verified retrieval, explicitly logged
                reason="Mandatory evidence retrieval when planner stopped immediately"
                source="bounded_fallback"
            else:
                reason=str(plan.get("reason",""))[:150]
                source="llm_selected"
            identity=(tool,metric,window)
            if identity in seen:
                break
            seen.add(identity)
            result=tool_result(case,tool,metric,window,retrieved)
            item={"id":f"TOOL-{len(trace)+1}","tool":tool,"result":result}
            evidence.append(item);retrieved.append(item)
            trace.append({"id":item["id"],"tool":tool,"metric":metric,
                          "window_days":window,"reason":reason,"source":source,
                          "context":"strictly pre-cutoff or known future calendar"})
        result=forecast_from_evidence(case,mode,evidence,args,calls,trace)
    result["latency_ms"]=round((time.monotonic()-start)*1000,1)
    return result


def result_path(out, mode, model):
    return out/"agentic_rag"/f"predictions_{mode}_{base.model_slug(model)}.jsonl"


def run(args):
    if args.mode not in MODES or args.model not in MODELS:
        raise ValueError("Unknown mode/model")
    all_cases=cases(args.out)
    ordered=sorted(all_cases)
    if args.case:
        if args.case not in all_cases:raise ValueError(f"Case not found: {args.case}")
        ordered=[args.case]
    if args.limit_cases:
        ordered=ordered[:args.limit_cases]
    path=result_path(args.out,args.mode,args.model)
    existing=list(base.read_jsonl(path)) if path.exists() and args.resume else []
    # Retry failed runs; never consider a failed model call a completed case.
    completed={r["case_id"] for r in existing if r.get("status")=="valid"
               and r.get("model")==args.model and r.get("mode")==args.mode}
    pending=[cid for cid in ordered if cid not in completed]
    print(f"Arm={args.mode} model={args.model} cases={len(ordered)} pending={len(pending)} "
          f"-> {path}",flush=True)
    if args.dry_run:
        if pending:
            case=all_cases[pending[0]]
            evidence=evidence_structured(case,"analogue" if args.mode=="agentic" else args.mode)
            print(json.dumps({"case_id":pending[0],"as_of":case["cutoff"],
                              "future_known":known_future(case["known"]),
                              "evidence_preview":evidence},indent=2,ensure_ascii=False))
        return
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("a" if args.resume else "w",encoding="utf-8") as handle:
        for idx,cid in enumerate(pending,1):
            case=all_cases[cid]
            record={"case_id":cid,"mode":args.mode,"model":args.model,
                    "as_of_date":case["cutoff"],"status":"error",
                    "forecast_end_exclusive":case["request"]["prompt"]["forecast_end_exclusive"]}
            try:
                record.update(execute_case(case,args.mode,args))
            except (ValueError,TypeError,KeyError,RuntimeError,OSError,TimeoutError) as exc:
                record["error"]=str(exc)[:350]
            handle.write(json.dumps(record,ensure_ascii=False,allow_nan=False)+"\n")
            handle.flush()
            print(f"[{idx}/{len(pending)}] {cid}: {record['status']} "
                  +(f"{record.get('latency_ms')} ms; {record.get('tool_calls',0)} tools"
                    if record["status"]=="valid" else str(record.get("error",""))),flush=True)


def score_arm(args, mode, requests, truth, histories):
    path=result_path(args.out,mode,args.model)
    if not path.exists():
        print(f"Not yet run: {path}")
        return None
    results={r["case_id"]:r for r in base.read_jsonl(path)}
    if not results: raise ValueError("No model results: "+str(path))
    if set(results)-set(requests):raise ValueError("Prediction file contains unknown case")
    pools={k:{name:[] for name in ("llm","last_31d","last_90d",
                                  "weekday_matched","retrieval_only")} for k in METRICS}
    details=[]
    valid_records=[]
    for cid in sorted(results):
        r=results[cid]
        if r.get("status")!="valid":continue
        if r.get("as_of_date")!=requests[cid]["prompt"]["as_of_date"]:
            raise ValueError("Mismatched forecast cutoff")
        valid_records.append(r)
        analog=analogue_baseline(histories[cid])
        for metric in METRICS:
            actual=truth[cid][metric]
            pred=r["predictions"][metric]
            baselines=requests[cid]["baselines"]
            details.append({"case_id":cid,"metric":metric,"actual":actual,"prediction":pred,
                            "last31":baselines["last_31d"][metric],
                            "weekday":baselines["weekday_matched"][metric],
                            "analogue_only":analog[metric]})
            pools[metric]["llm"].append((pred,actual))
            for name in ("last_31d","last_90d","weekday_matched"):
                pools[metric][name].append((baselines[name][metric],actual))
            if analog[metric] is not None:
                pools[metric]["retrieval_only"].append((analog[metric],actual))
    summary={
        "mode":mode,"model":args.model,
        "scheduled_cases":len(requests),"attempted_cases":len(results),
        "valid_cases":len(valid_records),
        "training_or_fine_tuning":False,"vector_embeddings":False,
        "forecast_target":"January 2026 mean of daily peak/mean metrics (31 days)",
        "source":"same-case 90 pre-cutoff days + known future calendar and climatology",
        "by_metric":{},
        "mean_latency_ms":round(avg([r["latency_ms"] for r in valid_records]),1) if valid_records else None,
        "mean_llm_calls":round(avg([r.get("llm_calls",1) for r in valid_records]),2) if valid_records else None,
        "evidence_citation_rate_pct":round(100*sum(bool(r.get("citation_verified")) for r in valid_records)/len(valid_records),2)
                                   if valid_records else None,
        "tool_call_distribution":{tool:sum(t["tool"]==tool for r in valid_records
                                        for t in r.get("tool_trace",[])) for tool in TOOLS if tool!="finish"},
    }
    for metric in METRICS:
        scores={key:base.metrics(v) for key,v in pools[metric].items()}
        best=min(((k,v["mae"]) for k,v in scores.items()
                  if k not in ("llm",) and v["mae"] is not None),key=lambda x:x[1],default=(None,None))
        scores["best_baseline"]=best[0]
        scores["skill_vs_best_baseline_pct"]=(
            round(100*(1-scores["llm"]["mae"]/best[1]),2)
            if best[1] and scores["llm"]["mae"] is not None else None)
        summary["by_metric"][metric]={"unit":base.SENSORS[metric][1],**scores}
    key=f"{mode}_{base.model_slug(args.model)}"
    destination=args.out/"agentic_rag"
    base.write_json(destination/f"summary_{key}.json",summary)
    if details:
        with (destination/f"scores_{key}.csv").open("w",newline="",encoding="utf-8") as f:
            writer=csv.DictWriter(f,fieldnames=list(details[0]))
            writer.writeheader();writer.writerows(details)
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    return summary


def score(args):
    # ONLY score() touches hidden future observations. Inference never calls it.
    all_cases=cases(args.out)
    requests={k:v["request"] for k,v in all_cases.items()}
    histories={k:v["history"] for k,v in all_cases.items()}
    truth=base.truth_monthly()
    summaries={}
    for mode in (MODES if args.mode=="all" else (args.mode,)):
        item=score_arm(args,mode,requests,truth,histories)
        if item:summaries[mode]=item
    if args.mode=="all":
        old=base.prediction_path(args.out,args.model)
        old_rows={r["case_id"]:r for r in base.read_jsonl(old)} if old.exists() else {}
        old_scores={}
        for metric in METRICS:
            pairs=[(old_rows[c]["predictions"][metric],truth[c][metric])
                   for c in sorted(old_rows) if c in truth and old_rows[c]["status"]=="valid"]
            old_scores[metric]=base.metrics(pairs)
        comparison={"model":args.model,"A_original_prompt":old_scores,
                    "arms":{mode:{metric:summaries[mode]["by_metric"][metric]["llm"]
                                  for metric in METRICS} for mode in summaries},
                    "method":"Pairwise comparison requires the same valid case IDs. Missing arms are omitted."}
        base.write_json(args.out/"agentic_rag"/f"comparison_{base.model_slug(args.model)}.json",comparison)
        print("Saved comparison of original A and available B/C/D arms.")


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    for command in ("preview","run","score"):
        p=sub.add_parser(command)
        p.add_argument("--out",type=Path,default=base.DEFAULT_OUT)
        p.add_argument("--model",choices=MODELS,default="qwen3:1.7b")
        p.add_argument("--mode",choices=MODES+("all",) if command=="score" else MODES,
                       default="structured")
        if command!="score":
            p.add_argument("--case",default="")
            p.add_argument("--limit-cases",type=int,default=3,
                           help="3 case smoke test; 0 for all 60")
            p.add_argument("--ollama-url",default="http://127.0.0.1:11434")
            p.add_argument("--timeout",type=int,default=180)
            p.add_argument("--context",type=int,default=6144)
            p.add_argument("--max-tools",type=int,choices=range(1,6),default=3)
            p.add_argument("--resume",action="store_true")
            p.add_argument("--dry-run",action="store_true")
    args=parser.parse_args(argv)
    if args.command=="preview":
        args.dry_run=True
        run(args)
    elif args.command=="run":
        run(args)
    else:
        score(args)


if __name__=="__main__":
    main()
