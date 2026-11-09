# Unified Database Schema v3 (Amanda branch)

## Design decision

This is **schema consolidation**, not migration of old fake sensor data.

- Keep the *concepts* unique to `database/postgres_schema_v2.sql`: buildings,
  building floors, BIM models/elements, roles, users, AI results, severity/status,
  alerts, notifications.
- Use current `twin18` design when concepts overlap: 5 monitoring locations,
  18-point sensor registry with simulator/BIM aliases, sensor readings using
  `(point_code, reading_timestamp)`, quality, replay_id, received_at.
- Add forecast results, simulation-run metadata and maintenance events.
- The canonical *new* schema is `digital_twin` inside the existing **digital twin**
  PostgreSQL database. It is not a new database.
- `public` and `twin18` stay untouched while testing v3.
- No old fake sensor data is copied. Synthetic readings can be regenerated.
- IMPORTANT: The website's 18 sensor codes use simulator Level 03 aliases mapped
  onto five website locations across Levels 02–05. `mapping_status` remains
  `demonstration_alias`, not an independently verified physical mapping.

## Local setup (first back up the database)

1. Stop `npm run dev`. Verify local `.env` points at your development DB
   (e.g. `PGDATABASE=digital twin`), not production. Never commit secrets.
2. On branch `amanda`: `git pull --ff-only origin amanda`.
3. Run `npm run db:setup:v3`. This creates/updates **only** v3 schema and
   its fixed metadata seed. It creates a TimescaleDB hypertable for v3
   readings. Requires TimescaleDB already installed in the target database.
4. Before switching, validate in pgAdmin:

   ```sql
   SELECT count(*) FROM digital_twin.sensor_registry; -- 18
   SELECT count(*) FROM digital_twin.monitoring_locations; -- 5
   SELECT hypertable_schema,hypertable_name
   FROM timescaledb_information.hypertables
   WHERE hypertable_schema='digital_twin';
   ```

5. **Opt-in**: add `TWIN_DB_SCHEMA=digital_twin` to your *local* `.env`.
   Restart `npm run dev`. With this value, the Sensor API reads/writes
   `digital_twin.sensor_readings`, Bootstrap loads v3 maintenance,
   and Admin Database previews v3 business tables.
6. To revert to the current behavior, remove that line or set
   `TWIN_DB_SCHEMA=twin18`; restart. No data is moved or deleted.
   The two schemas have separate readings history.

## Current limitations / next integration stages

- `shared/sensorRegistry.json` is still the authoritative runtime sensor
  mapping. The v3 seed copies its 18 points into PostgreSQL, but UI/API
  sensor metadata is not yet dynamically loaded from v3.
- The existing admin login remains configured through `.env` and in-memory
  sessions. `digital_twin.users` and `roles` are a **future** auth design;
  they are not integrated. The admin viewer intentionally excludes users.
- The Qwen LLM and Events UI have **not** been wired to persist
  `digital_twin.ai_results`, `forecast_results`, or `alerts`.
  Those tables will initially be empty; do not present simulation test events
  as AI detections.
- `simulation_runs` metadata table is ready, but the current ingestion path
  does not populate it yet. The `replay_id` is not a mandatory foreign key.
- No retention, compression, archiving or deletion policies are created.
- Time filtering, Chunk Explorer and historical statistics are separate UI/API
  features and not part of this schema consolidation.
- No existing `public` tables are dropped. The earlier `postgres_init.sql`
  is destructive and **must not** be run on the populated database.
- Existing tests should continue to target `twin18` unless configured to use
  v3 explicitly. End-to-end v3 validation is needed on the local PostgreSQL
  instance after executing setup.

## Relationship summary

```text
buildings -> building_floors -> monitoring_locations -> sensor_registry
         -> bim_models / bim_elements
sensor_registry -> sensor_readings (TimescaleDB hypertable)
                -> ai_results -> alerts -> notifications
                -> forecast_results
monitoring_locations -> maintenance_events (optional alert reference)
users -> roles; notifications -> users
simulation_runs (optional metadata keyed by replay_id)
```

Synthetic data is not automatically copied from old v2 or twin18.
