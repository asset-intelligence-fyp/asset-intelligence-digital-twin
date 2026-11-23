#!/usr/bin/env python3
"""Causal, reproducible Qwen3 4B one-month synthetic-office forecasting backtest.

Historical context: 90 calendar days ending 2025-12-31 for each of 60 cases.
Holdout: the next calendar month (January 2026), hidden until scoring.
Targets: January mean of daily peak temperature, daily mean humidity, daily
peak CO2 and daily energy consumption (four different units).
No fine-tuning. No future actual observations in Ollama prompts.
Python 3.10+ standard library only. Local Ollama API, no cloud services.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
import statistics
import sys
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "malaysian_digital_twin_llm_dataset_v4" / "generated"
VISIBLE_HISTORY = DATA / "llm_reference_visible" / "forecast_cases_history_VISIBLE.csv"
VISIBLE_FUTURE = DATA / "llm_reference_visible" / "forecast_cases_future_known_VISIBLE.csv"
HIDDEN_TRUTH = DATA / "llm_reference_hidden" / "forecast_cases_future_HIDDEN.csv"
DEFAULT_OUT = ROOT / "experiments" / "outputs" / "jan2026"
SENSORS = {
    "temperature": ("indoor_temp_daily_peak_c", "°C", -20.0, 65.0),
    "humidity": ("indoor_humidity_mean_pct", "%RH", 0.0, 100.0),
    "co2": ("co2_daily_peak_ppm", "ppm", 0.0, 10000.0),
    "energy": ("floor_energy_kwh", "kWh/day", 0.0, 1000.0),
}
JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "predictions": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in SENSORS},
            "required": list(SENSORS),
            "additionalProperties": False,
        },
        "interpretation": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["predictions", "interpretation", "assumptions"],
    "additionalProperties": False,
}
SYSTEM = (
    "You are a numerical forecaster for one SYNTHETIC Malaysian office-building digital twin. "
    "Predict the MONTHLY AVERAGE over the target calendar month of four DAILY measurements: "
    "the daily maximum indoor temperature in °C, daily mean relative humidity in %RH, "
    "daily maximum CO2 in ppm, and daily electric energy use in kWh/day. "
    "The model receives 90 PRE-CUTOFF historical days summarized by time window. "
    "Only calendar and climate NORMALS about the future are known; actual future weather, "
    "headcount, AC operation and sensor readings are UNKNOWN. "
    "Never invent observed data or assert a confirmed fault. "
    "Use recent means, historical variation, weekday effects and known holiday context. "
    "Output four valid numerical estimates, a concise interpretation, and assumptions. "
    "Do not output a time series, confidence intervals or invented training accuracy. "
    "Use the exact JSON schema."
)

def parse_date(value: str) -> date:
    return date.fromisoformat(value)

def month_after(d: date) -> date:
    month = d.month % 12 + 1
    year = d.year + (d.month == 12)
    return date(year, month, 1)

def csv_rows(path: Path):
    if not path.is_file():
        raise FileNotFoundError(f"Required data missing: {path}. Checkout llm-test dataset or this experiment branch.")
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def group_case(rows, key="case_id"):
    groups = defaultdict(list)
    for row in rows:
        groups[row[key]].append(row)
    return groups

def avg(values):
    return sum(values) / len(values) if values else None

def means(rows, keys=tuple(SENSORS)):
    return {k: round(avg([float(r[SENSORS[k][0]]) for r in rows]), 4) for k in keys}

def history_baselines(rows, future_dates):
    last31 = rows[-31:]
    dow = defaultdict(list)
    for r in rows:
        dow[parse_date(r["date"]).weekday()].append(r)
    matching = {}
    for k, (col, _unit, _lo, _hi) in SENSORS.items():
        expected = [avg([float(r[col]) for r in dow[d.weekday()]]) for d in future_dates]
        matching[k] = round(avg(expected), 4)
    return {
        "last_31d": means(last31),
        "last_90d": means(rows),
        "weekday_matched": matching,
    }

def context_summary(history, known):
    # Exactly 90 observations, at dates STRICTLY preceding the as-of.
    newest = parse_date(history[-1]["date"])
    start = parse_date(history[0]["date"])
    weekly = []
    for i in range(0, len(history), 7):
        part = history[i:i + 7]
        weekly.append({
            "start": part[0]["date"], "end": part[-1]["date"],
            "days": len(part), "sensor_means": means(part),
            "headcount_mean": round(avg([float(r["open_office_headcount_avg"]) for r in part]), 2),
            "ac_on_days": sum(r["ac_operating"] == "1" for r in part),
            "rain_days": sum(r["local_rain_detected"] == "1" for r in part),
        })
    return {
        "observed_start": str(start), "observed_end": str(newest),
        "history_days": len(history),
        "historical_weekly_averages": weekly,
        "latest_7_observed_days": [
            {
                "date": r["date"], "observed": means([r]),
                "occupancy": float(r["open_office_headcount_avg"]),
                "ac_operating": r["ac_operating"] == "1",
                "rain_detected": r["local_rain_detected"] == "1",
            }
            for r in history[-7:]
        ],
        "last_31d_means": means(history[-31:]),
        "prior_31d_means": means(history[-62:-31]),
        "last_90d_means": means(history),
        "known_future_calendar": {
            "days": len(known),
            "public_holidays": sum(r["known_public_holiday"] == "1" for r in known),
            "planned_workdays": sum(r["planned_workday"] == "1" for r in known),
            "climatology_expected_rain_mm_per_day": round(avg([
                float(r["climatology_expected_rain_mm_day"]) for r in known]), 2),
            "climatology_mean_min_temp_c": round(avg([
                float(r["climatology_daily_min_temp_c"]) for r in known]), 2),
            "climatology_mean_max_temp_c": round(avg([
                float(r["climatology_daily_max_temp_c"]) for r in known]), 2),
            "future_actual_values_available": False,
        },
    }

def sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                    encoding="utf-8")

def read_jsonl(path):
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def prepared_path(out):
    return out / "requests.jsonl"

def model_slug(model):
    if model not in ("qwen3:1.7b", "qwen3:4b"):
        raise ValueError("Only local qwen3:1.7b and qwen3:4b are allowed")
    return model.replace(":", "_").replace(".", "_")

def prediction_path(out, model):
    return out / f"predictions_{model_slug(model)}.jsonl"

def prepare(out):
    # This stage NEVER OPENS the HIDDEN TRUTH file.
    past = group_case(csv_rows(VISIBLE_HISTORY))
    known = group_case(csv_rows(VISIBLE_FUTURE))
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    with prepared_path(out).open("w", encoding="utf-8") as f:
        for case_id in sorted(past):
            history = sorted(past[case_id], key=lambda x: x["date"])
            if len(history) != 90 or case_id not in known:
                raise ValueError(f"{case_id}: expected 90 historical days and future planning context")
            cutoff = parse_date(history[0]["as_of_date"])
            if any(parse_date(r["date"]) >= cutoff for r in history):
                raise ValueError(f"{case_id}: future observation leaked into history")
            if parse_date(history[-1]["date"]) != cutoff - timedelta(days=1):
                raise ValueError(f"{case_id}: history not contiguous up to cutoff")
            if any(parse_date(r["date"]) != parse_date(history[0]["date"]) + timedelta(days=i)
                   for i, r in enumerate(history)):
                raise ValueError(f"{case_id}: 90-day history not contiguous")
            target_end = month_after(cutoff)
            future = sorted(
                (r for r in known[case_id]
                 if cutoff <= parse_date(r["future_date"]) < target_end),
                key=lambda x: x["future_date"])
            future_dates = [cutoff + timedelta(days=i) for i in range((target_end - cutoff).days)]
            if [parse_date(r["future_date"]) for r in future] != future_dates:
                raise ValueError(f"{case_id}: calendar known-in-advance dates missing")
            packet = {
                "case_id": case_id, "as_of_date": str(cutoff),
                "forecast_start": str(cutoff), "forecast_end_exclusive": str(target_end),
                "horizon_calendar_months": 1, "room_id": history[0]["room_id"],
                "forecast_targets": {
                    k: {"meaning": SENSORS[k][0], "unit": SENSORS[k][1]}
                    for k in SENSORS
                },
                "context": context_summary(history, future),
            }
            row = {"case_id": case_id, "prompt": packet,
                   "baselines": history_baselines(history, future_dates)}
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            total += 1
    manifest = {
        "status": "prepared", "cases": total,
        "as_of": "2026-01-01", "target_end_exclusive": "2026-02-01",
        "history_days": 90, "holdout_days": 31,
        "training": False, "task": "contextual January average of daily metrics",
        "visible_source_hashes": {
            "history": sha256_file(VISIBLE_HISTORY),
            "future_calendar": sha256_file(VISIBLE_FUTURE),
        },
        "input_file": str(prepared_path(out)),
        "guardrail": "Hidden future actuals NEVER read in prepare or run",
    }
    write_json(out / "manifest.json", manifest)
    print(f"Prepared {total} causal cases -> {prepared_path(out)}")
    return total

def request_ollama(prompt, model, host, timeout, context):
    url = host.rstrip("/") + "/api/chat"
    if not (url.startswith("http://127.0.0.1:") or url.startswith("http://localhost:")):
        raise ValueError("Only loopback Ollama URLs are allowed")
    payload = {
        "model": model, "stream": False, "think": False,
        "format": JSON_SCHEMA,
        "options": {"temperature": 0, "num_ctx": context},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(prompt, separators=(",", ":"), ensure_ascii=False)},
        ],
    }
    req = Request(url, data=json.dumps(payload).encode("utf-8"),
                  headers={"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    try:
        with urlopen(req, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Ollama HTTP {exc.code}: {exc.read(300).decode('utf-8','replace')}") from exc
    except URLError as exc:
        raise RuntimeError("Cannot reach Ollama; start ollama serve, then ollama pull " + model) from exc
    content = (result.get("message") or {}).get("content") or ""
    parsed = json.loads(content)
    predictions = parsed.get("predictions")
    if not isinstance(predictions, dict):
        raise ValueError("Model response missing predictions object")
    validated = {}
    for key, (_col, _unit, lo, hi) in SENSORS.items():
        val = predictions.get(key)
        if type(val) not in (float, int) or not math.isfinite(val) or not lo <= val <= hi:
            raise ValueError(f"Invalid {key} forecast: {val!r}")
        validated[key] = round(float(val), 5)
    return {
        "predictions": validated,
        "interpretation": str(parsed.get("interpretation", ""))[:1000],
        "assumptions": [str(x)[:240] for x in parsed.get("assumptions", [])[:5]],
        "latency_ms": round((time.monotonic() - started) * 1000, 1),
        "tokens_input": result.get("prompt_eval_count"),
        "tokens_output": result.get("eval_count"),
    }

def run(args):
    # This stage NEVER OPENS the HIDDEN TRUTH file.
    model_slug(args.model)
    rows = list(read_jsonl(prepared_path(args.out)))
    if args.case:
        rows = [r for r in rows if r["case_id"] == args.case]
        if not rows:
            raise ValueError(f"Case not present: {args.case}")
    if args.limit_cases > 0:
        rows = rows[:args.limit_cases]
    result_path = prediction_path(args.out, args.model)
    completed = {x["case_id"] for x in read_jsonl(result_path)} if args.resume and result_path.exists() else set()
    pending = [r for r in rows if r["case_id"] not in completed]
    print(f"Model={args.model} cases={len(rows)} pending={len(pending)} -> {result_path}", flush=True)
    if args.dry_run:
        print(json.dumps(pending[0]["prompt"], indent=2, ensure_ascii=False) if pending else "No pending cases")
        return
    with result_path.open("a" if args.resume else "w", encoding="utf-8") as f:
        for index, case in enumerate(pending, 1):
            result = {"case_id": case["case_id"], "model": args.model,
                      "as_of_date": case["prompt"]["as_of_date"],
                      "forecast_end_exclusive": case["prompt"]["forecast_end_exclusive"],
                      "status": "error"}
            try:
                result.update(request_ollama(case["prompt"], args.model, args.ollama_url,
                                             args.timeout, args.context))
                result["status"] = "valid"
            except (OSError, ValueError, RuntimeError, TimeoutError, KeyError, TypeError) as exc:
                result["error"] = str(exc)[:350]
            f.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
            f.flush()
            print(f"[{index}/{len(pending)}] {case['case_id']}: {result['status']}"
                  + (f" ({result.get('latency_ms')} ms)" if result["status"] == "valid"
                     else f" {result.get('error')}"), flush=True)

def truth_monthly():
    # This function is deliberately called ONLY by score/baselines, not prepare/run.
    rows = group_case(csv_rows(HIDDEN_TRUTH))
    out = {}
    for case_id, all_rows in rows.items():
        selected = [r for r in all_rows if
                    date(2026, 1, 1) <= parse_date(r["date"]) < date(2026, 2, 1)]
        if len(selected) != 31:
            raise ValueError(f"{case_id}: expected 31 hidden January days")
        out[case_id] = means(selected)
    return out

def metrics(pairs):
    if not pairs:
        return {"n": 0, "mae": None, "rmse": None, "wape_pct": None, "bias": None}
    errors = [pred - actual for pred, actual in pairs]
    mae = avg([abs(e) for e in errors])
    denominator = sum(abs(actual) for _, actual in pairs)
    return {"n": len(pairs), "mae": round(mae, 5),
            "rmse": round(math.sqrt(avg([e*e for e in errors])), 5),
            "wape_pct": round(100 * sum(abs(e) for e in errors) / denominator, 3)
                        if denominator else None,
            "bias": round(avg(errors), 5)}

def score(args):
    requests = {r["case_id"]: r for r in read_jsonl(prepared_path(args.out))}
    truth = truth_monthly()
    if args.mode == "baselines":
        model_results = {cid: None for cid in requests}
        key = "baseline"
    else:
        key = model_slug(args.model)
        path = prediction_path(args.out, args.model)
        model_results = {r["case_id"]: r for r in read_jsonl(path)}
        if not model_results:
            raise ValueError("No model results; run the model locally first")
    rows = []
    pools = {k: {"llm": [], "last_31d": [], "last_90d": [], "weekday_matched": []}
             for k in SENSORS}
    for case_id in sorted(model_results):
        if case_id not in requests or case_id not in truth:
            raise ValueError(f"Unknown case in prediction file: {case_id}")
        pred_record = model_results[case_id]
        valid = pred_record is not None and pred_record.get("status") == "valid"
        for metric in SENSORS:
            actual = truth[case_id][metric]
            base = requests[case_id]["baselines"]
            row = {"case_id": case_id, "metric": metric, "actual_january_mean": actual,
                   "prediction": pred_record["predictions"][metric] if valid else None,
                   "prediction_status": pred_record.get("status") if pred_record else "baseline_only",
                   "model": args.model if args.mode != "baselines" else "none",
                   "latency_ms": pred_record.get("latency_ms") if pred_record else None,
                   "baseline_last31": base["last_31d"][metric],
                   "baseline_last90": base["last_90d"][metric],
                   "baseline_weekday": base["weekday_matched"][metric]}
            rows.append(row)
            if valid:
                pools[metric]["llm"].append((row["prediction"], actual))
            if valid or args.mode == "baselines":
                pools[metric]["last_31d"].append((row["baseline_last31"], actual))
                pools[metric]["last_90d"].append((row["baseline_last90"], actual))
                pools[metric]["weekday_matched"].append((row["baseline_weekday"], actual))
    summary = {
        "model": args.model if args.mode != "baselines" else "none",
        "scope": "January 2026 daily-metric monthly means, synthetic 90-day historical context",
        "holdout": "2026-01-01 inclusive to 2026-02-01 exclusive",
        "training_or_fine_tuning": False,
        "scheduled_cases": len(model_results),
        "valid_cases": sum(r and r.get("status") == "valid" for r in model_results.values()),
        "partial_run": len(model_results) < len(requests),
        "by_metric": {},
    }
    for metric in SENSORS:
        bucket = pools[metric]
        scores = {name: metrics(pairs) for name, pairs in bucket.items()}
        llm_mae = scores["llm"]["mae"]
        base_mae = scores["last_31d"]["mae"]
        summary["by_metric"][metric] = {
            "unit": SENSORS[metric][1], **scores,
            "skill_vs_last31_pct": round(100 * (1 - llm_mae / base_mae), 2)
                 if llm_mae is not None and base_mae else None,
        }
    args.out.mkdir(parents=True, exist_ok=True)
    detail = args.out / f"scores_{key}.csv"
    with detail.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    write_json(args.out / f"summary_{key}.json", summary)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print("Per-case scores:", detail)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    prepare_cmd = sub.add_parser("prepare", help="Prepare evidence using only visible pre-cutoff inputs")
    prepare_cmd.add_argument("--out", type=Path, default=DEFAULT_OUT)
    run_cmd = sub.add_parser("run", help="Ask local Ollama without reading hidden targets")
    run_cmd.add_argument("--out", type=Path, default=DEFAULT_OUT)
    run_cmd.add_argument("--model", choices=("qwen3:1.7b", "qwen3:4b"), default="qwen3:4b")
    run_cmd.add_argument("--case", default="")
    run_cmd.add_argument("--limit-cases", type=int, default=5,
                         help="Small smoke-test by default; use 0 for all 60")
    run_cmd.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    run_cmd.add_argument("--context", type=int, default=4096)
    run_cmd.add_argument("--timeout", type=int, default=180)
    run_cmd.add_argument("--resume", action="store_true")
    run_cmd.add_argument("--dry-run", action="store_true",
                         help="Show prompt for one case without Ollama")
    score_cmd = sub.add_parser("score", help="Evaluate saved forecasts against hidden January truth")
    score_cmd.add_argument("--out", type=Path, default=DEFAULT_OUT)
    score_cmd.add_argument("--model", choices=("qwen3:1.7b", "qwen3:4b"), default="qwen3:4b")
    baseline_cmd = sub.add_parser("baselines", help="Evaluate naive reference methods without Ollama")
    baseline_cmd.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    if args.mode == "prepare":
        prepare(args.out)
    elif args.mode == "run":
        run(args)
    else:
        score(args)

if __name__ == "__main__":
    main()
