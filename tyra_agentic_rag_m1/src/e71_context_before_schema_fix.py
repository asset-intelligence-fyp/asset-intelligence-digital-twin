"""E7.1 causal, unlabeled operational-context index (SQLite; Python stdlib).

Only allowlisted, inference-visible CSV filenames/columns are considered.
The index is independent of the sensor readings DuckDB and ground-truth files.
Each context lookup enforces a fixed prediction cutoff and exact room/zone match.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT

CONTEXT_NAMES = {
    "hvac": {"hvac_state.csv", "hvac_states.csv", "hvac_5min.csv", "hvac_history.csv"},
    "occupancy": {"headcount.csv", "occupancy.csv", "occupancy_5min.csv", "room_occupancy.csv"},
    "weather": {"weather_5min.csv", "weather.csv", "outdoor_weather.csv"},
}
METADATA_NAMES = {"room_metadata.csv": "room", "sensor_registry.csv": "sensor"}
TIME_COLS = ("timestamp", "timestamp_utc", "datetime", "datetime_utc", "timestamp_local", "datetime_local", "time", "date_time")
ZONE_COLS = ("room_id", "zone_id", "room", "room_code", "room_name", "zone", "hvac_zone", "hvac_zone_id", "location_id")
ALLOWED_VALUES = {
    "hvac": {"hvac_state", "state", "mode", "operating_mode", "hvac_mode", "fan_state", "fan_speed", "compressor_state", "on_off", "enabled", "setpoint", "setpoint_c", "cooling_setpoint", "heating_setpoint", "supply_air_temp", "return_air_temp", "supply_air_temperature", "return_air_temperature", "valve_position", "damper_position"},
    "occupancy": {"headcount", "occupancy", "occupancy_count", "occupant_count", "people_count", "people", "occupied", "is_occupied", "pir", "pir_motion", "presence"},
    "weather": {"outdoor_temp", "outdoor_temperature", "temperature", "temp_c", "temperature_c", "humidity", "relative_humidity", "rh", "rainfall", "rainfall_mm", "solar", "solar_radiation", "wind_speed", "wind_speed_ms", "pressure"},
}
META_VALUES = {
    "room": {"room_type", "floor", "floor_number", "capacity", "area_m2", "hvac_zone", "building_id", "wing"},
    "sensor": {"sensor_type", "unit", "description", "equipment"},
}
FORBIDDEN_PATH_PARTS = ("hidden", "evaluation_keys", "ground_truth", "target", "labels", "fault", "inject", "event", "future", "forecast")
FORBIDDEN_FIELDS = ("label", "fault", "anomal", "injection", "ground_truth", "event", "severity", "future", "target", "actual")
DEFAULT_DB = PROJECT_ROOT / "data" / "e71_context.sqlite"


def _safe_context_path(root: Path, file: Path) -> bool:
    try:
        rel = file.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    components = [c.lower() for c in rel.parts]
    if not components or components[0] != "generated":
        return False
    return not any(any(bad in c for bad in FORBIDDEN_PATH_PARTS) for c in components)


def _pick(headers: list[str], candidates) -> str | None:
    names = {c.strip().lower(): c for c in headers}
    return next((names[x] for x in candidates if x in names), None)


def _headers(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [h.strip() for h in next(csv.reader(f), [])]


def discover(root: Path) -> list[dict[str, Any]]:
    root = root.expanduser().resolve()
    generated = root / "generated"
    if not generated.is_dir():
        raise NotADirectoryError(f"Expected dataset/generated: {generated}")
    result = []
    names = set(METADATA_NAMES)
    for group in CONTEXT_NAMES.values():
        names |= group
    for file in generated.rglob("*.csv"):
        if file.name.lower() not in names or not _safe_context_path(root, file):
            continue
        kind = next((k for k, v in CONTEXT_NAMES.items() if file.name.lower() in v), None)
        if kind is None:
            kind = METADATA_NAMES[file.name.lower()]
        headers = _headers(file)
        timestamp = _pick(headers, TIME_COLS) if kind in CONTEXT_NAMES else None
        zone = _pick(headers, ZONE_COLS)
        key = _pick(headers, ("sensor_id",)) if kind == "sensor" else zone
        chosen = META_VALUES[kind] if kind in META_VALUES else ALLOWED_VALUES[kind]
        values = [h for h in headers if h.lower() in chosen and not any(b in h.lower() for b in FORBIDDEN_FIELDS)]
        status = "ready" if values and ((kind in META_VALUES and key) or (timestamp and (kind == "weather" or zone))) else "unsupported_schema"
        result.append({"relative_path": str(file.relative_to(root)), "kind": kind,
                       "timestamp_col": timestamp, "zone_col": zone, "key_col": key,
                       "value_cols": values, "status": status})
    return sorted(result, key=lambda x: x["relative_path"])


def parse_timestamp(raw: str, column_name: str, naive_tz: str = "Asia/Kuching") -> str | None:
    """Convert offset-bearing times to UTC; naive local times are Asia/Kuching.

    An un-offset timestamp in a column named *utc* is treated as UTC.
    The assumption for other naive columns is stated in the ingestion summary.
    """
    try:
        d = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
        if d.tzinfo is None:
            if naive_tz not in ("UTC", "Asia/Kuching"):
                raise ValueError("naive_tz must be UTC or Asia/Kuching")
            d = d.replace(tzinfo=timezone.utc if "utc" in column_name.lower() or naive_tz == "UTC"
                                 else timezone(timedelta(hours=8)))
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return None


def _connect(db: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(db))
    return con


def build_index(dataset: Path, db: Path = DEFAULT_DB, naive_tz: str = "Asia/Kuching") -> dict[str, Any]:
    dataset = dataset.expanduser().resolve()
    db = db.expanduser().resolve()
    inventory = discover(dataset)
    db.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix="e71_build_", suffix=".sqlite", dir=db.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    summary: dict[str, Any] = {"rows_indexed": 0, "metadata_indexed": 0, "files": [],
                               "skipped": [], "assumption": f"Naive non-UTC timestamp columns interpreted as {naive_tz}"}
    try:
        with _connect(tmp) as con:
            con.executescript("""
            CREATE TABLE context_rows (kind TEXT NOT NULL, source TEXT NOT NULL, ts TEXT NOT NULL,
              zone TEXT NOT NULL, attribute TEXT NOT NULL, value_text TEXT NOT NULL,
              value_num REAL);
            CREATE TABLE metadata (kind TEXT NOT NULL, key TEXT NOT NULL,
              attribute TEXT NOT NULL, value_text TEXT NOT NULL, source TEXT NOT NULL);
            CREATE TABLE index_info (key TEXT PRIMARY KEY, value TEXT);
            """)
            buffer = []
            metadata_buffer = []
            for spec in inventory:
                if spec["status"] != "ready":
                    summary["skipped"].append({"path": spec["relative_path"], "reason": spec["status"]})
                    continue
                path = dataset / spec["relative_path"]
                n = 0
                with path.open("r", encoding="utf-8-sig", newline="") as f:
                    for row in csv.DictReader(f):
                        if spec["kind"] in META_VALUES:
                            key = str(row.get(spec["key_col"], "")).strip()
                            if not key:
                                continue
                            for attribute in spec["value_cols"]:
                                value = str(row.get(attribute, "")).strip()
                                if value:
                                    metadata_buffer.append((spec["kind"], key, attribute, value[:150], spec["relative_path"]))
                                    n += 1
                            if len(metadata_buffer) >= 3000:
                                con.executemany("INSERT INTO metadata VALUES (?,?,?,?,?)", metadata_buffer)
                                metadata_buffer.clear()
                        else:
                            ts = parse_timestamp(row.get(spec["timestamp_col"], ""), spec["timestamp_col"], naive_tz)
                            if ts is None:
                                continue
                            raw_zone = str(row.get(spec["zone_col"], "")).strip() if spec["zone_col"] else "*"
                            if spec["kind"] != "weather" and not raw_zone:
                                continue
                            zone = raw_zone if spec["kind"] != "weather" else "*"
                            for attribute in spec["value_cols"]:
                                value = str(row.get(attribute, "")).strip()
                                if not value or len(value) > 150:
                                    continue
                                try:
                                    val_num = float(value)
                                    if not math.isfinite(val_num):
                                        continue
                                except ValueError:
                                    val_num = None
                                buffer.append((spec["kind"], spec["relative_path"], ts, zone, attribute, value, val_num))
                                n += 1
                            if len(buffer) >= 5000:
                                con.executemany("INSERT INTO context_rows VALUES (?,?,?,?,?,?,?)", buffer)
                                buffer.clear()
                summary["files"].append({"path": spec["relative_path"], "kind": spec["kind"], "records": n})
                if spec["kind"] in META_VALUES:
                    summary["metadata_indexed"] += n
                else:
                    summary["rows_indexed"] += n
            if buffer:
                con.executemany("INSERT INTO context_rows VALUES (?,?,?,?,?,?,?)", buffer)
            if metadata_buffer:
                con.executemany("INSERT INTO metadata VALUES (?,?,?,?,?)", metadata_buffer)
            con.executescript("""
              CREATE INDEX by_context ON context_rows(kind, zone, ts DESC, attribute);
              CREATE INDEX by_metadata ON metadata(kind, key);
            """)
            for key, val in (("dataset_root", str(dataset)), ("naive_timezone", naive_tz)):
                con.execute("INSERT INTO index_info VALUES (?,?)", (key, val))
        os.replace(tmp, db)
    finally:
        if tmp.exists():
            tmp.unlink()
    summary["index_path"] = str(db)
    summary["inventory"] = inventory
    return summary


def retrieve_context(as_of: str, zone: str, sensor_id: str, db: Path = DEFAULT_DB) -> dict[str, Any]:
    """Read only the latest <= as_of contextual values, exact zone or global weather.

    HVAC/occupancy readings are not attributed across unmatched rooms.
    No values are imputed if a context stream is absent or stale.
    """
    from .e7_validation import utc_stamp
    cutoff = utc_stamp(as_of)
    db = Path(db).expanduser().resolve()
    result: dict[str, Any] = {"tool": "operational_context", "as_of": cutoff,
                              "zone_id": zone, "sensor_id": sensor_id,
                              "available": False, "observations": [], "metadata": [],
                              "warnings": [], "source_counts": {}}
    if not db.exists():
        result["warnings"].append("Context index missing. Run python -m src.e71_context build --dataset \"$DATASET\"")
        return result
    with _connect(db) as con:
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "context_rows" not in names or "metadata" not in names:
            result["warnings"].append("Context index schema invalid; rebuild with e71_context build")
            return result
        start = (datetime.fromisoformat(cutoff.replace("Z", "+00:00")) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Explicit room -> HVAC-zone join is allowed only if visible room metadata
        # names the mapping; otherwise do not transfer HVAC measurements across rooms.
        hvac_row = con.execute("SELECT value_text FROM metadata WHERE kind='room' AND key=? AND attribute='hvac_zone' LIMIT 1", (zone,)).fetchone()
        mapped_hvac_zone = hvac_row[0] if hvac_row else zone
        rows = con.execute("""SELECT kind, source, ts, zone, attribute, value_text, value_num
          FROM context_rows WHERE ts >= ? AND ts <= ? AND
          ((kind='weather' AND zone='*') OR
           (kind='occupancy' AND zone=?) OR
           (kind='hvac' AND zone IN (?,?)))
          ORDER BY ts DESC LIMIT 1500""", (start, cutoff, zone, zone, mapped_hvac_zone)).fetchall()
        if mapped_hvac_zone != zone:
            result["warnings"].append(f"Room metadata maps this room to HVAC zone {mapped_hvac_zone}; verify mapping validity at as-of")
        used = set()
        for kind, source, ts, row_zone, attr, value, num in rows:
            key = (kind, attr)
            if key in used:
                continue
            age_hours = (datetime.fromisoformat(cutoff.replace("Z", "+00:00")) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds()/3600
            max_age = 3.0 if kind == "weather" else 6.0
            if age_hours > max_age:
                continue
            used.add(key)
            result["observations"].append({"id": f"CTX{len(result['observations'])+1:04d}",
                 "kind": kind, "source": source, "timestamp": ts, "zone": row_zone,
                 "attribute": attr, "value": num if num is not None else value,
                 "age_hours": round(age_hours, 2)})
            result["source_counts"][kind] = result["source_counts"].get(kind, 0) + 1
            if len(result["observations"]) >= 16:
                break
        for kind, key in (("room", zone), ("sensor", sensor_id)):
            for attr, value, source in con.execute(
                "SELECT attribute, value_text, source FROM metadata WHERE kind=? AND key=? LIMIT 16", (kind, key)):
                result["metadata"].append({"kind": kind, "attribute": attr, "value": value, "source": source})
    result["available"] = bool(result["observations"] or result["metadata"])
    if not result["observations"]:
        result["warnings"].append("No recent matching HVAC/occupancy or weather rows (no cross-room substitution)")
    if result["metadata"]:
        result["warnings"].append("Static metadata assumed available at as-of; verify its temporal provenance")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="E7.1 allowlisted causal HVAC/occupancy/weather context index")
    sub = parser.add_subparsers(dest="command", required=True)
    i = sub.add_parser("inspect")
    i.add_argument("--dataset", required=True)
    b = sub.add_parser("build")
    b.add_argument("--dataset", required=True)
    b.add_argument("--db", default=str(DEFAULT_DB))
    b.add_argument("--naive-tz", choices=("Asia/Kuching", "UTC"), default="Asia/Kuching",
                   help="Timezone for naive timestamps not in *_utc columns")
    args = parser.parse_args()
    if args.command == "inspect":
        print(json.dumps(discover(Path(args.dataset)), indent=2))
    else:
        print(json.dumps(build_index(Path(args.dataset), Path(args.db), args.naive_tz), indent=2))


if __name__ == "__main__":
    main()
