-- Unified Digital Twin v3 — additive, non-destructive, rerunnable.
-- Canonical design: current 18-channel sensor registry/readings/monitoring locations,
-- plus unique v2 building/BIM/users/alerts concepts and new AI/forecast/simulation tables.
-- No public or twin18 tables or existing sensor history are changed.
-- Run via: npm run db:setup:v3  (schema + metadata seed).
BEGIN;
CREATE SCHEMA IF NOT EXISTS digital_twin;

CREATE TABLE IF NOT EXISTS digital_twin.buildings (
 building_code TEXT PRIMARY KEY, building_name TEXT NOT NULL, building_type TEXT NOT NULL,
 description TEXT
);
CREATE TABLE IF NOT EXISTS digital_twin.building_floors (
 building_code TEXT NOT NULL REFERENCES digital_twin.buildings(building_code),
 floor_level TEXT NOT NULL, PRIMARY KEY(building_code,floor_level)
);
CREATE TABLE IF NOT EXISTS digital_twin.bim_models (
 building_code TEXT PRIMARY KEY REFERENCES digital_twin.buildings(building_code),
 model_name TEXT NOT NULL, file_reference TEXT NOT NULL, model_version TEXT
);
CREATE TABLE IF NOT EXISTS digital_twin.bim_elements (
 global_id TEXT PRIMARY KEY,
 building_code TEXT NOT NULL REFERENCES digital_twin.buildings(building_code),
 element_type TEXT NOT NULL DEFAULT 'Sensor'
);
-- Canonical website location codes (L02-OPEN, L03-MEET, etc.);
-- keep original simulator aliases in sensor_registry, not as duplicate locations.
CREATE TABLE IF NOT EXISTS digital_twin.monitoring_locations (
 location_code TEXT PRIMARY KEY, display_name TEXT NOT NULL, floor_level TEXT NOT NULL,
 building_code TEXT REFERENCES digital_twin.buildings(building_code),
 FOREIGN KEY(building_code,floor_level)
  REFERENCES digital_twin.building_floors(building_code,floor_level)
);
CREATE TABLE IF NOT EXISTS digital_twin.sensor_registry (
 point_code TEXT PRIMARY KEY, simulator_room_id TEXT NOT NULL,
 ifc_sensor_id TEXT NOT NULL UNIQUE, ifc_global_id TEXT NOT NULL UNIQUE,
 location_code TEXT NOT NULL REFERENCES digital_twin.monitoring_locations(location_code),
 floor_level TEXT NOT NULL, measurement_type TEXT NOT NULL, unit TEXT NOT NULL,
 mapping_status TEXT NOT NULL DEFAULT 'demonstration_alias'
);
CREATE INDEX IF NOT EXISTS v3_registry_location ON digital_twin.sensor_registry(location_code);

CREATE TABLE IF NOT EXISTS digital_twin.simulation_runs (
 replay_id TEXT PRIMARY KEY,
 producer TEXT, dataset_name TEXT, dataset_version TEXT, random_seed BIGINT,
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 notes TEXT
);
-- Compatible with current sensorServer.js ingestion; replay_id intentionally not
-- FK constrained because the current producer does not register simulation_runs yet.
CREATE TABLE IF NOT EXISTS digital_twin.sensor_readings (
 point_code TEXT NOT NULL REFERENCES digital_twin.sensor_registry(point_code),
 reading_timestamp TIMESTAMPTZ NOT NULL, reading_value DOUBLE PRECISION,
 quality TEXT NOT NULL, replay_id TEXT,
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(point_code,reading_timestamp)
);
CREATE INDEX IF NOT EXISTS v3_readings_time ON digital_twin.sensor_readings(reading_timestamp DESC);
CREATE INDEX IF NOT EXISTS v3_readings_replay_time ON digital_twin.sensor_readings(replay_id,reading_timestamp DESC);
CREATE INDEX IF NOT EXISTS v3_readings_received_at ON digital_twin.sensor_readings(received_at DESC);

