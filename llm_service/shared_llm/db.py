"""SQLite schema for CSV-backed historical data. No user-controlled SQL."""
from __future__ import annotations
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_readings (
    dataset TEXT NOT NULL CHECK(dataset IN ('normal','fault')),
    timestamp TEXT NOT NULL, sensor_id TEXT NOT NULL,
    room_id TEXT NOT NULL, sensor_type TEXT NOT NULL,
    value REAL, unit TEXT, source TEXT, quality_flag TEXT,
    weekday INTEGER NOT NULL, minute_of_day INTEGER NOT NULL,
    PRIMARY KEY (dataset, timestamp, sensor_id)
);
CREATE INDEX IF NOT EXISTS idx_sensor_time ON sensor_readings(dataset,sensor_id,timestamp);
CREATE INDEX IF NOT EXISTS idx_room_time ON sensor_readings(dataset,room_id,timestamp);
CREATE INDEX IF NOT EXISTS idx_comparable ON sensor_readings(dataset,sensor_id,weekday,minute_of_day,timestamp);
CREATE TABLE IF NOT EXISTS room_features (
    dataset TEXT NOT NULL, timestamp TEXT NOT NULL, room_id TEXT NOT NULL,
    temperature REAL, co2 REAL, humidity REAL, light REAL, pir REAL,
    power_kw REAL, power_scope TEXT, headcount INTEGER, occupancy_ratio REAL,
    outdoor_temp_c REAL, outdoor_humidity_pct REAL, rainfall_mm_per_h REAL,
    ac_on INTEGER, setpoint_c REAL, ventilation_level TEXT,
    is_meeting_booked INTEGER, is_holiday INTEGER, expected_attendance_factor REAL,
    max_capacity INTEGER, split TEXT,
    PRIMARY KEY(dataset,timestamp,room_id)
);
CREATE INDEX IF NOT EXISTS idx_features_room_time ON room_features(dataset,room_id,timestamp);
CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY, room_name TEXT, room_type TEXT, area_m2 REAL,
    ceiling_height_m REAL, max_capacity INTEGER, seat_count INTEGER,
    window_orientation TEXT, has_window INTEGER, ac_zone_id TEXT
);
CREATE TABLE IF NOT EXISTS calendar (
    dataset TEXT NOT NULL, date TEXT NOT NULL, day_of_week INTEGER,
    is_workday INTEGER, is_public_holiday INTEGER, holiday_name TEXT,
    expected_attendance_factor REAL, PRIMARY KEY(dataset,date)
);
CREATE TABLE IF NOT EXISTS bookings (
    dataset TEXT NOT NULL, booking_id TEXT NOT NULL, room_id TEXT NOT NULL,
    start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    attendee_count_planned INTEGER, attendee_count_actual INTEGER,
    meeting_type TEXT, status TEXT,
    PRIMARY KEY(dataset,booking_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_time ON bookings(dataset,room_id,start_time,end_time);
CREATE TABLE IF NOT EXISTS maintenance (
    dataset TEXT NOT NULL, log_id TEXT NOT NULL, timestamp TEXT NOT NULL,
    room_id TEXT, ac_zone_id TEXT, action TEXT, notes TEXT,
    PRIMARY KEY(dataset,log_id)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_room ON maintenance(dataset,room_id,timestamp);
CREATE TABLE IF NOT EXISTS headcount (
    dataset TEXT NOT NULL, timestamp TEXT NOT NULL, room_id TEXT NOT NULL,
    headcount INTEGER NOT NULL, occupancy_ratio REAL,
    PRIMARY KEY(dataset,timestamp,room_id)
);
CREATE INDEX IF NOT EXISTS idx_headcount_room ON headcount(dataset,room_id,timestamp);
CREATE TABLE IF NOT EXISTS imports (
    dataset TEXT NOT NULL, source_path TEXT NOT NULL, table_name TEXT NOT NULL,
    row_count INTEGER NOT NULL, imported_at TEXT NOT NULL,
    PRIMARY KEY(dataset,source_path,table_name)
);
"""

class ClosingConnection(sqlite3.Connection):
    """Commit/rollback and release file handles on context exit (Windows-safe)."""
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect(path: str | Path, *, readonly: bool = False) -> sqlite3.Connection:
    path = Path(path).expanduser().resolve()
    if not readonly:
        path.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        if not path.is_file():
            raise FileNotFoundError(f"Database missing: {path}. Run the ingest command first.")
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=30, factory=ClosingConnection)
    else:
        db = sqlite3.connect(str(path), timeout=30, factory=ClosingConnection)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        db.executescript(SCHEMA)
    db.row_factory = sqlite3.Row
    return db
