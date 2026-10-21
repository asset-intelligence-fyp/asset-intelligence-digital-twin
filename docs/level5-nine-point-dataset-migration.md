# Nine-point sensor IDs mapped to original Level 5 BIM (October 2026)

## Requested logical renaming

The original unchanged `L5_Asset_List` screenshot contains eight *original* physical sensor IFC GlobalIds and one virtual fan-status row with no IfcGUID. The user's updated AI CSV/live simulator uses nine new point codes.

This implementation uses the **new CSV point code as the sensor ID and sensor point code**, and reuses the *original row's existing* IFC GlobalId and HRU asset. The Mark values are kept for provenance.

| Original Mark | Updated sensor ID = CSV point | Asset | Measurement | Original IfcGUID |
| --- | --- | --- | --- | --- |
| S-L5-001 | SAT-501A | HRU501A | Supply-air temperature (°C) | `2kuK4GGyjA5QV8NiAnXeXZ` |
| S-L5-002 | MAT-501A | HRU501A | Mixed-air temperature (°C) | `3gW6u2ne59c8oABDoS7b3j` |
| — | FS-501A | HRU501A | Supply-fan status (ON/OFF) | **None in source** |
| S-L5-003 | SAT-504 | HRU504 | Supply-air temperature (°C) | `3gW6u2ne59c8oABDoS7bB3` |
| S-L5-004 | DPCMD-504 | HRU504 | Outdoor-air damper command (%) | `3iie255UfEvg3mun9qVzgx` |
| S-L5-005 | DP-504 | HRU504 | Outdoor-air damper position (%) | `050uZGzlP8Yg9H1S$ofK0i` |
| S-L5-006 | SAT-507 | HRU507 | Supply-air temperature (°C) | `050uZGzlP8Yg9H1S$ofKIe` |
| S-L5-007 | CV-507 | HRU507 | Cooling-valve position (%) | `050uZGzlP8Yg9H1S$ofKRW` |
| S-L5-008 | S-L5-008-TEMP | HRU507 / Unit 507 room | Room temperature (°C) | `1Rnvr0S6DA0x5eK1Aa66rR` |

**Important:** The original spreadsheet describes S-L5-002, S-L5-004 and S-L5-007 as **Air Velocity** devices. Associating MAT-501A, DPCMD-504 and CV-507 with these same original GUIDs is **a user-directed logical PoC mapping**, not a verified physical reclassification. No IFC/XKT geometry was altered.

There are nine sensor IDs and nine data-point codes. **Eight** have original BIM geometry; `FS-501A` is an asset-linked, selectable telemetry card without a physical BIM marker. The frontend displays all nine cards, and selecting FS shows its HRU-linked inspector without attempting to focus nonexistent geometry.

## Apply to your PostgreSQL instance

Changes are committed only to the GitHub branch `feature/ui-redesign`, **not to the PostgreSQL service on your Mac**.

From the project repository root:

```bash
git fetch origin
git switch feature/ui-redesign
git pull --ff-only origin feature/ui-redesign
pg_dump -Fc -d digital_twin -f digital_twin_before_sensor_rename.backup
psql -X -v ON_ERROR_STOP=1 -d digital_twin -f database/seed_level5_nine_point_profile.sql
```

Or use **Adminer → SQL command** and execute the contents of `database/seed_level5_nine_point_profile.sql`.

The script is non-destructive and re-runnable. It supports databases with the original eleven-point seed or the previous nine-point migration. It inserts/update eight current sensor IDs using the original GUIDs, retains virtual `FS-501A`, and updates the nine active point records. Legacy point codes `AF-501A`, `AF-504`, `AF-507`, `S-L5-008-HUM`, `S-L5-008-CO2` are marked **Inactive**, with historical `sensor_readings` retained.

**Do not run `database/postgres_init.sql`** on your populated database because it resets tables. Do not rerun `database/seed_level5_sensor_registry.sql` after the updated profile without reapplying the new migration: the original seed re-enables the old channels.

The migration retains the original `S-L5-00x` sensor records to preserve legacy relationships. Consequently, historical/legacy metadata may contain duplicate references to the same IFC GlobalId; the Node.js API now returns only sensors with an active point, ensuring the frontend selects the correct new sensor identity.

### Validate in Adminer

```sql
SELECT sp.point_code, sp.sensor_code AS sensor_id,
       s.equipment_code AS asset_id, s.global_id AS bim_guid,
       sp.measurement_type, sp.unit, sp.point_status
FROM sensor_points sp
JOIN sensors s ON s.sensor_code = sp.sensor_code
WHERE sp.point_status = 'Online'
ORDER BY s.equipment_code, sp.point_code;
```

Expected: the nine rows in the table above, with `sensor_id = point_code`. Exactly one has `VIRTUAL-FS-501A` rather than a physical IFC GUID.

### Validate preservation of older readings

```sql
SELECT point_code, COUNT(*) AS stored_readings
FROM sensor_readings
WHERE point_code IN
 ('AF-501A','AF-504','AF-507','S-L5-008-HUM','S-L5-008-CO2')
GROUP BY point_code;
```

This query returns historical counts only where archival observations existed; a point with no prior readings does not appear.

## Nine-point independent Python MQTT publisher

The uploaded `PPT_LBNL_Independent_3HRU_Live.zip` independent generator
is now used by `tools/independent_3hru_live`. It is a **synthetic
stateful stream**, not physical BMS telemetry and not an LBNL row replay.
It publishes exactly the nine active IDs listed above under
`dt/<asset_id>/<point_code>`; the backend validates that the sensor ID,
asset ID, topic and provenance match. Previous 11-point simulators were
removed from the repository.

Start Mosquitto, PostgreSQL, Node API, and the independent Python
publisher as described in [the integration README](../tools/independent_3hru_live/README.md).
Stop the legacy Python process if it is still running; deleting its Git
files does **not** terminate that process. The API exposes
`/api/live-status` with the list of nine point states and missing points.

## Verification steps

```bash
node --test tests/level5NinePointProfile.test.mjs
node --test tests/bimSensorCards.test.mjs
node --test tests/uiRedesign.test.mjs
npm run build
npm run dev
```

Open the BIM Viewer and verify nine sensor cards, eight selectable original model markers and the unlocated FS-501A card. Inspect all eight model selections, check current values against PostgreSQL, and confirm MQTT/SSE refresh once the new simulator is connected. Source-level syntax and data-contract checks are not a substitute for actual browser, SQL and MQTT testing.
