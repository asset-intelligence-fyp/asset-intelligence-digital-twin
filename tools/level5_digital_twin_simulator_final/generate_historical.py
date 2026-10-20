#!/usr/bin/env python3
"""
Generate the Level 5 NORMAL historical dataset.

Preferred mode:
    Use the LBNL fault-free AHU_annual.csv as the source signal.

Fallback mode:
    Generate a deterministic rule-based source when the LBNL CSV is not available.

Outputs:
    level5_normal_wide.csv  -> one row per minute, useful for AI/model training
    level5_normal_long.csv  -> optional, one row per sensor reading
    generation_summary.json -> traceability and statistics

Important:
    This is a PoC hybrid dataset. LBNL-derived points preserve source temporal
    behaviour; room humidity/CO2 and local air-velocity scaling are synthetic
    augmentations based on explicit assumptions in config/simulation_config.json.
"""

from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
REGISTRY_PATH = ROOT / "config" / "level5_points.json"
CONFIG_PATH = ROOT / "config" / "simulation_config.json"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def f_to_c(x):
    return (pd.to_numeric(x, errors="coerce") - 32.0) * 5.0 / 9.0


def smooth_noise(rng, n, sd=1.0, alpha=0.985):
    eps = rng.normal(0.0, sd, size=n)
    out = np.zeros(n, dtype=float)
    for i in range(1, n):
        out[i] = alpha * out[i - 1] + (1.0 - alpha) * eps[i]
    return out


def detect_timestamp(df: pd.DataFrame, start: str):
    candidates = [
        "timestamp", "datetime", "date_time", "date time",
        "time", "date", "Timestamp", "DateTime", "Datetime"
    ]
    for c in candidates:
        if c in df.columns:
            ts = pd.to_datetime(df[c], errors="coerce")
            if ts.notna().mean() > 0.95:
                return ts
    # Some source files keep time in the first unnamed/index-like column.
    first = df.columns[0]
    ts = pd.to_datetime(df[first], errors="coerce")
    if ts.notna().mean() > 0.95:
        return ts
    return pd.date_range(start=start, periods=len(df), freq="1min")


def numeric_col(df, name, default=np.nan):
    if name not in df.columns:
        if np.isscalar(default):
            return pd.Series(np.full(len(df), default), index=df.index, dtype=float)
        return pd.Series(default, index=df.index, dtype=float)
    return pd.to_numeric(df[name], errors="coerce")


