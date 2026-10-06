from __future__ import annotations

import json
import math
import random
import threading
import time
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Override:
    mode: str = "normal"          # normal/high/low/spike/drift/stuck/fixed
    severity: float = 1.0
    fixed_value: Optional[float] = None
    until_epoch: Optional[float] = None
    drift_offset: float = 0.0
    stuck_value: Optional[float] = None


@dataclass
class SensorState:
    asset_id: str
    sensor_id: str
    cfg: dict
    value: float
    sequence: int = 0
    override: Override = field(default_factory=Override)


class SimulationEngine:
    def __init__(self, assets_path: Path | None = None, seed: int = 42):
        assets_path = assets_path or ROOT / "config" / "assets.json"
        self.config = json.loads(Path(assets_path).read_text(encoding="utf-8"))
        self.rng = random.Random(seed)
        self.lock = threading.RLock()
        self.states: Dict[str, SensorState] = {}
        self.active_scenarios: Dict[str, dict] = {}
        self._init_states()

    def _init_states(self):
        for asset_id, asset_cfg in self.config["assets"].items():
            for sensor_id, cfg in asset_cfg["sensors"].items():
                self.states[sensor_id] = SensorState(
                    asset_id=asset_id,
                    sensor_id=sensor_id,
                    cfg=deepcopy(cfg),
                    value=float(cfg["baseline"]),
                )

    @staticmethod
    def utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_state(self) -> dict:
        with self.lock:
            assets = {}
            for sensor in self.states.values():
                assets.setdefault(sensor.asset_id, [])
                assets[sensor.asset_id].append(self._public_sensor(sensor))
            return {
                "assets": assets,
                "active_scenarios": list(self.active_scenarios.values())
            }

    def _public_sensor(self, s: SensorState) -> dict:
        return {
            "asset_id": s.asset_id,
            "sensor_id": s.sensor_id,
            "display_name": s.cfg.get("display_name", s.sensor_id),
            "reading_type": s.cfg["reading_type"],
            "unit": s.cfg.get("unit", ""),
            "value": round(float(s.value), 4),
            "normal_min": s.cfg["normal_min"],
            "normal_max": s.cfg["normal_max"],
            "sequence": s.sequence,
            "mode": s.override.mode,
        }

    def set_sensor_override(
        self,
        sensor_id: str,
        mode: str,
        severity: float = 1.0,
        duration_seconds: Optional[float] = None,
        fixed_value: Optional[float] = None,
    ):
        if sensor_id not in self.states:
            raise KeyError(sensor_id)
        if mode not in {"normal", "high", "low", "spike", "drift", "stuck", "fixed"}:
            raise ValueError("Unsupported mode")
        if mode == "fixed" and fixed_value is None:
            raise ValueError("fixed_value is required for fixed mode")

        with self.lock:
            s = self.states[sensor_id]
            until = time.time() + duration_seconds if duration_seconds else None
            stuck = s.value if mode == "stuck" else None
            s.override = Override(
                mode=mode,
                severity=max(0.1, float(severity)),
                fixed_value=fixed_value,
                until_epoch=until,
                stuck_value=stuck,
            )

    def clear_sensor_override(self, sensor_id: str):
        self.set_sensor_override(sensor_id, "normal")

    def clear_all(self):
        with self.lock:
            for s in self.states.values():
                s.override = Override()
            self.active_scenarios.clear()

    def trigger_scenario(self, scenario_id: str, duration_seconds: float = 60, severity: float = 1.0):
        end = time.time() + duration_seconds
        with self.lock:
            if scenario_id == "HRU501A_AIRFLOW_LOW":
                self._set_override_locked("FAN-501A", "fixed", severity, end, 1)
                self._set_override_locked("AF-501A", "low", severity, end)

            elif scenario_id == "HRU501A_FAN_AIRFLOW_CONFLICT":
                self._set_override_locked("FAN-501A", "fixed", severity, end, 0)
                self._set_override_locked("AF-501A", "high", severity, end)

            elif scenario_id == "HRU504_DAMPER_STUCK":
                self._set_override_locked("DMP-504", "stuck", severity, end)

            elif scenario_id == "HRU504_PRESSURE_HIGH":
                self._set_override_locked("SP-504", "high", severity, end)

            elif scenario_id == "HRU507_AIRFLOW_LOW_ZONE_DRIFT":
                self._set_override_locked("AF-507", "low", severity, end)
                self._set_override_locked("ZT-507", "drift", severity, end)

            elif scenario_id == "HRU507_ZONE_SENSOR_STUCK":
                self._set_override_locked("ZT-507", "stuck", severity, end)

            else:
                raise KeyError(scenario_id)

            self.active_scenarios[scenario_id] = {
                "id": scenario_id,
                "duration_seconds": duration_seconds,
                "severity": severity,
                "started_at": self.utc_now_iso(),
                "until_epoch": end,
            }

    def _set_override_locked(self, sensor_id, mode, severity, until_epoch, fixed_value=None):
        s = self.states[sensor_id]
        s.override = Override(
            mode=mode,
            severity=max(0.1, float(severity)),
            fixed_value=fixed_value,
            until_epoch=until_epoch,
            stuck_value=s.value if mode == "stuck" else None,
        )

    def step(self, simulated_hour: Optional[int] = None) -> list[dict]:
        with self.lock:
            self._expire_overrides()
            records = []
            for sensor in self.states.values():
                value, truth_state, anomaly_type = self._next_value(sensor, simulated_hour)
                sensor.value = value
                sensor.sequence += 1
                records.append({
                    "timestamp": self.utc_now_iso(),

                    "asset_id": sensor.asset_id,

                    # Physical sensor device
                    "physical_sensor_id": sensor.cfg.get(
                        "physical_sensor_id",
                        sensor.sensor_id
                    ),

                    # Individual measurement channel
                    "point_code": sensor.sensor_id,

                    "reading_type": sensor.cfg["reading_type"],
                    "value": round(float(value), 4),
                    "unit": sensor.cfg.get("unit", ""),
                    "sequence": sensor.sequence,

                    "ground_truth_state": truth_state,
                    "ground_truth_anomaly_type": anomaly_type,
                })
            return records

    def _expire_overrides(self):
        now = time.time()
        for sensor in self.states.values():
            ov = sensor.override
            if ov.until_epoch is not None and now >= ov.until_epoch:
                sensor.override = Override()

        expired = [
            k for k, v in self.active_scenarios.items()
            if v["until_epoch"] <= now
        ]
        for k in expired:
            self.active_scenarios.pop(k, None)

    def _normal_target(self, sensor: SensorState, simulated_hour: Optional[int]) -> float:
        cfg = sensor.cfg
        baseline = float(cfg["baseline"])

        # Synthetic daily pattern. It is deliberately mild and is not an
        # engineering claim about the selected HRUs.
        if simulated_hour is not None and not cfg.get("binary"):
            phase = 2 * math.pi * (simulated_hour / 24.0)
            span = float(cfg["normal_max"]) - float(cfg["normal_min"])
            baseline += 0.08 * span * math.sin(phase)

        return baseline

    def _normal_value(self, sensor: SensorState, simulated_hour: Optional[int]) -> float:
        cfg = sensor.cfg
        if cfg.get("binary"):
            # Simple synthetic schedule: fan ON from 07:00 to 19:00 in
            # historical generation; live mode defaults to ON.
            if simulated_hour is None:
                return 1.0
            return 1.0 if 7 <= simulated_hour < 19 else 0.0

        low = float(cfg["normal_min"])
        high = float(cfg["normal_max"])
        target = self._normal_target(sensor, simulated_hour)
        noise = self.rng.gauss(0, float(cfg.get("noise_std", 0.05)))
        value = sensor.value + (target - sensor.value) * 0.08 + noise
        return max(low, min(high, value))

    def _next_value(self, sensor: SensorState, simulated_hour: Optional[int]) -> Tuple[float, str, str]:
        cfg = sensor.cfg
        ov = sensor.override
        low = float(cfg["normal_min"])
        high = float(cfg["normal_max"])
        width = max(high - low, 1.0)

        if ov.mode == "normal":
            return self._normal_value(sensor, simulated_hour), "normal", "none"

        if ov.mode == "fixed":
            v = float(ov.fixed_value)
            return v, "abnormal", "fixed"

        if ov.mode == "high":
            v = self.rng.uniform(high + 0.10 * width * ov.severity,
                                 high + 0.45 * width * ov.severity)
            return v, "abnormal", "high"

        if ov.mode == "low":
            v = self.rng.uniform(low - 0.45 * width * ov.severity,
                                 low - 0.10 * width * ov.severity)
            return v, "abnormal", "low"

        if ov.mode == "spike":
            if self.rng.random() < min(0.75, 0.35 + 0.15 * ov.severity):
                direction = 1 if self.rng.random() < 0.5 else -1
                if direction > 0:
                    v = self.rng.uniform(high + .2 * width, high + .8 * width * ov.severity)
                else:
                    v = self.rng.uniform(low - .8 * width * ov.severity, low - .2 * width)
                return v, "abnormal", "spike"
            return self._normal_value(sensor, simulated_hour), "normal", "none"

        if ov.mode == "drift":
            ov.drift_offset += width * 0.015 * ov.severity
            normal = self._normal_value(sensor, simulated_hour)
            v = normal + ov.drift_offset
            state = "abnormal" if v > high else "normal"
            return v, state, "drift" if state == "abnormal" else "drift_developing"

        if ov.mode == "stuck":
            if ov.stuck_value is None:
                ov.stuck_value = sensor.value
            # tiny jitter makes it look like a sensor that is nearly frozen
            v = float(ov.stuck_value) + self.rng.gauss(0, max(float(cfg.get("noise_std", .01)) * .02, .0001))
            return v, "abnormal", "stuck"

        return self._normal_value(sensor, simulated_hour), "normal", "none"
