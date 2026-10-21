# Level 5 nine-point dataset update (October 2026)

## Source of truth

The nine **point codes** below were transcribed from the supplied screenshot of the user's new AI CSV / independent live Python simulator. These are **not verified physical building measurements**.

| BIM / HRU asset | New CSV point | Measurement | Unit | Current database sensor | Physical IFC marker? |
| --- | --- | --- | --- | --- | --- |
| HRU501A | SAT-501A | Supply-air temperature | °C | S-L5-001 | Yes, existing GlobalId |
| HRU501A | MAT-501A | Mixed-air temperature | °C | MAT-501A | No confirmed GUID; virtual asset point |
| HRU501A | FS-501A | Supply-fan status | ON/OFF | FS-501A | Existing virtual fan point |
| HRU504 | SAT-504 | Supply-air temperature | °C | S-L5-003 | Yes, existing GlobalId |
| HRU504 | DP-504 | Outdoor-air damper position | % | S-L5-005 | Yes, existing GlobalId |
| HRU504 | DPCMD-504 | Outdoor-air damper command | % | DPCMD-504 | No confirmed GUID; virtual asset point |
| HRU507 | SAT-507 | Supply-air temperature | °C | S-L5-006 | Yes, existing GlobalId |
| HRU507 | CV-507 | Cooling-valve position | % | CV-507 | No confirmed GUID; virtual asset point |
| Unit 507 room (HRU507 asset) | S-L5-008-TEMP | Room temperature | °C | S-L5-008 | Yes, existing ABB Fusion GlobalId |

There are **eight original physical BIM sensor markers**, of which **five now have active measurement channels**. The three original physical air-velocity sensor markers (`S-L5-002`, `S-L5-004`, `S-L5-007`) remain in the BIM model but have no channel in the new dataset. They are *not* relabeled as different kinds of sensors.

Three new HRU telemetry identities (`MAT-501A`, `DPCMD-504`, `CV-507`) are represented in `sensors` with clearly named **virtual** `bim_elements`. These virtual database IDs are not XKT geometry, not physical IFC GlobalIds, and must not be used to focus a fictional BIM element. `FS-501A` remains virtual.

## Safe database migration

**Important: The GitHub commit cannot edit the PostgreSQL instance on your Mac.** Apply the migration to the **same** database that the Node.js backend connects to.

1. Make a backup (optional but recommended if you have important historical data):

   ```bash
   pg_dump -Fc -d digital_twin -f digital_twin_before_9point.backup
   ```

2. Pull `feature/ui-redesign` and from the repository root run:

   ```bash
   psql -X -v ON_ERROR_STOP=1 -d digital_twin \
     -f database/seed_level5_nine_point_profile.sql
   ```

   If your `.env` points to another database, use its actual database and server/role options. **Do not run `postgres_init.sql`: it drops and recreates tables.**

   Alternatively in Adminer, use **SQL command** and paste the contents of `database/seed_level5_nine_point_profile.sql`.

3. Verify the nine active rows:

   ```sql
   SELECT sp.point_code, sp.measurement_type, sp.unit,
          sp.point_status, s.equipment_code, s.global_id
   FROM sensor_points sp
   JOIN sensors s ON s.sensor_code=sp.sensor_code
   WHERE sp.point_status='Online'
   ORDER BY s.equipment_code, sp.point_code;
   ```

   Exactly nine rows should return if no other unrelated online points exist in the database. Check the **point code set**, rather than relying only on the number if this database contains another building or test sensors.

4. Verify historical readings remain:

   ```sql
   SELECT point_code, COUNT(*)
   FROM sensor_readings
   WHERE point_code IN ('AF-501A','AF-504','AF-507','S-L5-008-HUM','S-L5-008-CO2')
   GROUP BY point_code;
   ```

   This query lists only archival rows **if** any existed; a missing result does not mean the migration deleted anything.

The migration does not remove any `sensor_readings` or existing `sensors` / `bim_elements`. It marks `AF-501A`, `AF-504`, `AF-507`, `S-L5-008-HUM`, `S-L5-008-CO2` `Inactive`, keeps six existing channels active, and adds three new points.

**Important:** `database/seed_level5_sensor_registry.sql` is the **original eleven-point seed**. Do not rerun it *after* this migration without rerunning the nine-point migration, because the old seed re-enables old channels. Keep the original seed only for historical initial setup.

## Frontend/backend changes

- `src/data/level5Sensors.js`: eight exact physical sensor GUIDs retained; nine-point registry added and four virtual asset-level points documented.
- `src/bimSensorUI.js`: eight original markers are still selectable. The three physical velocity sensors say “No channel in new dataset” and remain grey.
- Sensor inspector: readings for the selected physical sensor stay distinct from a section labeled **Related HRU telemetry · no physical BIM marker**, including the other four point names.
- `src/redesignViews.js`: sensor charts, monitoring and simulator pages use the nine new variables, not the retired air-flow/humidity/CO₂ channels.
- `server/index.js`: MQTT ingestion rejects inactive channels; active PostgreSQL bootstrap/current/history results show only online channels. Archived historical records are retained in the database and can still be queried in SQL.
- The original 11-point Python `app.py` and `generate_historical.py` are **not changed**. They are for the previous data profile and must not be treated as compatible with the new nine-point training CSV.

## Next: connect your independent Python simulator

Upload its script and a small CSV header/sample (with private paths/credentials removed). The backend's existing subscriber listens for:

```text
dt/HRU501A/SAT-501A
dt/HRU501A/MAT-501A
dt/HRU501A/FS-501A
dt/HRU504/SAT-504
dt/HRU504/DP-504
dt/HRU504/DPCMD-504
dt/HRU507/SAT-507
dt/HRU507/CV-507
dt/HRU507/S-L5-008-TEMP
```

Expected payload contract (example **shape only**, not actual sensor values):

```json
{
  "timestamp": "<valid ISO 8601 timestamp>",
  "asset_id": "HRU501A",
  "sensor_id": "MAT-501A",
  "point_code": "MAT-501A",
  "value": 0,
  "unit": "°C",
  "quality": "simulated",
  "sequence": 1
}
```

Use the simulator's real values; `0` above only demonstrates a numeric JSON field. For `FS-501A`, encode fan state numerically (`0` OFF, `1` ON) as required by the current `sensor_readings.reading_value` numeric column. If the uploaded script uses different keys/encoding, adapt its publisher or a validated backend adapter after inspection—do not assume it is automatically compatible.

The backend verifies `sensor_id`, `asset_id` and `point_code` against the active database registry. Incoming observations go through MQTT → Node.js → PostgreSQL → SSE → frontend. The original timestamp and source-sequence handling still require separate real-world testing.

## Verification

After migration and website restart, check:

```bash
node --test tests/level5NinePointProfile.test.mjs
node --test tests/bimSensorCards.test.mjs
node --test tests/uiRedesign.test.mjs
npm run build
npm run dev
```

Then open `http://localhost:5173/bim-viewer`. Check that all eight sensor markers remain and that current readings show **only** the six directly mapped points plus four virtual points in their owning HRU sections (nine unique channels overall; some HRU sections repeat context on multiple selected sensors).

The current change has only been checked using code/static contract tests until you run it against your actual PostgreSQL and local XKT files. Neither your new Python simulator nor the new CSV bytes were supplied in this turn, so live replay is **not yet connected or validated**.
