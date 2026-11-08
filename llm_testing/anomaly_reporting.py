"""Local, post-inference evaluation exports. Import this module only after inference.

The separate truth dictionary is passed ONLY from the scoring stage. It is not imported
into Ollama/Agent retrieval. CSV outputs are intended for offline evaluation and
remain excluded from Git by the parent outputs/ ignore rule.
"""
from __future__ import annotations

import csv
from pathlib import Path


def classify_error(error: str) -> str:
    text = str(error or "").lower()
    if not text:
        return "NONE"
    if "out of memory" in text or "out-of-memory" in text or "cuda error" in text:
        return "GPU_OOM"
    if "timed out" in text or "timeout" in text:
        return "TIMEOUT"
    if "json" in text or "schema" in text or "missing required" in text:
        return "INVALID_JSON"
    if "tool" in text and ("call" in text or "argument" in text):
        return "TOOL_ERROR"
    if "http" in text or "connection" in text or "ollama" in text:
        return "OLLAMA_API_ERROR"
    return "OTHER_ERROR"


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def export_detailed_reports(outdir: Path, truth: dict, config: dict, metrics: list[dict]) -> None:
    # Called after all inference files have closed, so truth never enters model tools.
    import json

    case_rows = []
    error_rows = []
    for model in config["models"]:
        safe_name = model.replace(":", "_").replace("/", "_")
        input_path = outdir / f"predictions_{safe_name}.jsonl"
        with input_path.open(encoding="utf-8") as f:
            model_rows = [json.loads(line) for line in f if line.strip()]
        for row in model_rows:
            case_id = row["case_id"]
            expected = truth[case_id]["anomaly"]
            prediction = row.get("predicted_alert")
            valid = type(prediction) is bool
            category = row.get("error_category") or classify_error(row.get("error", ""))
            if valid:
                outcome = "TP" if prediction and expected else (
                    "FP" if prediction and not expected else (
                        "FN" if not prediction and expected else "TN"))
            else:
                outcome = "INVALID"
            errors = row.get("tool_error_count", 0)
            detail = {
                "model": model, "case_id": case_id,
                "ground_truth_anomaly": expected,
                "predicted_anomaly": prediction if valid else "",
                "outcome": outcome, "valid": valid,
                "tool_call_count": row.get("tool_call_count", 0),
                "tool_error_count": errors,
                "latency_seconds": row.get("latency_seconds"),
                "error_category": category,
                "error": row.get("error", ""),
                "evidence_sha256": row.get("evidence_sha256", ""),
                "raw_prediction_file": input_path.name,
            }
            case_rows.append(detail)
            if outcome == "INVALID" or errors:
                failed_tools = []
                for item in row.get("tool_trace", []) or []:
                    if item.get("status") == "error":
                        failed_tools.append({
                            "tool": item.get("tool", ""),
                            "arguments": item.get("arguments", {}),
                            "result": item.get("result", {}),
                        })
                error_rows.append({
                    "model": model, "case_id": case_id,
                    "category": category if outcome == "INVALID" else "TOOL_ERROR",
                    "valid": valid, "tool_error_count": errors,
                    "error": row.get("error", ""),
                    "failed_tools": json.dumps(failed_tools, ensure_ascii=False),
                    "raw_prediction_file": input_path.name,
                })
    write_csv(outdir / "case_results.csv", case_rows, [
        "model","case_id","ground_truth_anomaly","predicted_anomaly",
        "outcome","valid","tool_call_count","tool_error_count",
        "latency_seconds","error_category","error","evidence_sha256",
        "raw_prediction_file",
    ])
    write_csv(outdir / "errors.csv", error_rows, [
        "model","case_id","category","valid","tool_error_count",
        "error","failed_tools","raw_prediction_file",
    ])
    lines = [
        "# Anomaly Detection Model Selection",
        "",
        "These are measured results from the saved case predictions. "
        "Pilot results do not establish production or blind-test accuracy.",
        "",
        "| Model | Cases | Accuracy (all) | F1 | Recall | Coverage | "
        "Mean latency (s) | Tool errors | Invalid | >85% |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for m in metrics:
        lines.append(
            f'| {m["model"]} | {m["n"]} | {m["accuracy_all"]:.2%} | '
            f'{m["f1"]:.2%} | {m["recall"]:.2%} | {m["coverage"]:.2%} | '
            f'{m["mean_latency_seconds"]:.2f} | {m["tool_errors"]} | '
            f'{m["invalid"]} | {"Yes" if m["passes_gt_85"] else "No"} |'
        )
    lines += [
        "", "## Exports",
        "- `anomaly_model_comparison.csv`: one row per model, aggregate metrics.",
        "- `case_results.csv`: TP/TN/FP/FN/INVALID per case with latency and tool counts.",
        "- `errors.csv`: inference failures and unsuccessful tool calls.",
        "- `predictions_<model>.jsonl`: original saved inference responses and tool traces.",
        "- `experiment_configuration.json`: frozen model list, case IDs and evidence hashes.",
        "", "## Interpretation",
        "Accuracy uses the entire case count, including invalid outputs as non-correct. "
        "Coverage excludes invalid outputs. Recall/F1 refer to valid classified cases; "
        "report coverage alongside them.",
        "Cases are sensor-level and may share an underlying fault event. "
        "Balanced sampling does not reflect real operational anomaly prevalence.",
        "A TOOL_ERROR can occur even when the final JSON is valid.",
        "Error categories are diagnostic classifications from error strings, not independently verified root causes.",
    ]
    (outdir / "model_selection_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
