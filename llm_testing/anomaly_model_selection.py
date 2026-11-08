"""Four-model anomaly comparison using the existing shared_llm tool-calling agent.

No evaluation keys are loaded in inference. Score only after ALL model responses are saved.
Requires original v4 sources and anomaly adapter imported into llm_testing/.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import random
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_MODELS = ["qwen3:1.7b", "qwen3:4b", "llama3.2:3b", "gemma3:4b"]


def load_jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(s) for s in stream if s.strip()]


def select_cases(cases, limit, seed):
    """Select balanced anomaly/normal cases WITHOUT accessing hidden truth.

    Prepared case IDs encode sample origin. This is suitable only for a pilot.
    Final blind evaluation must use frozen event-group-aware splits.
    """
    if limit <= 0:
        return sorted(cases, key=lambda x: x["case_id"])
    rng = random.Random(seed)
    a = [c for c in cases if c["case_id"].startswith("A")]
    n = [c for c in cases if c["case_id"].startswith("N")]
    if not a or not n:
        raise ValueError("Balanced pilot requires A and N case IDs.")
    k = min(limit // 2, len(a), len(n))
    if k < 1:
        raise ValueError("Pilot limit must be >= 2.")
    # Freeze one identical selection for all models; do not choose per model.
    chosen = rng.sample(sorted(a, key=lambda c: c["case_id"]), k)
    chosen += rng.sample(sorted(n, key=lambda c: c["case_id"]), k)
    return sorted(chosen, key=lambda x: x["case_id"])


def packet_checksum(packet):
    return hashlib.sha256(json.dumps(packet, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def run_inference(args, selected, outdir):
    try:
        from anomaly_agent.v4_tools import V4CaseTools
        from reference.llm_service.shared_llm.agent import run_agent
        from reference.llm_service.shared_llm.ollama import OllamaClient
    except ModuleNotFoundError as exc:
        raise SystemExit("Missing original agent/adapter. Import the existing v4 project and anomaly patch first.") from exc

    outdir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "models": args.models, "cases": [c["case_id"] for c in selected],
        "evidence_sha256": {c["case_id"]: packet_checksum(c) for c in selected},
        "prompt": args.prompt, "temperature": 0,
        "agent_rounds": 5, "max_tool_calls": 10, "seed": args.seed,
        "note": "Pilot selection, not a representative full blind evaluation. Ground truth not loaded for inference."
    }
    (outdir / "experiment_configuration.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for model in args.models:
        safe_name = model.replace(":", "_").replace("/", "_")
        output = outdir / f"predictions_{safe_name}.jsonl"
        if output.exists():
            raise FileExistsError(f"Refusing to overwrite previous inference: {output}. Use a new --run-id.")
        client = OllamaClient(model=model, temperature=0, timeout=args.timeout)
        with output.open("w", encoding="utf-8") as stream:
            for case in selected:
                case_id = case["case_id"]
                tools = V4CaseTools(case)
                sensor = case["sensor"]
                question = (
                    f'At {case["as_of"]}, is sensor {sensor["sensor_id"]} '
                    f'({sensor["sensor_type"]}, {sensor["unit"]}) '
                    f'in room {sensor["room_id"]} behaving abnormally? '
                    "Retrieve current 5-minute observations, historical baseline, and operational "
                    "context using tools. Historical normality does not establish current normality. "
                    "Make your own investigation decision with specific measured evidence."
                )
                row = {"case_id": case_id, "model": model,
                       "evidence_sha256": manifest["evidence_sha256"][case_id]}
                started = time.perf_counter()
                try:
                    response = run_agent(question, tools, client, prompt_variant=args.prompt,
                                         max_rounds=5, max_calls=10)
                    row.update({
                        "valid": True, "predicted_alert": response["result"]["needs_investigation"],
                        "tool_call_count": response["tool_call_count"],
                        "tool_trace": response["tool_trace"],
                        "response": response,
                        "tool_error_count": sum(1 for t in response["tool_trace"] if t.get("status") == "error")
                    })
                except Exception as exc:
                    row.update({"valid": False, "predicted_alert": None,
                                "error": f"{type(exc).__name__}: {exc}",
                                "tool_trace": tools.used,
                                "tool_call_count": len(tools.used),
                                "tool_error_count": sum(1 for t in tools.used if t.get("status") == "error")})
                row["latency_seconds"] = round(time.perf_counter() - started, 3)
                stream.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
                stream.flush()
                print(f'{model} {case_id} valid={row["valid"]} tools={row["tool_call_count"]} '
                      f'errors={row["tool_error_count"]} latency={row["latency_seconds"]}s', flush=True)


def score(outdir, truth_path, selected):
    # This function is intentionally called ONLY AFTER all inference files are closed.
    truth = {r["case_id"]: r for r in load_jsonl(truth_path)}
    expected = {c["case_id"] for c in selected}
    if not expected.issubset(truth):
        raise ValueError("Ground truth is missing selected case IDs")
    config = json.loads((outdir / "experiment_configuration.json").read_text(encoding="utf-8"))
    metrics = []
    for model in config["models"]:
        safe_name = model.replace(":", "_").replace("/", "_")
        path = outdir / f"predictions_{safe_name}.jsonl"
        rows = load_jsonl(path)
        if {r["case_id"] for r in rows} != expected or len(rows) != len(expected):
            raise ValueError(f"Missing or duplicate prediction rows for {model}")
        tp = tn = fp = fn = invalid = 0
        for row in rows:
            pred = row.get("predicted_alert")
            actual = truth[row["case_id"]]["anomaly"]
            if type(pred) is not bool:
                invalid += 1
            elif pred and actual: tp += 1
            elif pred and not actual: fp += 1
            elif not pred and actual: fn += 1
            else: tn += 1
        covered = tp + tn + fp + fn
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        acc = (tp + tn) / len(rows)
        metrics.append({
            "model": model, "n": len(rows), "tp": tp, "tn": tn, "fp": fp, "fn": fn,
            "invalid": invalid, "coverage": covered / len(rows),
            "accuracy_all": acc,
            "accuracy_covered": ((tp + tn) / covered) if covered else None,
            "precision": p, "recall": r,
            "f1": (2 * p * r / (p + r)) if p + r else 0.0,
            "mean_latency_seconds": round(sum(x["latency_seconds"] for x in rows) / len(rows), 3),
            "tool_errors": sum(x["tool_error_count"] for x in rows),
            "passes_gt_85": bool(acc > 0.85),
            "scope": "pilot" if len(rows) < 600 else "dataset-v4-sensor-case"
        })
    keys = list(metrics[0])
    with (outdir / "anomaly_model_comparison.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=keys)
        writer.writeheader()
        writer.writerows(metrics)
    (outdir / "anomaly_model_comparison.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cases", default=str(ROOT / "outputs/prepared/anomaly_inputs.jsonl"))
    p.add_argument("--keys", default=str(ROOT / "outputs/prepared/anomaly_truth_PRIVATE.jsonl"))
    p.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    p.add_argument("--limit", type=int, default=12, help="12 = pilot; 0 = all prepared cases")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--prompt", choices=["baseline", "concise", "fewshot"], default="concise")
    p.add_argument("--timeout", type=int, default=240)
    p.add_argument("--run-id", required=True, help="Unique name to avoid overwriting results")
    p.add_argument("--score-only", action="store_true")
    args = p.parse_args()
    if not args.run_id.replace("-", "").replace("_", "").isalnum():
        p.error("run-id may contain only letters, numbers, _ and -")
    outdir = ROOT / "outputs" / "model_selection" / args.run_id
    selected = select_cases(load_jsonl(args.cases), args.limit, args.seed)
    if args.score_only:
        if not (outdir / "experiment_configuration.json").exists():
            p.error("No completed inference found in this run-id")
        frozen = json.loads((outdir / "experiment_configuration.json").read_text(encoding="utf-8"))
        if frozen["cases"] != [c["case_id"] for c in selected] or frozen["models"] != args.models:
            p.error("Score-only case/model configuration does not match saved inference")
    else:
        if outdir.exists():
            p.error("Run directory already exists. Choose a new --run-id")
        run_inference(args, selected, outdir)
    result = score(outdir, args.keys, selected)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
