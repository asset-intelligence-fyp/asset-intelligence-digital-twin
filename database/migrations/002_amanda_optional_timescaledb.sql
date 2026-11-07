-- Amanda OPTIONAL migration: run only after confirming TimescaleDB is installed
-- and backing up the database. Do not run against your old v2 database.
-- If TimescaleDB is unavailable, the website still works with ordinary PostgreSQL.
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Existing twin18 data is preserved. This operation may lock the table.
-- Check database size and take a backup first.
SELECT create_hypertable('twin18.sensor_readings', 'reading_timestamp',
                        if_not_exists => TRUE, migrate_data => TRUE);
-- Verify:
SELECT hypertable_schema, hypertable_name
FROM timescaledb_information.hypertables
WHERE hypertable_schema='twin18';
