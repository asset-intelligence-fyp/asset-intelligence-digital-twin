from __future__ import annotations

import argparse
import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from simulator.engine import SimulationEngine, Override

ROOT = Path(__file__).resolve().parents[1]


def schedule_events(start, end, rng):
    """Create synthetic anomaly windows for evaluation."""
    scenario_ids = [
        "HRU501A_AIRFLOW_LOW",
        "HRU501A_FAN_AIRFLOW_CONFLICT",
        "HRU504_DAMPER_STUCK",
        "HRU504_PRESSURE_HIGH",
        "HRU507_AIRFLOW_LOW_ZONE_DRIFT",
        "HRU507_ZONE_SENSOR_STUCK",
    ]
    total_seconds = (end - start).total_seconds()
    events = []
    for i, sid in enumerate(scenario_ids):
        # Two events per scenario, spaced pseudo-randomly.
        for repeat in range(2):
            frac = 0.10 + (i * 0.11 + repeat * 0.37) % 0.78
            event_start = start + timedelta(seconds=total_seconds * frac)
            duration = timedelta(minutes=rng.choice([20, 30, 45, 60, 90]))
            events.append({
                "scenario_id": sid,
                "start": event_start,
                "end": min(event_start + duration, end),
                "severity": rng.choice([0.8, 1.0, 1.2]),
            })
    return sorted(events, key=lambda e: e["start"])


def apply_historical_scenario(engine, sid, severity):
    # Historical generator has no wall-clock duration. Overrides are applied
    # directly and cleared when the event window ends.
    if sid == "HRU501A_AIRFLOW_LOW":
        engine.states["FAN-501A"].override = Override(mode="fixed", fixed_value=1, severity=severity)
        engine.states["AF-501A"].override = Override(mode="low", severity=severity)
    elif sid == "HRU501A_FAN_AIRFLOW_CONFLICT":
        engine.states["FAN-501A"].override = Override(mode="fixed", fixed_value=0, severity=severity)
        engine.states["AF-501A"].override = Override(mode="high", severity=severity)
    elif sid == "HRU504_DAMPER_STUCK":
        s = engine.states["DMP-504"]
        s.override = Override(mode="stuck", severity=severity, stuck_value=s.value)
    elif sid == "HRU504_PRESSURE_HIGH":
        engine.states["SP-504"].override = Override(mode="high", severity=severity)
    elif sid == "HRU507_AIRFLOW_LOW_ZONE_DRIFT":
        engine.states["AF-507"].override = Override(mode="low", severity=severity)
        engine.states["ZT-507"].override = Override(mode="drift", severity=severity)
    elif sid == "HRU507_ZONE_SENSOR_STUCK":
        s = engine.states["ZT-507"]
        s.override = Override(mode="stuck", severity=severity, stuck_value=s.value)


def clear_all_overrides(engine):
    for s in engine.states.values():
        s.override = Override()


def generate(days: int, interval_seconds: int, seed: int, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = SimulationEngine(seed=seed)
    rng = random.Random(seed + 1000)

    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=days)
    events = schedule_events(start, end, rng)

    long_path = out_dir / "historical_long.csv"
    wide_path = out_dir / "historical_features.csv"
    labels_path = out_dir / "historical_labels.csv"
    events_path = out_dir / "historical_events.json"

    sensors = list(engine.states.keys())

    long_fields = [
        "timestamp", "asset_id", "sensor_id", "reading_type",
        "value", "unit", "sequence",
        "ground_truth_state", "ground_truth_anomaly_type", "scenario_id"
    ]

    current = start
    with long_path.open("w", newline="", encoding="utf-8") as lf, \
         wide_path.open("w", newline="", encoding="utf-8") as wf, \
         labels_path.open("w", newline="", encoding="utf-8") as labf:

        long_writer = csv.DictWriter(lf, fieldnames=long_fields)
        long_writer.writeheader()

        wide_writer = csv.DictWriter(wf, fieldnames=["timestamp"] + sensors)
        wide_writer.writeheader()

        labels_writer = csv.DictWriter(
            labf,
            fieldnames=["timestamp", "is_anomaly", "scenario_id"]
        )
        labels_writer.writeheader()

        last_active = None

        while current < end:
            active = [
                e for e in events if e["start"] <= current < e["end"]
            ]
            scenario_id = active[0]["scenario_id"] if active else "NONE"

            if scenario_id != last_active:
                clear_all_overrides(engine)
                if active:
                    apply_historical_scenario(
                        engine,
                        active[0]["scenario_id"],
                        active[0]["severity"]
                    )
                last_active = scenario_id

            # Use simulator values but overwrite wall-clock timestamp with
            # historical timestamp.
            records = engine.step(simulated_hour=current.hour)
            wide_row = {"timestamp": current.isoformat()}
            any_anomaly = False

            for rec in records:
                rec["timestamp"] = current.isoformat()
                rec["scenario_id"] = scenario_id
                if rec["ground_truth_state"] == "abnormal":
                    any_anomaly = True
                wide_row[rec["sensor_id"]] = rec["value"]
                long_writer.writerow(rec)

            wide_writer.writerow(wide_row)
            labels_writer.writerow({
                "timestamp": current.isoformat(),
                "is_anomaly": int(any_anomaly or scenario_id != "NONE"),
                "scenario_id": scenario_id,
            })

            current += timedelta(seconds=interval_seconds)

    serialisable_events = [{
        **e,
        "start": e["start"].isoformat(),
        "end": e["end"].isoformat()
    } for e in events]
    events_path.write_text(json.dumps(serialisable_events, indent=2), encoding="utf-8")

    return {
        "historical_long": str(long_path),
        "historical_features": str(wide_path),
        "historical_labels": str(labels_path),
        "historical_events": str(events_path),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--interval", type=int, default=60, help="Seconds between samples")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "generated")
    args = parser.parse_args()

    files = generate(args.days, args.interval, args.seed, args.output)
    print("Generated:")
    for name, path in files.items():
        print(f"  {name}: {path}")
