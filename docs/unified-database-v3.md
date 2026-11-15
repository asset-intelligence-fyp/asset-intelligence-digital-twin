# Unified Database v3 — PostgreSQL + TimescaleDB

The unified schema is `digital_twin` inside whichever **PostgreSQL database** is specified by your local connection settings (`PGDATABASE` or `DATABASE_URL`). A schema is not a second database. This is an **additive schema consolidation**: existing `public` and `twin18` objects remain separate, and their sensor rows are not silently migrated to v3.

## Tables and responsibilities

- `buildings`, `building_floors`, `bim_models`, `bim_elements`, `monitoring_locations`, `sensor_registry`: fixed building metadata, BIM references and 18 simulator-to-IFC demonstration aliases across five locations.
- `sensor_readings`: timestamped readings, quality, replay ID and receipt time. The v3 setup converts this table to a **TimescaleDB hypertable**.
- `simulation_runs`: prepared run metadata (not automatically populated by current ingestion).
- `alerts`, `alert_severity`, `alert_status`: **automatic threshold-based synthetic alerts are now wired into the active sensor API**. Stored incidents include replay, detector and JSON evidence; acknowledgement and recovery are separate. These are **not Qwen decisions**.
- `maintenance_events`: optional reference to a location, point and alert; not proof of real-world maintenance.
- `ai_results`, `forecast_results`: schema prepared, but the current assistant **does not persist its model outputs to these tables**.
- `roles`, `users`, `notifications`: future data model; admin authentication currently uses the local `.env` hash and in-memory sessions. External notification delivery is not implemented.

The application registry `shared/sensorRegistry.json` is currently the authoritative sensor mapping and seeds PostgreSQL; metadata is not dynamically discovered from the database at runtime.

## Installation (development database only)

1. Back up any existing database. Verify `PGDATABASE`/`DATABASE_URL` targets your intended **development** instance. Do not run legacy `database/postgres_init.sql` because it drops and recreates older demo tables.
2. Install/enable a matching TimescaleDB extension for your PostgreSQL instance and selected database.
3. In an untracked `.env`, set `TWIN_DB_SCHEMA=digital_twin`; remove `TWIN_STORAGE=memory`. Configure your PostgreSQL connection.
4. Run:

```bash
npm run db:setup:v3
npm run db:check
npm run dev
```

Setup creates the additive `digital_twin` tables and 18 sensor definitions, checks the TimescaleDB extension, converts `digital_twin.sensor_readings` to a hypertable, and installs a PostgreSQL `NOTIFY` trigger used by the database viewer. It does **not** delete existing `twin18`/public data or automatically transfer their histories.

Verify in pgAdmin:

```sql
SELECT extversion FROM pg_extension WHERE extname='timescaledb';
SELECT hypertable_schema,hypertable_name
FROM timescaledb_information.hypertables
WHERE hypertable_schema='digital_twin' AND hypertable_name='sensor_readings';
SELECT count(*) FROM digital_twin.sensor_registry; -- expected 18
SELECT count(*) FROM digital_twin.monitoring_locations; -- expected 5
SELECT count(*) FROM digital_twin.sensor_readings; -- grows while simulator runs
SELECT count(*) FROM digital_twin.alerts WHERE detector='threshold_v1'; -- grows after threshold tests
```

The `npm run db:check` command additionally confirms `readings_hypertable: true`. Merely finding a SQL script or an empty table is **not** confirmation of a working TimescaleDB server.

## Runtime behavior and limitations

Set `TWIN_DB_SCHEMA=twin18` to continue using the older PostgreSQL-compatible schema; that is **a different readings/alerts history**. The default schema is `twin18` unless you explicitly select v3. Memory mode bypasses PostgreSQL entirely and resets on restart.

Sensor ingestion writes readings and threshold alerts in a transaction and streams changes to the UI. Persisted incidents can be inspected in the Event log, linked back to the BIM location, acknowledged and marked recovered when sensor values return to permitted bounds. The read-only admin viewer exposes available database tables; users, model outputs, forecasts and external notification delivery are not automatically written.

No TimescaleDB compression, retention, deletion, archival, or continuous-aggregate policy is automatically enabled. Historical normal-context retrieval for research Qwen analysis can still use a **separate local SQLite reference**; the v3 schema does not replace it. All current telemetry and alerts are **synthetic experiments**, not real BMS readings or maintenance events.

See [full setup and alert walkthrough](working-website-guide.md), [previous verified tests](integration-verification.md), and [top-level README](../README.md).
