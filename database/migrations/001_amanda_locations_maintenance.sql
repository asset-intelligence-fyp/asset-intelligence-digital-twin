-- Amanda additive migration. Run against a dedicated development DB after backup.
-- This does not drop or rename any tables and is safe to rerun.
BEGIN;
CREATE SCHEMA IF NOT EXISTS twin18;
CREATE TABLE IF NOT EXISTS twin18.monitoring_locations (
 location_code TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 floor_level TEXT NOT NULL
);
INSERT INTO twin18.monitoring_locations(location_code,display_name,floor_level) VALUES
 ('L02-OPEN','Open office','Level_02'),
 ('L03-MEET','Meeting room','Level_03'),
 ('L04-WC','Washroom','Level_04'),
 ('L04-CLEAN','Cleaning room','Level_04'),
 ('L05-ELEC','Electrical / power monitoring','Level_05')
ON CONFLICT (location_code) DO NOTHING;
CREATE TABLE IF NOT EXISTS twin18.maintenance_events (
 maintenance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_code TEXT NOT NULL REFERENCES twin18.monitoring_locations(location_code),
 point_code TEXT REFERENCES twin18.sensor_registry(point_code),
 event_type TEXT NOT NULL,
 event_date TIMESTAMPTZ NOT NULL,
 description TEXT,
 maintenance_status TEXT NOT NULL DEFAULT 'Scheduled'
   CHECK (maintenance_status IN ('Scheduled','In Progress','Completed','Cancelled')),
 performed_by TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS twin18_maintenance_location_date
 ON twin18.maintenance_events(location_code,event_date DESC);
COMMIT;
