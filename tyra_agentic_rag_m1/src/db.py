"""DuckDB ingestion and safe raw time-series access. NO anomaly labels in this DB."""
from __future__ import annotations
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
import duckdb
from .config import SETTINGS, root_path


def qid(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def db_connect(read_only: bool = True, db_path: str | Path | None = None):
    path = root_path(db_path) if db_path else SETTINGS.db_path
    if not read_only:
        path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path), read_only=read_only)
    con.execute("SET threads=2")
    if not read_only:
        (path.parent / "tmp").mkdir(parents=True, exist_ok=True)
        con.execute("SET memory_limit='3GB'")
        con.execute(f"SET temp_directory='{str(path.parent / 'tmp').replace(chr(39), chr(39)*2)}'")
    return con


def ingest(csv_path: str, fmt: str = "long", timestamp_col: str = "timestamp",
           sensor_col: str = "sensor_id", value_col: str = "value",
           zone_col: str | None = None, db_path: str | None = None,
           wide_sensors: list[str] | None = None) -> dict[str, Any]:
    src_path = root_path(csv_path)
    if not src_path.is_file():
        raise FileNotFoundError(src_path)
    if src_path.suffix.lower() not in (".csv", ".tsv"):
        raise ValueError("This installer accepts CSV/TSV; convert other input formats first")
    con = db_connect(False, db_path)
    try:
        # DuckDB CREATE VIEW is not always preparable with a parameterized
        # table function; quote the trusted filesystem path as SQL data.
        safe_path = str(src_path).replace("'", "''")
        con.execute(f"CREATE OR REPLACE TEMP VIEW src AS SELECT * FROM read_csv('{safe_path}', all_varchar=true, header=true)")
        columns = [r[0] for r in con.execute("DESCRIBE src").fetchall()]
        required = [timestamp_col] + ([sensor_col, value_col] if fmt == "long" else (wide_sensors or []))
        missing = [c for c in required if c not in columns]
        if missing:
            raise ValueError(f"Missing CSV columns: {missing}. Found: {columns}")
        if zone_col and zone_col not in columns:
            raise ValueError(f"Missing zone column: {zone_col}")
        zone = f"COALESCE(NULLIF({qid(zone_col)}, ''), 'building')" if zone_col else "'building'"
        if fmt == "long":
            rows = f"SELECT TRY_CAST({qid(timestamp_col)} AS TIMESTAMP) AS timestamp, " \
                   f"CAST({qid(sensor_col)} AS VARCHAR) AS sensor_id, " \
                   f"CAST({zone} AS VARCHAR) AS zone_id, " \
                   f"TRY_CAST({qid(value_col)} AS DOUBLE) AS value FROM src"
        elif fmt == "wide":
            # FAIL CLOSED: wide input frequently contains hidden anomaly-label
            # columns. Never infer sensor columns automatically.
            if not wide_sensors:
                raise ValueError("Wide CSV requires explicit --wide-sensors names; do not include label/fault columns")
            sensors = wide_sensors
            if any(s not in columns for s in sensors):
                raise ValueError("Unknown sensor column in --wide-sensors")
            forbidden = ("label", "fault", "anomal", "inject", "ground_truth", "event_id", "severity")
            if any(any(t in s.lower() for t in forbidden) for s in sensors):
                raise ValueError("Potentially labeled/fault-annotated field selected as sensor. Remove it")
            # The UNPIVOT input retains timestamp and optional zone columns.
            sensor_list = ", ".join(qid(c) for c in sensors)
            rows = (f"SELECT TRY_CAST({qid(timestamp_col)} AS TIMESTAMP) AS timestamp, "
                    f"sensor_id, CAST({zone} AS VARCHAR) AS zone_id, "
                    f"TRY_CAST(value_text AS DOUBLE) AS value FROM ("
                    f"UNPIVOT src ON {sensor_list} INTO NAME sensor_id VALUE value_text)")
        else:
            raise ValueError("--format must be long or wide")
        con.execute("DROP TABLE IF EXISTS readings")
        # NULL readings do not become invented/interpolated sensor values.
        con.execute(f"""CREATE TABLE readings AS
             SELECT timestamp, sensor_id, zone_id, value
             FROM ({rows}) t
             WHERE timestamp IS NOT NULL AND sensor_id IS NOT NULL
               AND sensor_id <> '' AND value IS NOT NULL AND isfinite(value)
             ORDER BY sensor_id, timestamp""")
        n = con.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        dups = con.execute("""SELECT COUNT(*) FROM (
             SELECT sensor_id, timestamp FROM readings
             GROUP BY 1, 2 HAVING COUNT(*) > 1)""").fetchone()[0]
        if dups:
            con.execute("DROP TABLE readings")
            raise ValueError(f"{dups} duplicate (sensor_id,timestamp) pairs. Fix input; nothing silently merged.")
        sensors = con.execute("SELECT COUNT(DISTINCT sensor_id) FROM readings").fetchone()[0]
        limits = con.execute("SELECT MIN(timestamp), MAX(timestamp) FROM readings").fetchone()
        return {"rows": n, "sensors": sensors, "first": str(limits[0]), "last": str(limits[1]),
                "note": "Timestamps are stored as UTC-naive. Normalize input timestamps to UTC before ingestion."}
    finally:
        con.close()


def sensors(db_path=None) -> list[dict]:
    con = db_connect(True, db_path)
    try:
        out = con.execute("""SELECT sensor_id, any_value(zone_id) zone_id,
                     MIN(timestamp) first_timestamp, MAX(timestamp) last_timestamp,
                     COUNT(*) reading_count FROM readings GROUP BY 1 ORDER BY 1""").fetchall()
        return [{"sensor_id":a,"zone_id":b,"first":str(c),"last":str(d),"count":e}
                for a,b,c,d,e in out]
    finally:
        con.close()


def valid_timestamp(ts: str | datetime) -> datetime:
    if isinstance(ts, datetime):
        dt = ts
    else:
        s = str(ts).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        from datetime import timezone
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"


def get_series(sensor_id: str, end: datetime | str, steps: int,
               db_path=None, start: datetime | None = None) -> list[dict]:
    if not 1 <= steps <= 600:
        raise ValueError("steps must be 1..600")
    end = valid_timestamp(end)
    start = start or (end - timedelta(minutes=5 * (steps - 1)))
    con = db_connect(True, db_path)
    try:
        rows = con.execute("""SELECT timestamp, value FROM readings
            WHERE sensor_id=? AND timestamp>=? AND timestamp<=?
            ORDER BY timestamp""", [sensor_id, start, end]).fetchall()
    finally:
        con.close()
    return [{"timestamp": stamp(t), "value": round(float(v), 5)} for t, v in rows]


def exact_value(sensor_id: str, timestamp: str | datetime, db_path=None):
    t = valid_timestamp(timestamp)
    con = db_connect(True, db_path)
    try:
        row = con.execute("SELECT value FROM readings WHERE sensor_id=? AND timestamp=?", [sensor_id,t]).fetchone()
    finally:
        con.close()
    return float(row[0]) if row else None
