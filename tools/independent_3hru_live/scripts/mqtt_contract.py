"""Exact database-compatible mapping for nine active Level 5 BIM data points."""
from __future__ import annotations
from datetime import datetime, timezone
from math import isfinite

MQTT_POINTS = (
    ("SAT-501A", "HRU501A", "Supply Air Temperature", "°C"),
    ("MAT-501A", "HRU501A", "Mixed Air Temperature", "°C"),
    ("FS-501A", "HRU501A", "Supply Fan Status", "ON/OFF"),
    ("SAT-504", "HRU504", "Supply Air Temperature", "°C"),
    ("DP-504", "HRU504", "Outdoor Air Damper Position", "%"),
    ("DPCMD-504", "HRU504", "Outdoor Air Damper Command", "%"),
    ("SAT-507", "HRU507", "Supply Air Temperature", "°C"),
    ("CV-507", "HRU507", "Cooling Valve Position", "%"),
    ("S-L5-008-TEMP", "HRU507", "Room Temperature", "°C"),
)


def make_messages(message):
    """Produce broker messages only from simulator measurements, never truth labels.

    Both time fields are included: ingestion timestamp is wall-clock UTC;
    source_timestamp is the simulator's synthetic minute for provenance.
    """
    values = message["values"]
    sequence = int(message["sequence"])
    if sequence < 1:
        raise ValueError("sequence must be positive")
    sent_at = message["published_at"]
    datetime.fromisoformat(sent_at.replace("Z", "+00:00"))
    source_time = message["simulated_time"]
    if values["timestamp"] != source_time:
        raise ValueError("inconsistent simulation timestamp")
    messages = []
    for code, asset_id, measurement_type, unit in MQTT_POINTS:
        val = float(values[code])
        if not isfinite(val):
            raise ValueError(f"invalid measurement {code}")
        if code == "FS-501A":
            if val not in (0.0, 1.0):
                raise ValueError("fan status must be 0 or 1")
            val = int(val)
        payload = {
            "timestamp": sent_at,
            "source_timestamp": source_time,
            "asset_id": asset_id,
            "sensor_id": code,
            "point_code": code,
            "reading_type": measurement_type,
            "value": val,
            "unit": unit,
            "sequence": sequence,
            "quality": "simulated",
            "generation_mode": "independent_simulation",
            "provenance": "STATEFUL_SYNTHETIC_TRAIN_CALIBRATED_THREE_HRU",
        }
        messages.append((f"dt/{asset_id}/{code}", payload))
    return messages

