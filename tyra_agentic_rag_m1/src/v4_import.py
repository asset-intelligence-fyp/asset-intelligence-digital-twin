"""Adapter for Malaysian Digital Twin Dataset v4.

Streams yearly sensor_history.csv files directly into the local DuckDB database.
It NEVER reads ground-truth labels or hidden forecasting targets.

Run: python -m src.v4_import inspect --dataset /absolute/path
     python -m src.v4_import import --dataset /absolute/path --replace ...
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from .db import db_connect, qid, sensors

YEARLY = Path("generated/nasa_weather_by_year")
EVAL2026 = Path("generated/anomaly_eval_2026_q1_llm_inputs/sensor_history.csv")


def find_sources(root: Path, include_2026: bool) -> list[Path]:
    base = root / YEARLY
    files = [base / str(y) / "sensor_history.csv" for y in range(2019, 2026)]
    missing = [str(p) for p in files if not p.is_file()]
    if missing:
        raise FileNotFoundError("Missing yearly sensor files:\n" + "\n".join(missing))
    if include_2026:
        p = root / EVAL2026
        if not p.is_file():
            raise FileNotFoundError(f"Missing 2026 inference sensor file: {p}")
        files.append(p)
    return files


def headers(path: Path) -> list[str]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        row = next(csv.reader(handle), None)
    if not row:
        raise ValueError(f"Missing CSV header: {path}")
    return [c.strip().lstrip("\ufeff") for c in row]


def describe(root: Path) -> None:
    files = find_sources(root, include_2026=True)
    others = [
        root / "generated/llm_reference_visible/sensor_registry.csv",
        root / "generated/llm_reference_visible/room_metadata.csv",
        root / "generated/llm_reference_visible/forecast_cases_history_VISIBLE.csv",
        root / "generated/llm_reference_visible/forecast_cases_future_known_VISIBLE.csv",
        root / "generated/anomaly_eval_2026_q1_evaluation_keys/ground_truth_events.csv",
        root / "generated/anomaly_eval_2026_q1_evaluation_keys/ground_truth_labels.csv",
        root / "generated/llm_reference_hidden/forecast_90day_targets_HIDDEN.csv",
    ]
    for p in files + others:
        if not p.exists():
            print(f"MISSING  {p.relative_to(root)}")
            continue
        h = headers(p)
        example_time = None
        if p in files:
            with p.open("r", newline="", encoding="utf-8-sig") as fh:
                row = next(csv.DictReader(fh), None)
                if row:
                    for candidate in ("timestamp", "datetime", "time", "timestamp_utc", "datetime_local"):
                        if candidate in row:
                            example_time = row[candidate]
                            break
        print(json.dumps({"path": str(p.relative_to(root)),
                          "size_mb": round(p.stat().st_size/1_048_576, 1),
                          "columns": h, "sample_timestamp": example_time}))
    print("\nInspect column names above. Do NOT import ground-truth or *_HIDDEN.csv files.")


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def timestamp_sql(name: str, mode: str) -> str:
    v = f"NULLIF(TRIM({qid(name)}), '')"
    if mode == "as-written":
        return f"TRY_CAST({v} AS TIMESTAMP)"
    if mode == "malaysia-local":
        return f"TRY_CAST({v} AS TIMESTAMP) - INTERVAL '8 hours'"
    if mode == "offset-aware":
        return f"(TRY_CAST({v} AS TIMESTAMPTZ) AT TIME ZONE 'UTC')"
    raise ValueError(f"Unknown time mode: {mode}")


def import_data(args) -> dict:
    root = Path(args.dataset).expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(root)
    files = find_sources(root, args.include_2026)
    if not args.replace:
        raise ValueError("Import replaces the current readings table. Pass --replace to confirm.")
    if args.format == "wide" and not args.wide_sensors:
        raise ValueError("Wide format REQUIRES an explicit --wide-sensors list. Never infer numeric columns.")

    bad = ("anomal", "label", "fault", "inject", "truth", "event_id", "severity", "future")
    names = args.wide_sensors if args.format == "wide" else [args.value_col]
    if any(any(tag in name.lower() for tag in bad) for name in names):
        raise ValueError(f"Refusing potentially labeled/future column: {names}")

    required = [args.timestamp_col]
    if args.zone_col:
        required.append(args.zone_col)
    if args.format == "long":
        required.extend((args.sensor_col, args.value_col))
    else:
        required.extend(args.wide_sensors)
    for p in files:
        missing = sorted(set(required) - set(headers(p)))
        if missing:
            raise ValueError(
                f"{p.relative_to(root)} lacks {missing}. "
                f"Columns are: {headers(p)}. Run `inspect` first and supply exact names."
            )

    con = db_connect(False)
    try:
        # No hidden data, future targets, fault labels, or maintenance outcome metadata.
        con.execute("DROP TABLE IF EXISTS readings_v4_stage")
        con.execute("""CREATE TABLE readings_v4_stage (
            timestamp TIMESTAMP, sensor_id VARCHAR, zone_id VARCHAR, value DOUBLE
        )""")
        for idx, path in enumerate(files, 1):
            src = f"read_csv('{sql_path(path)}', header=true, all_varchar=true)"
            t = timestamp_sql(args.timestamp_col, args.time_mode)
            zone = (f"COALESCE(NULLIF(TRIM({qid(args.zone_col)}), ''), 'building')"
                    if args.zone_col else "'building'")
            if args.format == "long":
                metric = f"NULLIF(TRIM({qid(args.sensor_col)}), '')"
                val = f"TRY_CAST(NULLIF(TRIM({qid(args.value_col)}), '') AS DOUBLE)"
                source_rows = f"SELECT {t} AS timestamp, {zone} AS zone_id, {metric} AS metric, {val} AS value FROM {src}"
            else:
                selected = ', '.join(qid(c) for c in args.wide_sensors)
                # The UNPIVOT preserves remaining columns, including timestamp and zone.
                val = "TRY_CAST(NULLIF(TRIM(raw_value), '') AS DOUBLE)"
                source_rows = (f"SELECT {t} AS timestamp, {zone} AS zone_id, "
                               f"metric, {val} AS value "
                               f"FROM (UNPIVOT (SELECT * FROM {src}) ON {selected} "
                               f"INTO NAME metric VALUE raw_value)")
            if args.id_strategy == "zone":
                ident = "zone_id || '::' || metric"
            else:
                ident = "metric"
            query = (f"INSERT INTO readings_v4_stage "
                     f"SELECT timestamp, {ident} AS sensor_id, zone_id, value "
                     f"FROM ({source_rows}) r "
                     f"WHERE timestamp IS NOT NULL AND metric IS NOT NULL "
                     f"AND value IS NOT NULL AND isfinite(value)")
            con.execute(query)
            print(f"[{idx}/{len(files)}] Loaded {path.relative_to(root)}", flush=True)

        dup = con.execute("""SELECT sensor_id, timestamp, COUNT(*) n FROM readings_v4_stage
            GROUP BY sensor_id, timestamp HAVING COUNT(*) > 1 LIMIT 3""").fetchall()
        if dup:
            raise ValueError(
                f"Duplicate (sensor_id, timestamp) records; sample: {dup}. "
                "If different zones share sensor IDs, rerun with --id-strategy zone. "
                "Otherwise check duplicate data or conflicting files."
            )
        count, first, last, ns = con.execute("""SELECT COUNT(*), MIN(timestamp),
            MAX(timestamp), COUNT(DISTINCT sensor_id) FROM readings_v4_stage""").fetchone()
        if not count:
            raise ValueError("Import produced zero valid numeric observations. Check --format, columns and timestamps.")
        con.execute("BEGIN TRANSACTION")
        try:
            con.execute("DROP TABLE IF EXISTS readings")
            con.execute("ALTER TABLE readings_v4_stage RENAME TO readings")
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        return {
            "rows":count,"sensors":ns,"first_utc_naive":str(first),
            "last_utc_naive":str(last),"sources":len(files),
            "time_mode":args.time_mode,"id_strategy":args.id_strategy,
            "warning":"Import only includes sensor_history.csv, never hidden data. "
                      "Evaluation labels must use exactly the same timestamp convention and sensor IDs."
        }
    finally:
        con.close()


def main():
    p = argparse.ArgumentParser(description="Dataset v4 -> local Agentic RAG DuckDB")
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("inspect", help="Print headers without reading entire CSV files")
    a.add_argument("--dataset", required=True)
    b = sub.add_parser("import", help="Append 2019-2025 yearly histories and optional 2026 into one DB")
    b.add_argument("--dataset", required=True)
    b.add_argument("--include-2026", action="store_true")
    b.add_argument("--replace", action="store_true", help="Confirm replacing existing readings database table")
    b.add_argument("--format", choices=["long","wide"], required=True)
    b.add_argument("--timestamp-col", default="timestamp")
    b.add_argument("--sensor-col", default="sensor_id")
    b.add_argument("--value-col", default="value")
    b.add_argument("--zone-col", default=None)
    b.add_argument("--wide-sensors", nargs="+")
    b.add_argument("--id-strategy", choices=["preserve","zone"], default="preserve")
    b.add_argument("--time-mode", choices=["as-written","malaysia-local","offset-aware"],
                   default="as-written")
    args = p.parse_args()
    root = Path(args.dataset).expanduser().resolve()
    if args.command == "inspect":
        describe(root)
    else:
        print(json.dumps(import_data(args), indent=2))

if __name__ == "__main__":
    main()
