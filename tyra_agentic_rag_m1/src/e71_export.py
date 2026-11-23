"""Export E7.1 screening, review, strict-support decisions and evidence audit.

No ground truth is read. Existing point-level evaluator remains separate.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def export_channels(src: str | Path, out_dir: str | Path | None = None) -> dict:
    src = Path(src)
    if not src.is_file():
        raise FileNotFoundError(src)
    dest = Path(out_dir) if out_dir else src.parent
    dest.mkdir(parents=True, exist_ok=True)
    names = ("screening", "review", "supported")
    paths = {channel: dest / f"{src.stem}_{channel}.jsonl" for channel in names}
    audit = dest / f"{src.stem}_audit.csv"
    if src.resolve() in {p.resolve() for p in paths.values()}:
        raise ValueError("Cannot export a channel as the full E7.1 input")
    outs = {name: path.open("w", encoding="utf-8") for name, path in paths.items()}
    n = 0
    counts = Counter()
    try:
        with src.open(encoding="utf-8") as f, audit.open("w", newline="", encoding="utf-8") as af:
            fields = ["origin", "sensor_id", "screening_source", "context_enabled", "retrieval_budget",
                      "screening_status", "review_status", "supported_status",
                      "evidence_status", "context_available", "context_kinds", "llm_planned_tools",
                      "fallback_tools", "llm_calls", "latency_ms"]
            writer = csv.DictWriter(af, fieldnames=fields)
            writer.writeheader()
            for line in f:
                if not line.strip():
                    continue
                r = json.loads(line)
                if r.get("method") != "e71":
                    raise ValueError(f"Record {n+1}: expected method='e71'; got {r.get('method')}")
                first = r.get("screening") or r.get("answer") or {}
                rev = r.get("review") or {}
                statuses = {"screening": first.get("status", "unknown"),
                            "review": r.get("review_status", "unknown"),
                            "supported": r.get("supported_status", "unknown")}
                for channel, status in statuses.items():
                    status = status if status in ("normal", "suspect", "anomaly", "unknown") else "unknown"
                    decision = first if channel == "screening" else {
                        "status": status, "explanation": rev.get("explanation", ""),
                        "evidence_timestamps": [f["detail"]["timestamp"] for f in
                         r.get("validation", {}).get("factual_evidence", [])
                         if "timestamp" in f.get("detail", {})],
                    }
                    record = {"method": f"e71_{channel}", "task": r.get("task"),
                              "origin": r.get("origin"), "sensor_id": r.get("sensor_id"),
                              "model": r.get("model"), "channel": channel,
                              "answer": {**decision, "status": status},
                              "valid": bool(r.get("valid", False)), "error": r.get("error"),
                              "latency_ms": r.get("latency_ms"), "llm_calls": r.get("llm_calls")}
                    outs[channel].write(json.dumps(record, ensure_ascii=False, default=str)+"\n")
                    counts[(channel, status)] += 1
                trace = r.get("trace") or []
                context = r.get("operational_context") or {}
                writer.writerow({"origin": r.get("origin"), "sensor_id": r.get("sensor_id"),
                    "screening_source": r.get("screening_source"),
                    "context_enabled": r.get("context_enabled"),
                    "retrieval_budget": r.get("retrieval_budget"),
                    **{f"{k}_status": v for k, v in statuses.items()},
                    "evidence_status": r.get("evidence_status"),
                    "context_available": bool(context.get("available")),
                    "context_kinds": ";".join(sorted({str(x.get("kind")) for x in context.get("observations", [])})),
                    "llm_planned_tools": ";".join(t.get("tool", "") for t in trace if t.get("source")=="LLM_selected"),
                    "fallback_tools": ";".join(t.get("tool", "") for t in trace if "fallback" in t.get("source", "")),
                    "llm_calls": r.get("llm_calls"), "latency_ms": r.get("latency_ms")})
                n += 1
    finally:
        for o in outs.values():
            o.close()
    return {"records": n, "files": {k: str(v) for k, v in paths.items()},
            "audit": str(audit), "status_counts": {f"{k[0]}:{k[1]}": v for k, v in counts.items()}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export E7.1's three decision channels and audit CSV")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()
    print(json.dumps(export_channels(args.input, args.out_dir), indent=2))


if __name__ == "__main__":
    main()