def source_from_lbnl(path: Path, start: str):
    df = pd.read_csv(path)
    required = ["SA_TEMP", "SA_CFM", "SF_SPD_DM", "ZONE_TEMP_1"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(
            "LBNL CSV is missing required columns: " + ", ".join(missing)
            + ". Expected the fault-free AHU_annual.csv file."
        )
    ts = detect_timestamp(df, start)
    out = pd.DataFrame({"timestamp": ts})
    out["SA_TEMP_C"] = f_to_c(df["SA_TEMP"])
    out["SA_CFM"] = numeric_col(df, "SA_CFM").interpolate(limit_direction="both")
    out["FAN"] = numeric_col(df, "SF_SPD_DM", 0).fillna(0).round().clip(0, 1)
    out["ZONE_TEMP_C"] = f_to_c(df["ZONE_TEMP_1"]).interpolate(limit_direction="both")
    if "OA_TEMP" in df.columns:
        out["OA_TEMP_C"] = f_to_c(df["OA_TEMP"]).interpolate(limit_direction="both")
    else:
        out["OA_TEMP_C"] = out["ZONE_TEMP_C"] + 2.0
    if "OA_DMPR" in df.columns:
        out["DAMPER_01"] = numeric_col(df, "OA_DMPR", 0).interpolate(limit_direction="both").clip(0, 1)
    elif "OA_DMPR_DM" in df.columns:
        out["DAMPER_01"] = numeric_col(df, "OA_DMPR_DM", 0).interpolate(limit_direction="both").clip(0, 1)
    else:
        out["DAMPER_01"] = np.where(out["FAN"] > 0, 0.25, 0.0)
    if "SYS_CTL" in df.columns:
        out["OCC_MODE"] = numeric_col(df, "SYS_CTL", 0).fillna(0).round().clip(0, 1)
    else:
        out["OCC_MODE"] = out["FAN"]
    out["source_mode"] = "lbnl_fault_free"
    return out


def occupied_from_clock(ts: pd.Series, cfg):
    dt = pd.DatetimeIndex(ts)
    h = dt.hour + dt.minute / 60.0
    dow = dt.dayofweek
    sched = cfg["fallback_schedule"]
    weekday = (dow < 5) & (h >= sched["weekday_start_hour"]) & (h < sched["weekday_end_hour"])
    saturday = (dow == 5) & (h >= sched["saturday_start_hour"]) & (h < sched["saturday_end_hour"])
    return (weekday | saturday).astype(float)


def source_rule_based(start: str, days: int, cfg, rng):
    n = int(days * 24 * 60)
    ts = pd.date_range(start=start, periods=n, freq="1min")
    occ = occupied_from_clock(pd.Series(ts), cfg)
    minute = np.arange(n)
    day_phase = 2 * np.pi * ((minute % 1440) / 1440.0 - 0.25)
    year_phase = 2 * np.pi * (minute / max(n, 525600))
    outdoor = 18.0 + 7.0 * np.sin(year_phase - 1.2) + 4.0 * np.sin(day_phase)
    outdoor += smooth_noise(rng, n, 0.8, 0.995)
    fan = occ.copy()

    sat = np.where(fan > 0, 12.8, 18.0 + 0.20 * (outdoor - 18.0))
    sat += smooth_noise(rng, n, 0.35, 0.98)

    cfm_shape = np.where(fan > 0, 0.45 + 0.30 * (np.sin(day_phase) + 1) / 2, 0.0)
    cfm_shape += smooth_noise(rng, n, 0.05, 0.97)
    cfm_shape = np.clip(cfm_shape, 0, 1)
    cfm = 400.0 + 3600.0 * cfm_shape
    cfm[fan == 0] = 0.0

    damper = np.where(fan > 0, 0.10 + 0.55 * np.clip((18 - outdoor) / 12, 0, 1), 0.0)
    damper = np.clip(damper + smooth_noise(rng, n, 0.02, 0.98), 0, 1)

    zone = np.empty(n, dtype=float)
    zone[0] = 23.0
    for i in range(1, n):
        # Simplified occupied control plus unoccupied setback protection.
        # This prevents the fallback "normal" room from drifting to unrealistic
        # outdoor-like temperatures overnight.
        if occ[i]:
            setpoint = 22.5
            hvac = 0.028 * (setpoint - zone[i - 1])
        else:
            if zone[i - 1] < 18.0:
                hvac = 0.020 * (19.0 - zone[i - 1])
            elif zone[i - 1] > 27.0:
                hvac = 0.020 * (26.0 - zone[i - 1])
            else:
                hvac = 0.0
        envelope = 0.0008 * (outdoor[i] - zone[i - 1])
        zone[i] = zone[i - 1] + hvac + envelope + rng.normal(0, 0.005)

    return pd.DataFrame({
        "timestamp": ts,
        "SA_TEMP_C": sat,
        "SA_CFM": cfm,
        "FAN": fan,
        "ZONE_TEMP_C": zone,
        "OA_TEMP_C": outdoor,
        "DAMPER_01": damper,
        "OCC_MODE": occ,
        "source_mode": "rule_based_fallback",
    })


def normalize_flow(cfm: pd.Series, fan: pd.Series):
    active = cfm[fan > 0.5]
    if len(active) < 10:
        return np.zeros(len(cfm), dtype=float)
    lo = np.nanpercentile(active, 5)
    hi = np.nanpercentile(active, 95)
    if hi <= lo:
        hi = lo + 1.0
    return np.clip((cfm.to_numpy() - lo) / (hi - lo), 0, 1)


def livework_occupancy(timestamp: pd.Series, occ_mode: np.ndarray, rng):
    """Smooth, deterministic PoC occupancy for Live/Work Unit 507."""
    dt = pd.DatetimeIndex(timestamp)
    h = dt.hour + dt.minute / 60.0
    dow = dt.dayofweek

    base = np.zeros(len(dt), dtype=float)
    weekday = dow < 5
    weekend = ~weekday

    base[weekday & (h >= 7) & (h < 9)] = 0.45
    base[weekday & (h >= 9) & (h < 17)] = 0.75
    base[weekday & (h >= 17) & (h < 23)] = 0.50
    base[weekend & (h >= 9) & (h < 23)] = 0.55

    # Keep a small residential/live-work presence even when central AHU mode is off.
    base = np.maximum(base, 0.08)
    # Use source occupancy mode as an additional signal, not the sole source.
    base = np.clip(0.70 * base + 0.30 * occ_mode, 0, 1)
    jitter = smooth_noise(rng, len(dt), 0.12, 0.995)
    return np.clip(base + jitter, 0, 1)


def augment_room507(df: pd.DataFrame, v507: np.ndarray, cfg, rng):
    room = cfg["room507"]
    n = len(df)
    occ_fraction = livework_occupancy(df["timestamp"], df["OCC_MODE"].to_numpy(), rng)
    max_occ = int(room["max_occupants_assumption"])
    occupants = np.clip(np.rint(occ_fraction * max_occ), 0, max_occ).astype(int)

    temp = df["ZONE_TEMP_C"].to_numpy() + smooth_noise(rng, n, 0.10, 0.992)

    # Relative humidity: smooth dynamic response to occupancy and ventilation.
    rh = np.empty(n, dtype=float)
    rh[0] = room["humidity_target_unoccupied_pct"]
    for i in range(1, n):
        target = (
            room["humidity_target_unoccupied_pct"]
            + (room["humidity_target_occupied_pct"] - room["humidity_target_unoccupied_pct"])
            * occ_fraction[i]
        )
        ventilation_effect = 0.30 * (v507[i] / max(0.1, np.nanmax(v507)))
        target -= ventilation_effect
        rh[i] = rh[i - 1] + 0.015 * (target - rh[i - 1]) + rng.normal(0, 0.035)
    rh = np.clip(rh, 30, 70)

    # CO2 mass-balance approximation.
    volume = float(room["zone_volume_m3_assumption"])
    outside = float(room["outdoor_co2_ppm_assumption"])
    g_m3_s_person = float(room["co2_generation_l_s_per_person_assumption"]) / 1000.0
    duct_area = float(room["supply_duct_area_m2_assumption"])
    infiltration = float(room["minimum_infiltration_m3_s_assumption"])
    dt_s = 60.0

    co2 = np.empty(n, dtype=float)
    co2[0] = 500.0
    for i in range(1, n):
        q = max(infiltration, float(v507[i]) * duct_area)
        generation_ppm_s = (occupants[i] * g_m3_s_person / volume) * 1_000_000.0
        ventilation_ppm_s = (q / volume) * (outside - co2[i - 1])
        co2[i] = co2[i - 1] + dt_s * (generation_ppm_s + ventilation_ppm_s)
        co2[i] += rng.normal(0, 1.2)
    co2 = np.clip(co2, outside, 1800)

    return temp, rh, co2, occupants


def build_level5(source: pd.DataFrame, cfg, seed: int):
    rng = np.random.default_rng(seed)
    n = len(source)
    fan = source["FAN"].to_numpy().astype(float)
    flow_norm = normalize_flow(source["SA_CFM"], source["FAN"])

    env = cfg["velocity_envelopes_m_s"]
    def velocity(asset, phase=0.0):
        vmax = float(env[asset][1])
        # preserve source airflow shape; add only small smooth equipment variation
        variation = 0.06 * np.sin(np.linspace(phase, phase + 16 * np.pi, n))
        variation += smooth_noise(rng, n, 0.04, 0.985)
        v = fan * vmax * np.clip(0.18 + 0.78 * flow_norm + variation, 0, 1)
        return np.clip(v, 0, vmax)

    v501 = velocity("HRU501A", 0.0)
    v504 = velocity("HRU504", 1.2)
    v507 = velocity("HRU507", 2.1)

    offsets = cfg["supply_temperature_offsets_c"]
    sat_base = source["SA_TEMP_C"].interpolate(limit_direction="both").to_numpy()
    sat501 = sat_base + offsets["HRU501A"] + smooth_noise(rng, n, 0.07, 0.97)
    sat504 = sat_base + offsets["HRU504"] + smooth_noise(rng, n, 0.08, 0.97)
    sat507 = sat_base + offsets["HRU507"] + smooth_noise(rng, n, 0.08, 0.97)

    damper = np.clip(source["DAMPER_01"].to_numpy() * 100.0
                     + smooth_noise(rng, n, 0.8, 0.98), 0, 100)

    room_temp, rh, co2, occupants = augment_room507(source, v507, cfg, rng)

    out = pd.DataFrame({
        "timestamp": pd.to_datetime(source["timestamp"]),
        "SAT-501A": sat501,
        "AF-501A": v501,
        "FS-501A": fan.round(),
        "SAT-504": sat504,
        "AF-504": v504,
        "DP-504": damper,
        "SAT-507": sat507,
        "AF-507": v507,
        "S-L5-008-TEMP": room_temp,
        "S-L5-008-HUM": rh,
        "S-L5-008-CO2": co2,
        "occupancy_507": occupants,
        "source_mode": source["source_mode"].astype(str),
        "scenario": "normal",
        "is_anomaly": 0,
    })

    # Round only at the final output stage.
    for c in ["SAT-501A", "AF-501A", "SAT-504", "AF-504",
              "DP-504", "SAT-507", "AF-507", "S-L5-008-TEMP",
              "S-L5-008-HUM", "S-L5-008-CO2"]:
        out[c] = out[c].astype(float).round(2)
    out["FS-501A"] = out["FS-501A"].astype(int)
    out["occupancy_507"] = out["occupancy_507"].astype(int)
    return out


def wide_to_long(wide: pd.DataFrame, registry: dict, quality: str):
    meta = {p["point_code"]: p for p in registry["points"]}
    frames = []
    for point_code, p in meta.items():
        if point_code not in wide.columns:
            continue
        f = pd.DataFrame({
            "timestamp": wide["timestamp"],
            "asset_id": p["asset_id"],
            "sensor_id": p["sensor_id"],
            "point_code": point_code,
            "measurement_type": p["measurement_type"],
            "value": wide[point_code],
            "unit": p["unit"],
            "quality": quality,
            "data_source": "LBNL+synthetic" if wide["source_mode"].iloc[0] == "lbnl_fault_free" else "rule_based_simulator",
            "generation_method": p["source_method"],
            "scenario": "normal",
            "is_anomaly": 0,
        })
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


def summary_dict(wide: pd.DataFrame, mode: str, source_path: str | None, cfg: dict):
    measurement_cols = [
        c for c in wide.columns
        if c not in {"timestamp", "occupancy_507", "source_mode", "scenario", "is_anomaly"}
    ]
    return {
        "rows": int(len(wide)),
        "start": str(wide["timestamp"].iloc[0]),
        "end": str(wide["timestamp"].iloc[-1]),
        "frequency": "1 minute",
        "mode": mode,
        "source_file": source_path,
        "scenario": "normal",
        "is_anomaly": 0,
        "assumptions": cfg["room507"],
        "statistics": {
            c: {
                "min": float(wide[c].min()),
                "mean": float(wide[c].mean()),
                "max": float(wide[c].max()),
            }
            for c in measurement_cols
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["lbnl", "rule"], default="lbnl")
    ap.add_argument("--source-lbnl", type=str, default=None,
                    help="Path to LBNL fault-free AHU_annual.csv (required for --mode lbnl)")
    ap.add_argument("--start", default="2025-01-01 00:00:00")
    ap.add_argument("--days", type=int, default=365,
                    help="Used only for --mode rule")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output-dir", default=str(ROOT / "data" / "generated"))
    ap.add_argument("--long", action="store_true",
                    help="Also export PostgreSQL-friendly long-format CSV")
    args = ap.parse_args()

    cfg = load_json(CONFIG_PATH)
    registry = load_json(REGISTRY_PATH)
    rng = np.random.default_rng(args.seed)

    if args.mode == "lbnl":
        if not args.source_lbnl:
            raise SystemExit(
                "For --mode lbnl, provide --source-lbnl /path/to/AHU_annual.csv"
            )
        source_path = Path(args.source_lbnl).expanduser().resolve()
        source = source_from_lbnl(source_path, args.start)
        source_file = str(source_path)
    else:
        source = source_rule_based(args.start, args.days, cfg, rng)
        source_file = None

    wide = build_level5(source, cfg, args.seed)
    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    wide_path = out_dir / "level5_normal_wide.csv"
    wide.to_csv(wide_path, index=False)

    if args.long:
        long_df = wide_to_long(wide, registry, cfg["dataset"]["quality"])
        long_path = out_dir / "level5_normal_long.csv"
        long_df.to_csv(long_path, index=False)
    else:
        long_path = None

    summary = summary_dict(wide, args.mode, source_file, cfg)
    summary_path = out_dir / "generation_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Generated {len(wide):,} one-minute rows")
    print(f"WIDE: {wide_path}")
    if long_path:
        print(f"LONG: {long_path}")
    print(f"SUMMARY: {summary_path}")


if __name__ == "__main__":
    main()
