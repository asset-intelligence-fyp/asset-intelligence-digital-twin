# Level 03 Office Temperature Simulator

Stateful, one-minute synthetic office temperature simulator for a BIM digital twin. **AC status, AC setpoint, and outdoor temperature all change automatically** by default; no manual JSON editing is required.

## Quick start

From the project directory, run:

```bash
python scripts/run_office_temperature.py
```

This appends one simulated minute every 60 real seconds to `outputs_live/telemetry_history.csv`, writes separate truth labels to `outputs_live/ground_truth_labels.csv`, and refreshes `outputs_live/latest.json`. To preview 2 simulated hours quickly:

```bash
python scripts/run_office_temperature.py --ticks 120 --interval-seconds 0.01 --out-dir outputs_demo
```

Use `--fault-mode mixed` to inject simulated faults (the default is normal). The `--mqtt` flag can still publish the existing `TEMP-501` point on `dt/AC-501/TEMP-501`; it does not publish fault labels.

## Automatic controls

- **AC status:** generally ON during office hours (Mon–Fri, approximately 08:00–18:00), generally OFF outside those hours. The simulator varies daily start/end times by about one hour and sometimes enables weekend overtime to avoid an identical schedule every day.
- **AC setpoint:** baseline 24°C with automatic day-to-day ±0.5°C adjustments, plus a small afternoon adjustment.
- **Outdoor temperature:** follows a smooth tropical daily curve with daily weather variations.
- **Room temperature:** dynamically follows the thermal model; ON does not guarantee effective cooling during an injected fault.
- **Runtime and 30-minute trend:** computed from simulated minute-by-minute history.

Configure baseline assumptions in `reference/office_temperature_config.json`. All three overrides in `reference/live_controls.json` are **null by default**, meaning automatic. Optionally set any override to a number while the simulator is running:

```json
{"ac_status": 1, "ac_setpoint_c": 22.0, "outdoor_temperature_c": 35.0}
```

Set values back to `null` to resume automatic variation; the file is read at every tick. Controls are overrides, not changes to the training targets.

## One-year training export

```bash
python scripts/export_year.py
```

Writes `outputs_training/level3_temperature_normal.csv` and `outputs_training/level3_temperature_abnormal.csv`, plus `fault_ground_truth.csv` and `summary.json`. Each annual CSV contains 525,600 minute records for 2025. The current training CSV omits outdoor temperature as agreed for the initial model: `timestamp,temperature_c,ac_status,ac_setpoint_c,ac_runtime_min,temperature_change_30min,is_anomaly`. Outdoor temperature is still simulated internally and is included in **live telemetry**.

The normal file has all label 0; the abnormal file has both 0 (fault-free) and 1 (injected fault) periods. Fault onset and recovery are continuous. The CSVs are synthetic prototypes, not measured or calibrated building data.

## Verify

```bash
python -m unittest discover -s tests -v
```

## Project layout

```text
scripts/office_temperature_core.py       # Thermal physics, schedule, setpoint, weather and faults
scripts/run_office_temperature.py         # Live runner, CSV/JSON, optional MQTT
scripts/office_mqtt_contract.py           # MQTT payload contract (legacy point IDs preserved)
scripts/export_year.py                    # 2025 paired training export
reference/office_temperature_config.json # Baseline assumptions
reference/live_controls.json             # Optional manual overrides; defaults automatic
outputs_live/                           # Existing example live records
outputs_training/                       # Full-year example training CSVs
```

**Time convention:** simulated timestamps are local office time without an embedded UTC offset. Interpret them as Asia/Kuching (UTC+08:00) for this project.
