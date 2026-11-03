#!/usr/bin/env python3
"""Publish independent three-HRU synthetic observations via MQTT (not physical sensors).

Based on the supplied independent simulator. Ground-truth fault labels are never
published. Local latest.json/history generation remains supported for research.
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from independent_hvac_core import ThreeHRUIndependent, COLUMNS
from mqtt_contract import make_messages, MQTT_POINTS

ROOT = Path(__file__).resolve().parents[1]


def atomic_json(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def writer(path, header):
    handle = path.open("a", newline="", encoding="utf-8")
    stream = csv.DictWriter(handle, fieldnames=header, extrasaction="ignore")
    if path.stat().st_size == 0:
        stream.writeheader()
    return handle, stream


def connect_broker(args):
    if not args.mqtt:
        return None
    try:
        import paho.mqtt.client as mqtt
    except ImportError as error:
        raise RuntimeError("Install paho-mqtt: python3 -m pip install -r requirements.txt") from error

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"independent-three-hru-{os.getpid()}")
    if args.mqtt_username:
        client.username_pw_set(args.mqtt_username, args.mqtt_password)
    if args.mqtt_tls:
        client.tls_set()
    client.connect(args.mqtt_host, args.mqtt_port, keepalive=60)
    client.loop_start()
    # Publish only once the broker is ready. Failure is explicit, not silent.
    started = time.monotonic()
    while not client.is_connected():
        if time.monotonic() - started > 10:
            client.loop_stop()
            client.disconnect()
            raise ConnectionError("MQTT broker unavailable (connection timed out)")
        time.sleep(0.05)
    return client


def publish_values(client, message, qos):
    if client is None:
        return
    for topic, payload in make_messages(message):
        info = client.publish(topic, json.dumps(payload, separators=(",", ":")), qos=qos, retain=False)
        info.wait_for_publish(timeout=10)
        if not info.is_published():
            raise ConnectionError(f"MQTT delivery not acknowledged for {topic} (rc={info.rc})")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Independent synthetic three-HRU stream and MQTT publisher")
    parser.add_argument("--interval-seconds", type=float, default=60.)
    parser.add_argument("--ticks", type=int, default=0, help="0 means continuous")
    parser.add_argument("--start-sim-time", default="2026-07-01T10:00:00")
    parser.add_argument("--seed", type=int, default=437119)
    parser.add_argument("--fault-mode", choices=["normal", "automatic", "damper_stuck", "valve_stuck", "coil_degradation", "sensor_spike", "sensor_drift"], default="automatic")
    parser.add_argument("--mean-hours-between-faults", type=float, default=48.)
    parser.add_argument("--initial-fault-after-minutes", type=int, default=30)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "outputs")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--mqtt", action="store_true", help="Publish the nine active BIM points to MQTT")
    parser.add_argument("--mqtt-host", default=os.getenv("MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    parser.add_argument("--mqtt-qos", type=int, choices=[0, 1], default=1)
    parser.add_argument("--mqtt-username", default=os.getenv("MQTT_USERNAME"))
    parser.add_argument("--mqtt-password", default=os.getenv("MQTT_PASSWORD"))
    parser.add_argument("--mqtt-tls", action="store_true")
    args = parser.parse_args(argv)
    if args.interval_seconds <= 0 or args.ticks < 0:
        parser.error("interval must be positive; ticks cannot be negative")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    calibration = json.loads((ROOT / "reference/train_only_weather_calibration.json").read_text(encoding="utf-8"))
    engine = ThreeHRUIndependent(calibration, seed=args.seed, start_time=args.start_sim_time,
        fault_mode=args.fault_mode, mean_hours_between_faults=args.mean_hours_between_faults,
        initial_fault_after_minutes=args.initial_fault_after_minutes)
    client = connect_broker(args)
    if client is not None:
        topics = ", ".join(f"dt/{asset}/{code}" for code, asset, _, _ in MQTT_POINTS)
        print(f"[MQTT] Independent publisher connected to {args.mqtt_host}:{args.mqtt_port}; "
              f"publishing {len(MQTT_POINTS)} topics: {topics}", file=sys.stderr, flush=True)
    history_file, history = writer(args.out_dir / "telemetry_history.csv", COLUMNS)
    labels_file, labels = writer(args.out_dir / "ground_truth_labels.csv",
        ["timestamp", "event_id", "event_type", "asset", "affected_field", "active"])
    events_file, events = writer(args.out_dir / "ground_truth_events.csv",
        ["event_id", "event_type", "asset", "affected_field", "start_time", "end_time_exclusive",
         "duration_minutes", "severity", "fixed_value", "ground_truth_only"])
    try:
        i = 0
        while not args.ticks or i < args.ticks:
            i += 1
            values, active = engine.step()
            history.writerow(values)
            history_file.flush()
            labels.writerow({"timestamp": values["timestamp"], "event_id": active.event_id if active else "",
                "event_type": active.event_type if active else "", "asset": active.asset if active else "",
                "affected_field": active.field if active else "", "active": int(active is not None)})
            labels_file.flush()
            for item in engine.new_events:
                events.writerow(item)
            if engine.new_events:
                events_file.flush()
                engine.new_events.clear()

            message = {"published_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "sequence": i, "simulated_time": values["timestamp"],
                "provenance": "STATEFUL_SYNTHETIC_TRAIN_CALIBRATED_THREE_HRU",
                "scenario": "independent_simulation",
                "warning": "SIMULATED. Neither physical sensor data nor AI predictions. Ground truth is logged separately.",
                "values": values}
            atomic_json(args.out_dir / "latest.json", message)
            publish_values(client, message, args.mqtt_qos)
            if client is not None and not args.quiet:
                print(f"[MQTT] Tick {i}: broker acknowledged {len(MQTT_POINTS)}/"
                      f"{len(MQTT_POINTS)} messages (DB acceptance is checked via /api/live-status)",
                      file=sys.stderr, flush=True)
            if not args.quiet:
                print(json.dumps(message, separators=(",", ":")), flush=True)
            if not args.ticks or i < args.ticks:
                time.sleep(args.interval_seconds)
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
    finally:
        for handle in (history_file, labels_file, events_file):
            handle.close()
        if client is not None:
            client.disconnect()
            client.loop_stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())