CREATE TABLE IF NOT EXISTS digital_twin.roles (
 role_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 role_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS digital_twin.users (
 user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 role_id BIGINT NOT NULL REFERENCES digital_twin.roles(role_id),
 username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Current local admin hash/session still uses .env; users above are for future integration.

CREATE TABLE IF NOT EXISTS digital_twin.ai_results (
 ai_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 point_code TEXT NOT NULL REFERENCES digital_twin.sensor_registry(point_code),
 observation_timestamp TIMESTAMPTZ NOT NULL,
 prediction TEXT NOT NULL CHECK(prediction IN ('Normal','Abnormal','Unknown')),
 anomaly_score DOUBLE PRECISION CHECK(anomaly_score BETWEEN 0 AND 1),
 description TEXT, model_name TEXT, model_version TEXT,
 replay_id TEXT, reasoning JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v3_ai_point_time ON digital_twin.ai_results(point_code,observation_timestamp DESC);
-- Do not FK directly to raw readings: an analysis may span a historical window,
-- and long-term retention can remove raw points without deleting AI audit records.
CREATE TABLE IF NOT EXISTS digital_twin.forecast_results (
 forecast_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 point_code TEXT NOT NULL REFERENCES digital_twin.sensor_registry(point_code),
 predicted_at TIMESTAMPTZ NOT NULL, target_timestamp TIMESTAMPTZ NOT NULL,
 predicted_value DOUBLE PRECISION, lower_bound DOUBLE PRECISION,
 upper_bound DOUBLE PRECISION, unit TEXT,
 model_name TEXT, model_version TEXT, replay_id TEXT,
 explanation TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(target_timestamp>predicted_at),
 CHECK(lower_bound IS NULL OR upper_bound IS NULL OR lower_bound<=upper_bound)
);
CREATE INDEX IF NOT EXISTS v3_forecast_point_target ON digital_twin.forecast_results(point_code,target_timestamp DESC);
CREATE TABLE IF NOT EXISTS digital_twin.alert_severity (
 alert_severity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 severity_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS digital_twin.alert_status (
 alert_status_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 status_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS digital_twin.alerts (
 alert_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ai_result_id BIGINT REFERENCES digital_twin.ai_results(ai_result_id),
 point_code TEXT REFERENCES digital_twin.sensor_registry(point_code),
 alert_severity_id BIGINT NOT NULL REFERENCES digital_twin.alert_severity(alert_severity_id),
 alert_status_id BIGINT NOT NULL REFERENCES digital_twin.alert_status(alert_status_id),
 alert_type TEXT NOT NULL, message TEXT NOT NULL,
 triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS v3_alert_status_time ON digital_twin.alerts(alert_status_id,triggered_at DESC);
CREATE TABLE IF NOT EXISTS digital_twin.notifications (
 notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alert_id BIGINT NOT NULL REFERENCES digital_twin.alerts(alert_id),
 user_id BIGINT NOT NULL REFERENCES digital_twin.users(user_id),
 message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS digital_twin.maintenance_events (
 maintenance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_code TEXT NOT NULL REFERENCES digital_twin.monitoring_locations(location_code),
 point_code TEXT REFERENCES digital_twin.sensor_registry(point_code),
 alert_id BIGINT REFERENCES digital_twin.alerts(alert_id),
 event_type TEXT NOT NULL, event_date TIMESTAMPTZ NOT NULL,
 description TEXT, maintenance_status TEXT NOT NULL DEFAULT 'Scheduled'
  CHECK(maintenance_status IN ('Scheduled','In Progress','Completed','Cancelled')),
 performed_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v3_maintenance_location_date
 ON digital_twin.maintenance_events(location_code,event_date DESC);
INSERT INTO digital_twin.alert_severity(severity_name)
 VALUES ('Low'),('Medium'),('High'),('Critical')
 ON CONFLICT(severity_name) DO NOTHING;
INSERT INTO digital_twin.alert_status(status_name)
 VALUES ('New'),('Review'),('Acknowledged'),('Closed')
 ON CONFLICT(status_name) DO NOTHING;
COMMIT;

-- Timescale conversion is executed by setup-v3.mjs separately, outside transaction.
-- No retention/delete policies are enabled by this schema.


-- Automatic synthetic rule alerts. Evidence remains after raw-history retention.
CREATE TABLE IF NOT EXISTS digital_twin.alert_severity (
 alert_severity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, severity_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS digital_twin.alert_status (
 alert_status_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, status_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS digital_twin.alerts (
 alert_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 point_code TEXT REFERENCES digital_twin.sensor_registry(point_code),
 alert_severity_id BIGINT NOT NULL REFERENCES digital_twin.alert_severity(alert_severity_id),
 alert_status_id BIGINT NOT NULL REFERENCES digital_twin.alert_status(alert_status_id),
 alert_type TEXT NOT NULL, message TEXT NOT NULL,
 triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS replay_id TEXT;
ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS detector TEXT;
ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS auto_alert_point ON digital_twin.alerts(point_code) WHERE resolved_at IS NULL;
INSERT INTO digital_twin.alert_severity(severity_name) VALUES('Medium'),('Critical') ON CONFLICT DO NOTHING;
INSERT INTO digital_twin.alert_status(status_name) VALUES('New'),('Review'),('Acknowledged'),('Closed') ON CONFLICT DO NOTHING;
