"""Export E7's separate screening/verified channels for the existing evaluator.

No labels are read. This script only reformats E7 inference JSONL records.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def export_channels(src: str | Path, output_dir: str | Path | None = None) -> tuple[Path, Path, int]:
    src = Path(src)
    if not src.is_file():
        raise FileNotFoundError(src)
    outdir = Path(output_dir) if output_dir else src.parent
    outdir.mkdir(parents=True, exist_ok=True)
    screening_file = outdir / f"{src.stem}_screening.jsonl"
    verified_file = outdir / f"{src.stem}_verified.jsonl"
    if src.resolve() in {screening_file.resolve(), verified_file.resolve()}:
        raise ValueError("E7 input file cannot be an exported channel")
    n = 0
    with (src.open(encoding="utf-8") as inp,
          screening_file.open("w", encoding="utf-8") as first,
          verified_file.open("w", encoding="utf-8") as second):
        for line in inp:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("method") != "e7":
                raise ValueError(f"Expected method='e7' in record {n+1}")
            initial = r.get("screening") or r.get("answer") or {}
            final_status = r.get("verified_status", "unknown")
            if final_status not in {"normal", "suspect", "anomaly", "unknown"}:
                final_status = "unknown"
            first_record = {**r, "method": "e7_screening", "channel": "screening",
                            "answer": initial, "valid": bool(r.get("valid", False))}
            verified_record = {**r, "method": "e7_verified", "channel": "verified",
                               "answer": {
                                   "status": final_status,
                                   "explanation": (r.get("verification") or {}).get("explanation", ""),
                                   "evidence_timestamps": [
                                       e["timestamp"] for e in
                                       (r.get("validation") or {}).get("grounded_observations", [])
                                   ],
                               },
                               "valid": bool(r.get("valid", False))}
            first.write(json.dumps(first_record, ensure_ascii=False, default=str) + "\n")
            second.write(json.dumps(verified_record, ensure_ascii=False, default=str) + "\n")
            n += 1
    return screening_file, verified_file, n


def main():
    parser = argparse.ArgumentParser(description="Export both E7 decision channels")
    parser.add_argument("--input", required=True, help="Raw E7 JSONL")
    parser.add_argument("--out-dir", default=None, help="Destination for screening and verified files")
    args = parser.parse_args()
    a, b, n = export_channels(args.input, args.out_dir)
    print(f"Wrote {n} records per channel:\n  SCREENING: {a}\n  VERIFIED:  {b}")
    print("Evaluate BOTH files against labels. Do not count 'unknown' as correct normal.")


if __name__ == "__main__":
    main()
