-- Isolated, additive schema. No existing project tables are dropped or renamed.
CREATE SCHEMA IF NOT EXISTS twin18;
CREATE TABLE IF NOT EXISTS twin18.sensor_registry (
 point_code TEXT PRIMARY KEY, simulator_room_id TEXT NOT NULL,
 ifc_sensor_id TEXT NOT NULL UNIQUE, ifc_global_id TEXT NOT NULL UNIQUE,
 location_code TEXT NOT NULL, floor_level TEXT NOT NULL,
 measurement_type TEXT NOT NULL, unit TEXT NOT NULL,
 mapping_status TEXT NOT NULL DEFAULT 'demonstration_alias'
);
CREATE TABLE IF NOT EXISTS twin18.sensor_readings (
 point_code TEXT NOT NULL REFERENCES twin18.sensor_registry(point_code),
 reading_timestamp TIMESTAMPTZ NOT NULL, reading_value DOUBLE PRECISION NOT NULL,
 quality TEXT NOT NULL, PRIMARY KEY(point_code,reading_timestamp)
);
CREATE INDEX IF NOT EXISTS twin18_reading_time ON twin18.sensor_readings(reading_timestamp DESC);
