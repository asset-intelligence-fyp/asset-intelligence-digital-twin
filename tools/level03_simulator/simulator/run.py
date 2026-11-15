
#!/usr/bin/env python3
"""Seven sensor types, 18 points, append-CSV/atomic-JSON loop, no MQTT."""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

from .core import SevenSensorSimulator


ROOT = Path(__file__).resolve().parents[1]


# ============================================================
# 1. Atomic JSON Writing (Windows-safe retry)
# ============================================================

def atomic_json(path, data):
    """
    Safely update latest.json using a temporary file.

    On Windows, replacing a file may temporarily fail if it is
    being accessed by another program. Retry before raising.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    temp = path.with_suffix(path.suffix + ".tmp")

    temp.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    for attempt in range(10):
        try:
            os.replace(temp, path)
            return

        except PermissionError:
            if attempt == 9:
                raise

            time.sleep(0.1)


# ============================================================
# 2. CSV Writer
# ============================================================

def open_writer(path, fields):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    f = path.open(
        "a",
        encoding="utf-8",
        newline=""
    )

    w = csv.DictWriter(
        f,
        fieldnames=fields
    )

    if path.stat().st_size == 0:
        w.writeheader()

    return f, w


# ============================================================
# 3. HTTP POST to Website Backend
# ============================================================

def post_readings(url, message, timeout):
    raw = json.dumps(
        message,
        separators=(",", ":")
    ).encode("utf-8")

    req = Request(
        url,
        data=raw,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    started = time.perf_counter()

    with urlopen(req, timeout=timeout) as response:
        content = response.read(4096)

        if not 200 <= response.status < 300:
            raise RuntimeError(
                f"HTTP {response.status}"
            )

    return {
        "http_status": response.status,
        "http_ack_ms": round(
            (time.perf_counter() - started) * 1000,
            1
        ),
        "response_excerpt": content[:120].decode(
            "utf-8",
            "replace"
        )
    }


# ============================================================
# 4. Main Simulator Loop
# ============================================================

def main(argv=None):

    ap = argparse.ArgumentParser(
        description="Level 03 - 18 Virtual Sensor Simulator"
    )

    ap.add_argument(
        "--ticks",
        type=int,
        default=0,
        help="Number of simulation ticks. 0 = continuously."
    )

    ap.add_argument(
        "--interval-seconds",
        type=float,
        default=60,
        help="Wall-clock interval between ticks."
    )

    ap.add_argument(
        "--start-sim-time",
        default="2026-10-30T08:00:00+08:00",
        help="Initial simulated timestamp."
    )

    ap.add_argument(
        "--seed",
        type=int,
        default=437119,
        help="Random seed for reproducible simulation."
    )

    ap.add_argument(
        "--fault-mode",
        choices=["normal", "demo", "live"],
        default="normal",
        help="Simulation mode."
    )

    ap.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "outputs",
        help="Output directory."
    )

    ap.add_argument(
        "--http-url",
        help="POST readings to teammate backend; no MQTT."
    )

    ap.add_argument(
        "--quiet",
        action="store_true",
        help="Disable per-tick terminal output."
    )

    # NEW: Control latest.json update frequency
    ap.add_argument(
        "--latest-every",
        type=int,
        default=1,
        help=(
            "Write latest.json every N ticks. "
            "1 = every tick, 0 = disable."
        )
    )

    args = ap.parse_args(argv)

    # --------------------------------------------------------
    # Validate arguments
    # --------------------------------------------------------

    if args.ticks < 0:
        ap.error("--ticks must be >= 0")

    if args.interval_seconds <= 0:
        ap.error("--interval-seconds must be > 0")

    if args.latest_every < 0:
        ap.error("--latest-every must be >= 0")

    # --------------------------------------------------------
    # Load configuration
    # --------------------------------------------------------

    cfg = json.loads(
        (ROOT / "config/simulation.json").read_text(
            encoding="utf-8"
        )
    )

    inv = json.loads(
        (ROOT / "config/sensors.json").read_text(
            encoding="utf-8"
        )
    )

    engine = SevenSensorSimulator(
        cfg,
        inv,
        args.start_sim_time,
        args.seed,
        args.fault_mode
    )

    args.out_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    # --------------------------------------------------------
    # Open CSV files
    # --------------------------------------------------------

    readings_file, readings_writer = open_writer(
        args.out_dir / "sensor_history.csv",
        [
            "timestamp",
            "sensor_id",
            "room_id",
            "sensor_type",
            "value",
            "unit",
            "source",
            "sequence",
            "generated_at_utc"
        ]
    )

    truth_file, truth_writer = open_writer(
        args.out_dir / "ground_truth_labels.csv",
        [
            "timestamp",
            "sensor_id",
            "room_id",
            "fault_active",
            "scenario",
            "event_id"
        ]
    )

    delivery_file, delivery_writer = open_writer(
        args.out_dir / "delivery_log.csv",
        [
            "sequence",
            "generated_at_utc",
            "http_status",
            "http_ack_ms",
            "error"
        ]
    )

    events_file, events_writer = open_writer(
        args.out_dir / "ground_truth_events.csv",
        [
            "event_id",
            "sensor_id",
            "room_id",
            "sensor_type",
            "scenario",
            "start",
            "end",
            "duration_minutes",
            "severity",
            "seed"
        ]
    )
    
    abnormal_file, abnormal_writer = open_writer(
        args.out_dir / 'abnormal_dataset.csv',
        ['timestamp', 'sensor_id', 'room_id',
        'sensor_type', 'value', 'unit',
        'fault_active', 'scenario', 'event_id']
    )

    logged_events = set()

    # --------------------------------------------------------
    # Continuous simulation
    # --------------------------------------------------------

    try:
        tick = 0

        while args.ticks == 0 or tick < args.ticks:

            start = time.monotonic()

            # Wall time is independent of accelerated/dataset timestamps.
            generated_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            # Generate sensor readings
            message, truth = engine.step()

            message["generated_at_utc"] = generated_at
            message["clock_domain"] = "same_host"
            message["producer"] = "bundled_level03_sop_v1.4_unverified_against_teammate_dataset"

            message["source"] = "synthetic_demo"

            message["warning"] = (
                "Synthetic data, not measurements "
                "from physical building sensors."
            )

            # ------------------------------------------------
            # NEW: Optional latest.json writing
            # ------------------------------------------------

            if (
                args.latest_every > 0
                and message["sequence"] % args.latest_every == 0
            ):
                atomic_json(
                    args.out_dir / "latest.json",
                    message
                )

            # ------------------------------------------------
            # Save historical sensor readings
            # ------------------------------------------------

            for r in message["readings"]:
                readings_writer.writerow({
                    **r,
                    "sequence": message["sequence"],
                    "generated_at_utc": message["generated_at_utc"]
                })

            # Save per-reading ground truth
            for label in truth:
                truth_writer.writerow(label)
            
            labels_by_sensor = {
                label['sensor_id']: label for label in truth
            }

            for reading in message['readings']:
                label = labels_by_sensor[reading['sensor_id']]

                if label['fault_active'] == 1:
                    abnormal_writer.writerow({
                        **{k: reading[k] for k in
                        ('timestamp', 'sensor_id', 'room_id',
                            'sensor_type', 'value', 'unit')},
                        'fault_active': 1,
                        'scenario': label['scenario'],
                        'event_id': label['event_id']
                    })

            abnormal_file.flush()

            # Save event information
            for event in engine.events:

                if event["event_id"] not in logged_events:

                    events_writer.writerow({
                        **event,
                        "start": event["start"].isoformat(),
                        "end": event["end"].isoformat()
                    })

                    logged_events.add(
                        event["event_id"]
                    )

            # Flush CSV files
            events_file.flush()
            readings_file.flush()
            truth_file.flush()

            # ------------------------------------------------
            # HTTP delivery
            # ------------------------------------------------

            delivery = {
                "sequence": message["sequence"],
                "generated_at_utc": message["generated_at_utc"],
                "http_status": "",
                "http_ack_ms": "",
                "error": ""
            }

            if args.http_url:

                try:
                    ack = post_readings(
                        args.http_url,
                        message,
                        cfg["http_timeout_seconds"]
                    )

                    delivery.update(
                        http_status=ack["http_status"],
                        http_ack_ms=ack["http_ack_ms"]
                    )

                except (URLError, OSError, RuntimeError) as error:

                    delivery["error"] = str(error)

                    print(
                        "HTTP delivery failed; "
                        "persisted locally, retry/replay needed: "
                        + str(error),
                        file=sys.stderr
                    )

            delivery_writer.writerow(delivery)
            delivery_file.flush()

            # ------------------------------------------------
            # Terminal output
            # ------------------------------------------------

            if not args.quiet:
                print(
                    f"tick={message['sequence']} "
                    f"simulated={message['simulated_time']} "
                    f"sensors={len(message['readings'])} "
                    f"delivery={delivery}",
                    flush=True
                )

            tick += 1

            # ------------------------------------------------
            # Wait until next tick
            # ------------------------------------------------

            if args.ticks == 0 or tick < args.ticks:

                elapsed = time.monotonic() - start

                time.sleep(
                    max(
                        0,
                        args.interval_seconds - elapsed
                    )
                )

    except KeyboardInterrupt:
        print(
            "Stopped by user.",
            file=sys.stderr
        )

    finally:
        readings_file.close()
        truth_file.close()
        delivery_file.close()
        events_file.close()
        abnormal_file.close()


if __name__ == "__main__":
    main()
