# HRU Digital Twin Sensor Simulator v2

A localhost testing tool for the Digital Twin PoC.

It contains:

- HRU501A
  - Supply Air Temperature Sensor
  - Airflow Sensor
  - Fan Status
- HRU504
  - Supply Air Temperature Sensor
  - Static Pressure Sensor
  - Damper Position
- HRU507
  - Supply Air Temperature Sensor
  - Airflow Sensor
  - Zone Temperature Sensor

## Important academic note

The default normal ranges and anomaly relationships in `config/assets.json` and
`config/scenarios.json` are **synthetic test assumptions**. They are not verified
engineering specifications for real HRU501A, HRU504, or HRU507 equipment.

Before reporting model accuracy as meaningful for your selected dataset/equipment,
replace these assumptions with ranges/relationships supported by the dataset,
equipment documentation, or other defensible evidence.

Synthetic-data results demonstrate PoC behaviour under the simulator's assumptions;
they do not establish diagnostic performance on a real deployed building.

## Architecture

```text
Live mode

Simulator Engine
      |
      v
MQTT Publisher
      |
      v
Mosquitto :1883
      |
      v
Digital Twin Backend
      |
      +--> PostgreSQL
      +--> AI inference
      +--> WebSocket
              |
              v
        localhost website
```

Historical mode uses the **same simulation engine** but advances a synthetic clock
without waiting in real time.

## Why the ground truth is separate

Main telemetry topics do NOT include anomaly labels:

```text
dt/HRU501A/SAT-501A
dt/HRU501A/AF-501A
...
```

Test-only ground truth is published separately:

```text
dt/test/groundtruth/HRU501A/SAT-501A
...
```

For AI training/evaluation, the historical generator creates:

- `historical_features.csv` — wide feature matrix for model input
- `historical_labels.csv` — ground-truth anomaly labels
- `historical_long.csv` — complete long-format observations + labels for analysis
- `historical_events.json` — scheduled synthetic anomaly events

Do **not** feed the label/scenario columns to an unsupervised anomaly detector.

## Requirements

Recommended: Python 3.13.

### macOS

If your default Python is 3.14, explicitly create the venv using 3.13:

```bash
brew install python@3.13
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
python --version
```

It should show Python 3.13.x.

Install dependencies:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Install and start Mosquitto

```bash
brew install mosquitto
brew services start mosquitto
```

Check it:

```bash
brew services list
```

## Start the simulator

```bash
python app.py
```

Open:

```text
http://127.0.0.1:8001
```

## Watch the live MQTT messages

Telemetry only:

```bash
mosquitto_sub -h localhost -p 1883 -t 'dt/+/+' -v
```

Ground truth only:

```bash
mosquitto_sub -h localhost -p 1883 -t 'dt/test/groundtruth/#' -v
```

Everything:

```bash
mosquitto_sub -h localhost -p 1883 -t 'dt/#' -v
```

Example telemetry payload:

```json
{
  "timestamp": "2026-10-02T11:30:00+00:00",
  "asset_id": "HRU501A",
  "sensor_id": "AF-501A",
  "reading_type": "airflow",
  "value": 2.0312,
  "unit": "m³/s",
  "sequence": 128,
  "quality": "simulated"
}
```

## Live controls

The UI provides two levels of fault injection.

### Per-sensor controls

- Normal
- High
- Low
- Spike
- Drift
- Stuck

### Cross-sensor scenarios

- HRU501A — Low airflow while fan is ON
- HRU501A — Fan OFF / airflow conflict
- HRU504 — Damper stuck
- HRU504 — High static pressure
- HRU507 — Low airflow + zone temperature drift
- HRU507 — Zone temperature sensor stuck

Each scenario has configurable duration and severity.

## Historical dataset generation

You can generate a dataset from the browser or directly from the command line.

Example:

```bash
python historical/generate_history.py --days 30 --interval 60 --seed 42
```

For 30 days, 1-minute intervals, 9 sensors:

```text
30 × 24 × 60 × 9 = 388,800 long-format observations
```

The wide feature file contains one row per timestamp:

```text
timestamp,SAT-501A,AF-501A,FAN-501A,SAT-504,SP-504,DMP-504,SAT-507,AF-507,ZT-507
```

The label file is separate:

```text
timestamp,is_anomaly,scenario_id
```

This separation reduces the chance of accidentally leaking the ground-truth label
into the AI input.

## Suggested AI workflow

Start with one HRU rather than all 9 sensors at once.

For example, HRU501A:

```text
Features:
SAT-501A
AF-501A
FAN-501A
```

Recommended experiment:

1. Generate historical data.
2. Extract normal periods from the training portion.
3. Train the Autoencoder on normal data only.
4. Choose an anomaly threshold using a validation period.
5. Evaluate on a later test period containing synthetic scenarios.
6. Report:
   - precision
   - recall
   - F1
   - false-alarm rate
   - detection delay
   - accuracy only where appropriate
7. Save the trained model/version.
8. Run the same preprocessing against live MQTT readings.
9. Send AI results to the Digital Twin backend/UI.

Avoid randomly splitting neighbouring time-series rows between train and test.
Prefer chronological splits or independent simulation runs with different seeds.

## Example chronological split

For a 60-day generated dataset:

```text
Days 1–35   Training
Days 36–45  Validation
Days 46–60  Testing
```

If using an Autoencoder, train only on rows confirmed as normal.

## Editing ranges

Edit:

```text
config/assets.json
```

Example:

```json
"SAT-501A": {
  "reading_type": "supply_air_temperature",
  "normal_min": 18.0,
  "normal_max": 24.0,
  "baseline": 21.0,
  "noise_std": 0.12
}
```

Replace these defaults with defensible project values when available.

## Integration with your main repository

Recommended location:

```text
asset-intelligence-digital-twin/
  backend/
  frontend/
  ai/
  bim/
  tools/
    hru-sensor-simulator/
```

Suggested backlog item:

**Implement configurable MQTT HRU sensor simulator and synthetic fault injector**

Acceptance criteria:

- Simulates all 9 selected sensor streams.
- Continuously publishes MQTT readings.
- Supports controlled abnormal scenarios.
- Preserves timestamp, asset ID, sensor ID and sequence number.
- Generates historical training/evaluation data.
- Keeps model features separate from ground-truth labels.
- Backend can subscribe to the simulator topics.
