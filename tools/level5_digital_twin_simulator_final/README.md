# Level 5 Digital Twin Simulator — historical MQTT replay

> **Legacy eleven-channel simulator:** This directory contains the *previous*
> 11-point profile (AF-501A/AF-504/AF-507 and ABB humidity/CO₂). The current
> nine-point dataset uses MAT-501A, DPCMD-504 and CV-507 instead.
> Do **not** run this old publisher against the nine-point PostgreSQL migration.
> See [nine-point migration and next simulator contract](../../docs/level5-nine-point-dataset-migration.md).
> The user's new independent Python simulator has not yet been provided or connected.



This is the final, **11-channel Level 5 simulator**, imported from the supplied `level5_digital_twin_simulator_final.zip`. It is distinct from the legacy `tools/hru_digital_twin_simulator_v2`.

- **HRU501A:** `SAT-501A`, `AF-501A`, `FS-501A`
- **HRU504:** `SAT-504`, `AF-504`, `DP-504`
- **HRU507:** `SAT-507`, `AF-507`
- **ABB Fusion device S-L5-008** (HRU507): `S-L5-008-TEMP`, `S-L5-008-HUM`, `S-L5-008-CO2`

## What is included / not included

The uploaded `generate_historical.py`, `validate_dataset.py` and `requirements.txt` are preserved byte-for-byte. The 11-point registry and simulation assumptions are represented in the two JSON files. `app.py` is adapted to validate CSV fields and publish readings without emitting the ground-truth labels.

**The generated dataset is not committed.** The uploaded ZIP held only a **10,080-row, 7-day rule-based sample** dated January 2025, not the 525,540-row LBNL-derived historical dataset. Generated CSVs, raw LBNL files, Python environments, and credentials are intentionally excluded by `.gitignore`. Generate the CSV locally or point `SIM_DATASET` to your validated holdout file.

Source data is *not actual Snowdon Towers measurements*. The LBNL fault-free AHU supplies temporal signals; local velocity, Unit 507 humidity and CO2 are synthetic PoC mappings using parameters in `config/simulation_config.json`.

## Prerequisites

macOS Homebrew `mosquitto`, Node.js for the main repository, PostgreSQL with the Level 5 registry seeded, and Python with pip.

From the repository root, ensure the backend has been initialized with `database/postgres_schema.sql` and the existing project data, then apply `database/seed_level5_sensor_registry.sql` **only if its Level 5 measurement points are missing**. Do not erase an existing database.

## 1. Create the Python environment

```bash
cd tools/level5_digital_twin_simulator_final
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## 2. Prepare a dataset

Preferred LBNL-derived flow (requires your own authorized copy of `AHU_annual.csv`):

```bash
python generate_historical.py --mode lbnl \
  --source-lbnl "/absolute/path/to/AHU_annual.csv" \
  --output-dir data/generated --long
python validate_dataset.py data/generated/level5_normal_wide.csv
```

Fallback for connectivity **testing only**, if the original LBNL source is not available:

```bash
python generate_historical.py --mode rule \
  --start "2025-01-06 00:00:00" --days 7 \
  --output-dir data/generated
python validate_dataset.py data/generated/level5_normal_wide.csv
```

The fallback is not evidence of measured Level 5 performance. For AI model evaluation, replay a **chronologically held-out** portion not used for training rather than reusing training rows.

## 3. Start the broker and website

In one terminal:

```bash
mosquitto -v
```

If the port is already occupied, check whether a broker is already running with `lsof -nP -iTCP:1883 -sTCP:LISTEN`. You do not need `brew services start mosquitto`; manual launch avoids the earlier macOS `launchctl` error.

From the **repository root** in another terminal:

```bash
npm run dev
```

Expected backend logs:

```text
MQTT connected: mqtt://localhost:1883
MQTT subscribed: dt/+/+
```

## 4. Replay the 11 points

From this simulator directory, with `.venv` activated:

```bash
python app.py
```

Visit **http://127.0.0.1:8001**, click **Start replay**. Each CSV minute is published every two seconds by default. The MQTT `timestamp` is the current UTC time; `source_timestamp` is the historical CSV time.

To select a different dataset:

```bash
SIM_DATASET="/absolute/path/to/level5_normal_wide.csv" \
SIM_INTERVAL_SECONDS=2 \
MQTT_HOST=127.0.0.1 MQTT_PORT=1883 \
python app.py
```

Do not run the legacy simulator concurrently: both could publish conflicting values to overlapping topics.

## 5. Verify the end-to-end path

In a separate terminal:

```bash
mosquitto_sub -h localhost -p 1883 -t 'dt/+/+' -v
```

The backend must print accepted `[MQTT]` readings. Check PostgreSQL:

```bash
psql -d digital_twin -c "SELECT point_code,reading_value,reading_timestamp FROM sensor_readings ORDER BY reading_timestamp DESC LIMIT 11;"
```

Then open **http://localhost:5173/bim-viewer**, expand **Level 5 sensors** and select the ABB device **S-L5-008**. The sensor inspector should show its temperature, humidity and CO2 readings updating through `/api/events`.

If MQTT messages show up but the backend reports `Rejected unmapped point`, apply the Level 5 seed to the **same PostgreSQL database used by your Node.js backend**. If the UI still shows no values, verify that the backend is broadcasting the `sensor-reading` SSE event and that the BIM sensor's selected GlobalId resolves to `S-L5-008`.

### MQTT message schema

```json
{
  "timestamp": "current ISO 8601 UTC time",
  "source_timestamp": "historical dataset timestamp",
  "asset_id": "HRU507",
  "sensor_id": "S-L5-008",
  "point_code": "S-L5-008-CO2",
  "reading_type": "CO2",
  "value": 690.2,
  "unit": "ppm",
  "sequence": 123,
  "quality": "simulated",
  "generation_mode": "lbnl_fault_free"
}
```

The backend inserts readings using `point_code` and validates the physical `sensor_id` and `asset_id` against PostgreSQL. Labels and other synthetic ground-truth metadata are not broadcast as normal telemetry.

## Limitations and verification

This is a local research PoC, not connected to a real building management system. AI anomaly classification is **not** implemented by this simulator. It publishes normal historical replay data only. Successful static checks alone do not prove a live MQTT → PostgreSQL → browser session; verify with the steps above.
