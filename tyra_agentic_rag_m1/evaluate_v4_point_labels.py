#!/usr/bin/env python3
"""Independent point-level evaluator for Malaysian Digital Twin v4 labels.

Runs OUTSIDE LLM/retrieval modules. Reads only saved JSONL predictions and
hidden ground_truth_labels.csv, and joins by timestamp + sensor_id.

Examples:
  python evaluate_v4_point_labels.py --labels /path/ground_truth_labels.csv \
      --predictions results/v4_baseline.jsonl results/v4_traditional.jsonl results/v4_agentic.jsonl \
      --suspect alert

Do not import this file into the agent or its tools.
"""
import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
from collections import Counter

TRUE_VALUES = {"1", "true", "t", "yes", "y"}
FALSE_VALUES = {"0", "false", "f", "no", "n"}
VALID_STATUSES = {"normal", "suspect", "anomaly"}


def canonical_time(value):
    text = str(value).strip()
    dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"Timestamp missing timezone offset: {text}. Avoid guessing a timezone.")
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_fault(value):
    text = str(value).strip().lower()
    if text in TRUE_VALUES:
        return 1
    if text in FALSE_VALUES:
        return 0
    raise ValueError(f"Unexpected fault_active value {value!r}; inspect CSV and adapt parser")


def safe_div(a, b):
    return round(a / b, 6) if b else None


def read_predictions(paths):
    results = {}
    wanted = set()
    for path in paths:
        path = Path(path)
        observations = []
        with path.open(encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                if not line.strip():
                    continue
                r = json.loads(line)
                if r.get("task") != "detect":
                    raise ValueError(f"Non-detection record in {path}:{line_no}")
                sensor = str(r["sensor_id"])
                key = (sensor, canonical_time(r["origin"]))
                wanted.add(key)
                observations.append((key, r))
        results[path.name] = observations
    return results, wanted


def read_labels(path, wanted):
    truth = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for required in ("timestamp", "sensor_id", "fault_active"):
            if required not in (reader.fieldnames or []):
                raise ValueError(f"Missing required label column {required!r}")
        for row in reader:
            sensor = str(row["sensor_id"])
            if not any(s == sensor for s, _ in wanted):
                continue
            key = (sensor, canonical_time(row["timestamp"]))
            if key not in wanted:
                continue
            label = parse_fault(row["fault_active"])
            if key in truth and truth[key] != label:
                raise ValueError(f"Contradictory labels for {key}")
            truth[key] = label
    return truth


def evaluate(observations, truth, suspect):
    tp = fp = tn = fn = unknown_positive = unknown_negative = missing = 0
    statuses = Counter()
    details = []
    for key, r in observations:
        sensor, stamp = key
        label = truth.get(key)
        status = r.get("answer", {}).get("status") if r.get("valid") else None
        status = status if status in VALID_STATUSES | {"unknown"} else "unclassified"
        statuses[status] += 1
        if label is None:
            missing += 1
            continue
        pred = None
        if status == "anomaly":
            pred = 1
        elif status == "normal":
            pred = 0
        elif status == "suspect":
            pred = {"alert": 1, "normal": 0, "abstain": None}[suspect]
        if pred is None:
            if label:
                unknown_positive += 1
            else:
                unknown_negative += 1
        elif label and pred:
            tp += 1
        elif label and not pred:
            fn += 1
        elif not label and pred:
            fp += 1
        else:
            tn += 1
        details.append({"timestamp_utc": stamp, "sensor_id": sensor,
                        "label": "anomaly" if label else "normal",
                        "prediction": status, "alert": pred})
    n_labeled = tp + fp + tn + fn + unknown_positive + unknown_negative
    n_classified = tp + fp + tn + fn
    p = safe_div(tp, tp + fp)
    r = safe_div(tp, tp + fn)
    return {
        "records": len(observations), "matched_labels": n_labeled,
        "missing_labels": missing, "status_counts": dict(statuses),
        "classification_coverage": safe_div(n_classified, n_labeled),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "unknown_positive": unknown_positive,
        "unknown_normal": unknown_negative,
        "accuracy_on_classified": safe_div(tp + tn, n_classified),
        "precision_on_classified": p,
        "recall_on_classified": r,
        "f1_on_classified": safe_div(2 * tp, 2 * tp + fp + fn),
        "false_positive_rate_on_classified": safe_div(fp, fp + tn),
        "recall_end_to_end": safe_div(tp, tp + fn + unknown_positive),
        "interpretation": "Pilot only; rates from very few points are not reliable.",
        "predictions": details,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", required=True, help="Path to private ground_truth_labels.csv")
    parser.add_argument("--predictions", nargs="+", required=True, help="One or more prediction JSONL files")
    parser.add_argument("--suspect", choices=["alert", "normal", "abstain"], default="alert")
    parser.add_argument("--out", help="Optional output JSON path")
    args = parser.parse_args()
    records, wanted = read_predictions(args.predictions)
    truth = read_labels(args.labels, wanted)
    output = {"suspect_policy": args.suspect, "methods": {
        name: evaluate(rows, truth, args.suspect) for name, rows in records.items()
    }}
    formatted = json.dumps(output, ensure_ascii=False, indent=2)
    print(formatted)
    if args.out:
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(formatted + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
