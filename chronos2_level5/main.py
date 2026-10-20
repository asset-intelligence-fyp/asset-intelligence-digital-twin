"""Level 5: frozen Amazon Chronos-2, 11 joint targets, CPU-only zero-shot evaluation.

No resplitting, interpolation, training, future covariates, or metadata inputs.
Original three-channel code is preserved in legacy_hru507.py.
"""
from __future__ import annotations

import argparse
import csv
import importlib.metadata
import json
import platform
import random
import shutil
import sys
import threading
import time
import traceback
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import psutil

# Reuse the working checksum and deterministic origin selector from the old study.
from legacy_hru507 import data_sha256, origins_for_segment

ROOT = Path(__file__).resolve().parent
COLS = ("SAT-501A", "AF-501A", "FS-501A", "SAT-504", "AF-504", "DP-504",
        "SAT-507", "AF-507", "S-L5-008-TEMP", "S-L5-008-HUM", "S-L5-008-CO2")
HORIZONS = (5, 10, 15)
CONTEXT = 60
PREDICTION_LENGTH = 15
QUANTILES = (0.1, 0.5, 0.9)
MODEL_ID = "amazon/chronos-2"
MODEL_REVISION = "29ec3766d36d6f73f0696f85560a422f50e8498c"
PARTITIONS = {"train": "level5_normal_train.csv", "validation": "level5_normal_validation.csv",
              "test": "level5_normal_live_holdout.csv"}
EXCLUDED = ("occupancy_507", "source_mode", "scenario", "is_anomaly")
UNITS = {c: ("binary 0/1" if c.startswith("FS-") else
             "native airflow unit (unverified)" if c.startswith("AF-") else
             "native pressure unit (unverified)" if c.startswith("DP-") else
             "%RH (inferred)" if c.endswith("HUM") else
             "ppm (inferred)" if c.endswith("CO2") else "degC (inferred)") for c in COLS}


@dataclass
class Settings:
    data_dir: str = str(ROOT / "data")
    output: str = str(ROOT / "outputs_level5")
    device: str = "cpu"
    batch_size: int = 1  # Complete 11-channel forecasting tasks, not individual channels.
    validation_origins: int = 32
    test_origins: int = 64
    threads: int = 4
    seed: int = 42
    audit_only: bool = False
    baseline_only: bool = False
    smoke_test: bool = False


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


class ResourceMonitor:
    """Process RSS/CPU and system available-memory floor, sampled every 0.2s."""
    def __init__(self):
        self.process = psutil.Process()
        self.stop = threading.Event()
        self.started = time.perf_counter()
        self.cpu_start = sum(self.process.cpu_times()[:2])
        self.peak_rss = 0
        self.min_available = psutil.virtual_memory().available
        self.sample()
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def sample(self):
        self.peak_rss = max(self.peak_rss, self.process.memory_info().rss)
        self.min_available = min(self.min_available, psutil.virtual_memory().available)

    def loop(self):
        while not self.stop.wait(0.2):
            self.sample()

    def finish(self):
        self.stop.set()
        self.thread.join()
        self.sample()
        elapsed = time.perf_counter() - self.started
        cpu = sum(self.process.cpu_times()[:2]) - self.cpu_start
        return {"wall_seconds": elapsed, "process_cpu_seconds": cpu,
                "process_cpu_percent_one_core_basis": 100 * cpu / max(elapsed, 1e-9),
                "peak_process_rss_bytes_sampled": self.peak_rss,
                "minimum_system_available_ram_bytes_sampled": self.min_available,
                "sample_interval_seconds": 0.2}


def physical_violations(values: np.ndarray, sensor: str, predictions=False) -> int:
    if sensor.startswith("FS-"):
        # Continuous regression predictions are allowed; interpret status separately.
        return int(((values < 0) | (values > 1)).sum()) if predictions else int((~np.isin(values, [0, 1])).sum())
    if sensor.endswith("HUM"):
        return int(((values < 0) | (values > 100)).sum())
    if sensor.startswith(("AF-", "DP-")) or sensor.endswith("CO2"):
        return int((values < 0).sum())
    return 0  # No equipment-specific temperature limits supplied.


def longest_constant_run(x):
    if not len(x):
        return 0
    cuts = np.r_[0, np.flatnonzero(x[1:] != x[:-1]) + 1, len(x)]
    return int(np.diff(cuts).max())


def audit_datasets(data_dir):
    frames, reports, issues, splits = [], {}, [], {}
    offset = 0
    for name, filename in PARTITIONS.items():
        path = Path(data_dir) / filename
        with path.open(encoding="utf-8-sig", newline="") as stream:
            headers = next(csv.reader(stream))
        if len(headers) != len(set(headers)):
            raise ValueError(f"Duplicate CSV column names in {path}")
        df = pd.read_csv(path, low_memory=False)
        missing = set(("timestamp", *COLS)) - set(df.columns)
        if missing:
            raise ValueError(f"{filename} missing columns: {sorted(missing)}")
        info = {"file": str(path.resolve()), "sha256": data_sha256(path),
                "size_bytes": path.stat().st_size, "rows": len(df), "headers": headers,
                "csv_inferred_dtypes": {c: str(t) for c, t in df.dtypes.items()},
                "missing_by_column": {c: int(v) for c, v in df.isna().sum().items()},
                "duplicate_rows": int(df.duplicated().sum()),
                "excluded_metadata": [c for c in df.columns if c not in ("timestamp", *COLS)],
                "metadata_values": {c: {str(k): int(v) for k, v in df[c].value_counts(dropna=False).items()}
                    for c in df.columns if c not in ("timestamp", *COLS) and df[c].nunique(dropna=False) <= 30}}
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        ts = df.timestamp
        info.update({"timestamp_start": str(ts.iloc[0]) if len(ts) else None,
                     "timestamp_end": str(ts.iloc[-1]) if len(ts) else None,
                     "invalid_timestamps": int(ts.isna().sum()), "duplicate_timestamps": int(ts.duplicated().sum()),
                     "timestamps_increasing": bool(ts.is_monotonic_increasing),
                     "interval_seconds_counts": {str(k): int(v) for k, v in
                         ts.diff().dt.total_seconds().dropna().value_counts().items()}})
        if (len(df) < 15 or ts.isna().any() or ts.duplicated().any() or not ts.is_monotonic_increasing
                or not ts.diff().iloc[1:].eq(pd.Timedelta(minutes=1)).all()):
            issues.append(f"{name}: invalid, repeated, unordered or non-one-minute timestamps")
        summaries = {}
        for sensor in COLS:
            numeric = pd.to_numeric(df[sensor], errors="coerce")
            x = numeric.to_numpy(dtype=np.float64)
            finite = x[np.isfinite(x)]
            violations = physical_violations(finite, sensor)
            summaries[sensor] = {"units": UNITS[sensor], "n_nonfinite": int((~np.isfinite(x)).sum()),
                "min": float(finite.min()) if len(finite) else None,
                "max": float(finite.max()) if len(finite) else None,
                "mean": float(finite.mean()) if len(finite) else None,
                "std_ddof0": float(finite.std()) if len(finite) else None,
                "unique_values": int(numeric.nunique()), "constant": bool(numeric.nunique() == 1),
                "unchanged_fraction": float(np.mean(x[1:] == x[:-1])) if len(x) > 1 else None,
                "longest_constant_run_minutes": longest_constant_run(x),
                "physical_range_violations": violations}
            if not np.isfinite(x).all() or violations:
                issues.append(f"{name}/{sensor}: invalid values or physical range violations")
            df[sensor] = numeric
        info["sensors"] = summaries
        reports[name] = info
        splits[name] = (offset, offset + len(df))
        offset += len(df)
        frames.append(df[["timestamp", *COLS]])
    combined = pd.concat(frames, ignore_index=True)  # supplied order, not a new split
    ts = combined.timestamp
    if ts.isna().any() or ts.duplicated().any() or not ts.diff().iloc[1:].eq(pd.Timedelta(minutes=1)).all():
        issues.append("Partitions overlap, are out of order or have a boundary gap")
    report = {"schema_version": 1, "partitions": reports, "total_rows": len(combined),
              "split_global_indices_end_exclusive": splits, "issues": issues,
              "source_datasets_modified": False, "resplit_or_shuffled": False,
              "timezone": "Not supplied; naive timestamps retained without timezone conversion",
              "provenance": "source_mode is a CSV claim, not independent provenance verification. "
                  "No Level 5 generation script, calibration or unit dictionary supplied. "
                  "Do not transfer old three-sensor provenance to these different CSVs.",
              "physical_checks": "Humidity [0,100], CO2/airflow/DP nonnegative, fan {0,1}. "
                  "No equipment temperature or upper airflow/DP limits supplied."}
    return combined, splits, report


def training_statistics(df, train_end):
    x = df.loc[:train_end - 1, COLS].to_numpy(dtype=np.float64)
    if len(x) <= 15:
        raise ValueError("Training partition too short for event thresholds")
    scales, thresholds, behavior = {}, {}, {}
    for j, sensor in enumerate(COLS):
        std = float(x[:, j].std(ddof=0))
        scales[sensor] = std if std > 1e-8 else None
        thresholds[sensor] = {str(h): float(np.quantile(np.abs(x[h:, j] - x[:-h, j]), 0.98))
                              for h in range(1, 16)}
        behavior[sensor] = {"training_std": std, "normalization_scale": scales[sensor],
                            "constant_train": bool(np.ptp(x[:, j]) == 0),
                            "near_constant_train": std <= 0.001 * max(1., abs(float(x[:, j].mean())))}
    return scales, thresholds, behavior


def make_origins(df, splits, counts):
    rows = []
    for split in ("validation", "test"):
        a, b = splits[split]
        for i, t in enumerate(origins_for_segment(a, b, counts[split], CONTEXT)):
            t = int(t)
            rows.append({"split": split, "origin_id": f"{split}_{i:06d}", "origin_global_index": t,
                "context_start_global_index": t - 59, "context_end_global_index": t,
                "target_start_global_index": t + 1, "target_end_global_index": t + 15,
                "origin_timestamp": str(df.timestamp.iloc[t]),
                "context_start_timestamp": str(df.timestamp.iloc[t - 59]),
                "target_start_timestamp": str(df.timestamp.iloc[t + 1]),
                "target_end_timestamp": str(df.timestamp.iloc[t + 15])})
    return pd.DataFrame(rows)


def forecast_windows(pipeline, arr, origins, context=CONTEXT, batch_size=1):
    """Inference boundary: only a copy of <=origin history passes to Chronos."""
    if context != CONTEXT or batch_size < 1 or arr.ndim != 2 or arr.shape[1] != 11:
        raise ValueError("Expected context=60, positive batch size, and [time,11] array")
    origins = np.asarray(origins)
    if origins.ndim != 1 or not np.issubdtype(origins.dtype, np.integer):
        raise ValueError("Origins must be a one-dimensional integer array")
    if np.any(origins < context - 1) or np.any(origins >= len(arr)):
        raise ValueError("Origin has insufficient history or is outside observed rows")
    result = {}
    for start in range(0, len(origins), batch_size):
        batch = origins[start:start + batch_size]
        windows = np.stack([arr[int(t) - 59:int(t) + 1].T for t in batch]).astype("float32")
        if windows.shape != (len(batch), 11, 60) or not np.isfinite(windows).all():
            raise ValueError("Invalid past-only model input")
        # Official batch size counts variates; CLI batch size counts complete tasks.
        quants, points = pipeline.predict_quantiles(windows, prediction_length=15,
            quantile_levels=list(QUANTILES), batch_size=batch_size * 11,
            context_length=60, cross_learning=False)
        if len(quants) != len(batch) or len(points) != len(batch):
            raise RuntimeError("Wrong number of returned forecasting tasks")
        for i, t in enumerate(batch):
            q = np.asarray(quants[i], dtype=np.float64)
            p = np.asarray(points[i], dtype=np.float64)
            if q.shape != (11, 15, 3) or p.shape != (11, 15):
                raise RuntimeError(f"Unexpected Chronos shapes: {q.shape}, {p.shape}")
            if not np.isfinite(q).all() or not np.isfinite(p).all():
                raise ValueError("Nonfinite model prediction")
            if not np.allclose(p, q[..., 1], atol=1e-6, rtol=1e-6):
                raise ValueError("Point output is not requested p50")
            if np.any(np.diff(q, axis=-1) < -1e-6):
                raise ValueError("Crossed p10/p50/p90 quantiles; raw output requires investigation")
            result[int(t)] = (q[..., 1].copy(), q)
        print(f"  Forecasted {min(start + batch_size, len(origins))}/{len(origins)} joint origins", flush=True)
    return result


def build_prediction_rows(df, origins, forecasts, model):
    values = df.loc[:, COLS].to_numpy(dtype=np.float64)
    rows = []
    for o in origins.itertuples(index=False):
        t = o.origin_global_index
        if forecasts is None:
            med = np.repeat(values[t, :, None], 15, axis=1)
            q = np.full((11, 15, 3), np.nan)
        else:
            med, q = forecasts[t]
        for j, sensor in enumerate(COLS):
            for h in range(1, 16):
                rows.append({"split": o.split, "model": model, "origin_id": o.origin_id,
                    "origin_global_index": t, "origin_timestamp": df.timestamp.iloc[t],
                    "target_timestamp": df.timestamp.iloc[t + h], "horizon_minutes": h,
                    "sensor_index": j, "sensor": sensor, "units": UNITS[sensor],
                    "actual": values[t + h, j], "predicted": med[j, h - 1],
                    "p10": q[j, h - 1, 0], "p50": q[j, h - 1, 1], "p90": q[j, h - 1, 2],
                    "persistence": values[t, j]})
    return pd.DataFrame(rows)


def score_group(g, scale):
    a, p, b = (g[c].to_numpy() for c in ("actual", "predicted", "persistence"))
    mae, rmse = float(np.abs(a - p).mean()), float(np.sqrt(np.mean((a - p)**2)))
    bm, br = float(np.abs(a - b).mean()), float(np.sqrt(np.mean((a - b)**2)))
    interval = g.p10.notna().all()
    return {"n_predictions": len(g), "n_origins": int(g.origin_id.nunique()), "mae": mae, "rmse": rmse,
            "persistence_mae": bm, "persistence_rmse": br,
            "mae_skill_vs_persistence": 1 - mae / bm if bm > 0 else np.nan,
            "rmse_skill_vs_persistence": 1 - rmse / br if br > 0 else np.nan,
            "train_scale_std": scale, "normalized_mae": mae / scale if scale else np.nan,
            "normalized_rmse": rmse / scale if scale else np.nan,
            "normalized_persistence_mae": bm / scale if scale else np.nan,
            "normalized_persistence_rmse": br / scale if scale else np.nan,
            "p10_p90_coverage": float(((a >= g.p10) & (a <= g.p90)).mean()) if interval else np.nan,
            "p10_p90_mean_width": float((g.p90 - g.p10).mean()) if interval else np.nan,
            "normalized_interval_width": float((g.p90 - g.p10).mean()) / scale if interval and scale else np.nan}


def score_forecasts(paths, scales, per_horizon=True):
    keys = ["split", "model", "sensor", "units"] + (["horizon_minutes"] if per_horizon else [])
    records = []
    for key, group in paths.groupby(keys, sort=False):
        row = dict(zip(keys, key))
        row.update(score_group(group, scales[row["sensor"]]))
        records.append(row)
    return pd.DataFrame(records)


def aggregate_metrics(metrics):
    records = []
    for (split, model, h), g in metrics.groupby(["split", "model", "horizon_minutes"], sort=False):
        valid = g[g.normalized_mae.notna()]
        nm, bm = valid.normalized_mae.mean(), valid.normalized_persistence_mae.mean()
        nr, br = valid.normalized_rmse.mean(), valid.normalized_persistence_rmse.mean()
        records.append({"split": split, "model": model, "horizon_minutes": h,
            "n_sensors_total": len(g), "n_sensors_with_nonzero_train_scale": len(valid),
            "macro_normalized_mae": nm, "macro_normalized_rmse": nr,
            "persistence_macro_normalized_mae": bm, "persistence_macro_normalized_rmse": br,
            "mae_skill_vs_persistence": 1 - nm / bm if bm > 0 else np.nan,
            "rmse_skill_vs_persistence": 1 - nr / br if br > 0 else np.nan,
            "macro_coverage": g.p10_p90_coverage.mean(),
            "macro_normalized_interval_width": g.normalized_interval_width.mean()})
    return pd.DataFrame(records)


def event_metrics(paths, scales, thresholds):
    """Post-hoc labels on SAME shared origins; strict > prevents zero-change events."""
    records = []
    for (split, model, sensor, h), g in paths.groupby(["split", "model", "sensor", "horizon_minutes"], sort=False):
        threshold = thresholds[sensor][str(h)]
        event = g[(g.actual - g.persistence).abs() > max(threshold, 1e-8)]
        row = {"split": split, "model": model, "sensor": sensor, "units": UNITS[sensor],
               "horizon_minutes": h, "train_abs_change_q98": threshold,
               "n_eligible_origins": len(g), "n_event_origins": len(event),
               "event_rate": len(event) / len(g), "selection": "post_hoc_shared_origins"}
        if len(event):
            row.update(score_group(event, scales[sensor]))
        else:
            row.update({c: np.nan for c in score_group(g, scales[sensor])})
            row.update(n_predictions=0, n_origins=0)
        records.append(row)
    return pd.DataFrame(records)


def binary_metrics(paths):
    rows = []
    for (split, model, h), g in paths[paths.sensor == "FS-501A"].groupby(
            ["split", "model", "horizon_minutes"], sort=False):
        actual, pred = g.actual.to_numpy() >= 0.5, g.predicted.to_numpy() >= 0.5
        tp, tn = int((actual & pred).sum()), int((~actual & ~pred).sum())
        fp, fn = int((~actual & pred).sum()), int((actual & ~pred).sum())
        rows.append({"split": split, "model": model, "sensor": "FS-501A", "horizon_minutes": h,
            "n_predictions": len(g), "p50_decision_threshold": 0.5, "tp": tp, "tn": tn, "fp": fp, "fn": fn,
            "accuracy": (tp + tn) / len(g), "precision": tp / (tp + fp) if tp + fp else np.nan,
            "recall": tp / (tp + fn) if tp + fn else np.nan,
            "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else np.nan,
            "raw_p50_outside_0_1": int(((g.predicted < 0) | (g.predicted > 1)).sum())})
    return pd.DataFrame(rows)


def sensor_behavior(df, origins, paths, behavior):
    rows = []
    for (split, model, sensor), g in paths.groupby(["split", "model", "sensor"], sort=False):
        osub = origins[origins.split == split]
        constants = [np.ptp(df[sensor].iloc[t - 59:t + 1].to_numpy()) == 0
                     for t in osub.origin_global_index]
        rows.append({"split": split, "model": model, "sensor": sensor, **behavior[sensor],
            "n_origins": len(osub), "n_constant_contexts": int(sum(constants)),
            "constant_context_fraction": float(np.mean(constants)),
            "unchanged_target_fraction": float((g.actual == g.persistence).mean()),
            "predicted_physical_range_violations": physical_violations(g.predicted.to_numpy(), sensor, True)})
    return pd.DataFrame(rows)


def plot_results(paths, metrics, aggregate, output, prefix):
    folder = output / "plots"
    folder.mkdir(exist_ok=True)
    origin = paths.origin_id.unique()[len(paths.origin_id.unique()) // 2]
    sample = paths[paths.origin_id == origin]
    fig, axes = plt.subplots(4, 3, figsize=(17, 14), constrained_layout=True)
    for ax, sensor in zip(axes.flat, COLS):
        g = sample[sample.sensor == sensor].sort_values("horizon_minutes")
        x = g.horizon_minutes.to_numpy()
        ax.plot(x, g.actual, label="Actual", marker=".", lw=1.4)
        ax.plot(x, g.predicted, label=prefix, lw=1.3)
        ax.plot(x, g.persistence, "--", label="Persistence", alpha=0.65)
        if g.p10.notna().all():
            ax.fill_between(x, g.p10.to_numpy(), g.p90.to_numpy(), alpha=0.2, label="p10-p90")
        ax.set_title(sensor)
        ax.set_ylabel(UNITS[sensor], fontsize=8)
        ax.set_xlabel("Minutes ahead")
        ax.grid(alpha=0.2)
    axes.flat[-1].axis("off")
    axes.flat[0].legend(fontsize=7)
    fig.suptitle(f"{prefix}: all 11 sensors; shared origin {origin} / {sample.origin_timestamp.iloc[0]}")
    fig.savefig(folder / f"{prefix}_all_sensors.png", dpi=130)
    plt.close(fig)
    fig, axes = plt.subplots(4, 3, figsize=(17, 13), constrained_layout=True)
    for ax, sensor in zip(axes.flat, COLS):
        g = metrics[metrics.sensor == sensor].sort_values("horizon_minutes")
        ax.plot(g.horizon_minutes, g.mae, label=prefix, marker=".")
        ax.plot(g.horizon_minutes, g.persistence_mae, "--", label="Persistence")
        ax.set_title(sensor)
        ax.set_ylabel(f"MAE: {UNITS[sensor]}", fontsize=8)
        ax.set_xlabel("Exact forecast horizon (minutes)")
        ax.grid(alpha=0.2)
    axes.flat[-1].axis("off")
    axes.flat[0].legend(fontsize=8)
    fig.savefig(folder / f"{prefix}_per_horizon.png", dpi=130)
    plt.close(fig)
    fig, ax = plt.subplots(figsize=(9, 5), constrained_layout=True)
    ax.plot(aggregate.horizon_minutes, aggregate.macro_normalized_mae, marker="o", label=prefix)
    ax.plot(aggregate.horizon_minutes, aggregate.persistence_macro_normalized_mae, "--", label="Persistence")
    ax.set(xlabel="Exact horizon (minutes)", ylabel="Mean sensor MAE / training sensor std",
           title=f"{prefix}: dimensionless equal-sensor comparison")
    ax.legend()
    ax.grid(alpha=0.2)
    fig.savefig(folder / f"{prefix}_normalized_comparison.png", dpi=140)
    plt.close(fig)


def save_evaluation(df, origins, forecasts, scales, thresholds, behavior, output, prefix, model):
    paths = build_prediction_rows(df, origins, forecasts, model)
    metrics = score_forecasts(paths, scales)
    aggregates = aggregate_metrics(metrics)
    paths.to_csv(output / f"{prefix}_forecast_paths.csv", index=False)
    metrics.to_csv(output / f"{prefix}_metrics.csv", index=False)
    score_forecasts(paths, scales, False).to_csv(output / f"{prefix}_sensor_summary.csv", index=False)
    aggregates.to_csv(output / f"{prefix}_aggregate_metrics.csv", index=False)
    events = event_metrics(paths, scales, thresholds)
    binary_metrics(paths).to_csv(output / f"{prefix}_binary_fan_metrics.csv", index=False)
    sensor_behavior(df, origins, paths, behavior).to_csv(output / f"{prefix}_sensor_behavior.csv", index=False)
    plot_results(paths, metrics, aggregates, output, prefix)
    if len(paths) != len(origins) * 11 * 15 or paths.duplicated(["origin_id", "sensor", "horizon_minutes"]).any():
        raise AssertionError("Output row count or uniqueness failure")
    return events, aggregates


def load_chronos_pipeline(output, threads, seed):
    import torch
    from chronos import Chronos2Pipeline
    from huggingface_hub import try_to_load_from_cache
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    if torch.version.cuda is not None:
        raise RuntimeError("Install CPU-only PyTorch; this experiment requires a CPU build")
    local = try_to_load_from_cache(MODEL_ID, "model.safetensors", revision=MODEL_REVISION)
    workspace_cache = ROOT / ".cache" / "huggingface"
    if not isinstance(local, str):
        local = try_to_load_from_cache(MODEL_ID, "model.safetensors", revision=MODEL_REVISION,
                                       cache_dir=str(workspace_cache))
    if isinstance(local, str):
        source = str(Path(local).parent)
        options = {"local_files_only": True}
        cache_source = "existing Hugging Face cache; no weight download"
    else:
        if shutil.disk_usage(output).free < 2 * 1024**3:
            raise RuntimeError("Less than 2 GiB free before model download")
        source = MODEL_ID
        options = {"revision": MODEL_REVISION, "cache_dir": str(workspace_cache)}
        cache_source = "workspace cache (download if needed)"
    print(f"Loading {MODEL_ID}@{MODEL_REVISION} on CPU: {cache_source}", flush=True)
    pipeline = Chronos2Pipeline.from_pretrained(source, device_map="cpu", dtype=torch.float32, **options)
    pipeline.model.eval()
    pipeline.model.requires_grad_(False)
    if any(p.requires_grad or p.device.type != "cpu" for p in pipeline.model.parameters()):
        raise AssertionError("Model must be frozen entirely on CPU")
    model_file = Path(source) / "model.safetensors"
    if not model_file.exists():
        cached = try_to_load_from_cache(MODEL_ID, "model.safetensors", revision=MODEL_REVISION,
                                        cache_dir=str(workspace_cache))
        model_file = Path(cached) if isinstance(cached, str) else model_file
    details = {"model_id": MODEL_ID, "model_revision": MODEL_REVISION, "cache_source": cache_source,
               "weights_sha256": data_sha256(model_file) if model_file.exists() else None,
               "n_parameters": sum(p.numel() for p in pipeline.model.parameters()),
               "all_parameters_frozen": True, "model_config": pipeline.model.config.to_dict(),
               "dtype": str(next(pipeline.model.parameters()).dtype)}
    return pipeline, details


def shared_config(settings, audit, scales, thresholds, behavior, origins):
    return {"schema_version": 1, "sensors_in_exact_order": list(COLS), "sensor_units": UNITS,
        "dataset_hashes": {k: v["sha256"] for k, v in audit["partitions"].items()},
        "partition_indices": audit["split_global_indices_end_exclusive"],
        "context_timesteps": 60, "prediction_length": 15, "frequency_seconds": 60,
        "primary_horizons_minutes": list(HORIZONS), "reported_horizons_minutes": list(range(1, 16)),
        "seed": settings.seed, "quantiles": list(QUANTILES), "point_prediction": "p50",
        "cross_learning": False, "excluded_features": list(EXCLUDED),
        "origin_counts": {k: int((origins.split == k).sum()) for k in ("validation", "test")},
        "origin_selection": "unique integer linspace from partition_start-1 to partition_end-1-15",
        "origin_definition": "Last observed row t; context t-59..t inclusive; targets t+1..t+15",
        "boundary_context": "Earlier observed rows from preceding partition allowed; future targets excluded",
        "normalization_scales_train_std_ddof0": scales,
        "constant_sensor_rule": "std <= 1e-8: normalized scores null; excluded from normalized macro only",
        "training_sensor_behavior": behavior, "event_thresholds_train_abs_change_q98": thresholds,
        "event_rule": "abs(actual_h-last_observed) > max(train_q98_h,1e-8); post-hoc shared origins only",
        "aggregate_rule": "Equal sensor mean of MAE/std or RMSE/std at each exact horizon; no raw-unit averaging",
        "fan_rule": "Continuous p50 regression plus binary interpretation p50 >= 0.5; p50 is not a probability",
        "tft_contract": "Fit train only; tune validation only. Reuse hashes, order, origins, context, targets and scales. "
            "No future observed sensors or metadata. Use p50 if a quantile model; otherwise disclose point rule.",
        "evaluation_scope": "Deterministic sampled rolling origins, not exhaustive; overlapping windows not independent",
        "smoke_test_only": settings.smoke_test}


def protect_output(output):
    resolved = Path(output).resolve()
    protected = [ROOT / "outputs", ROOT / "data", ROOT / "backups", ROOT / "asset-intelligence-digital-twin"]
    if resolved == ROOT or any(resolved == p.resolve() or p.resolve() in resolved.parents for p in protected):
        raise ValueError("Choose a separate output directory; source/legacy directories are protected")
    children = list(resolved.iterdir()) if resolved.exists() else []
    if resolved == (ROOT / "outputs_level5").resolve():
        children = [p for p in children if not (p.is_dir() and p.name in ("audit", "baseline", "smoke"))]
    if children:
        raise FileExistsError(f"Output contains files: {resolved}. Use a fresh --output directory.")
    resolved.mkdir(parents=True, exist_ok=True)


def run(settings):
    if settings.device != "cpu" or min(settings.batch_size, settings.validation_origins,
            settings.test_origins, settings.threads) < 1:
        raise ValueError("CPU only, with positive batch size, origin counts and thread count")
    output = Path(settings.output)
    protect_output(output)
    monitor = ResourceMonitor()
    stages = {}
    meta = {"status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
        "settings": asdict(settings), "model_loaded": False, "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION, "device": "cpu", "zero_shot": True,
        "future_sensor_values_provided_to_model": False, "metadata_provided_to_model": False,
        "weights_trained_or_finetuned": False, "python": sys.version, "platform": platform.platform(),
        "source_code_sha256": {p: data_sha256(ROOT / p) for p in ("main.py", "legacy_hru507.py", "requirements.txt")},
        "logical_cpu_count": psutil.cpu_count(), "total_ram_bytes": psutil.virtual_memory().total,
        "initial_available_ram_bytes": psutil.virtual_memory().available,
        "initial_free_disk_bytes": shutil.disk_usage(output).free,
        "packages": {p: importlib.metadata.version(p) for p in
            ("chronos-forecasting", "torch", "numpy", "pandas", "matplotlib", "psutil",
             "transformers", "huggingface-hub", "safetensors", "pytest")},
        "methodology": "Fixed 60-minute context; no tuning or new split; sampled rolling evaluation. "
            "Normal-condition forecasting cannot establish anomaly-detection accuracy."}
    write_json(output / "chronos2_experiment_metadata.json", meta)
    try:
        random.seed(settings.seed)
        np.random.seed(settings.seed)
        start = time.perf_counter()
        df, splits, audit = audit_datasets(settings.data_dir)
        write_json(output / "dataset_audit.json", audit)
        if audit["issues"]:
            raise ValueError("Dataset audit failed: " + "; ".join(audit["issues"]))
        scales, thresholds, behavior = training_statistics(df, splits["train"][1])
        origins = make_origins(df, splits, {"validation": 1 if settings.smoke_test else settings.validation_origins,
                                           "test": 1 if settings.smoke_test else settings.test_origins})
        config = shared_config(settings, audit, scales, thresholds, behavior, origins)
        origins.to_csv(output / "evaluation_origins.csv", index=False)
        write_json(output / "shared_experiment_config.json", config)
        write_json(output / "sensor_schema.json", {"schema_version": 1, "sensors": [
            {"index": j, "name": s, "units": UNITS[s],
             "unit_evidence": "Binary values verified" if s == "FS-501A" else
                "No unit dictionary supplied; inferred labels are assumptions; unverified units kept native",
             "asset": "Level5 environmental" if s.startswith("S-L5") else "HRU" + s.split("-")[1],
             "input_dtype": "float32", "role": "joint_forecasting_target"} for j, s in enumerate(COLS)],
            "excluded_columns": audit["partitions"]["train"]["excluded_metadata"],
            "provenance": audit["provenance"]})
        stages["audit_and_configuration_seconds"] = time.perf_counter() - start
        meta["dataset_hashes"] = config["dataset_hashes"]
        meta["selected_origin_counts"] = config["origin_counts"]
        meta["evaluation_origins_sha256"] = data_sha256(output / "evaluation_origins.csv")
        meta["shared_configuration_sha256"] = data_sha256(output / "shared_experiment_config.json")
        print(f"Audit passed: {len(df):,} rows, 11 channels, supplied partitions {splits}", flush=True)
        if settings.audit_only:
            meta["status"] = "audit_completed"
            return meta
        start = time.perf_counter()
        baseline_events = []
        for split in ("validation", "test"):
            events, _ = save_evaluation(df, origins[origins.split == split], None, scales, thresholds, behavior,
                                        output, f"baseline_{split}", "persistence_baseline")
            baseline_events.append(events)
        pd.concat(baseline_events).to_csv(output / "baseline_event_metrics.csv", index=False)
        stages["baseline_and_plots_seconds"] = time.perf_counter() - start
        if settings.baseline_only:
            meta["status"] = "baseline_completed"
            return meta
        arr = df.loc[:, COLS].to_numpy(dtype=np.float64)
        start = time.perf_counter()
        pipeline, details = load_chronos_pipeline(output, settings.threads, settings.seed)
        stages["model_load_seconds"] = time.perf_counter() - start
        meta.update(details, model_loaded=True)
        write_json(output / "chronos2_experiment_metadata.json", meta)
        import torch
        events_all = []
        with torch.inference_mode():
            for split in ("validation", "test"):
                osub = origins[origins.split == split]
                print(f"{split}: {len(osub)} origins, [batch,11,60] -> [batch,11,15,3]", flush=True)
                start = time.perf_counter()
                predictions = forecast_windows(pipeline, arr, osub.origin_global_index.to_numpy(),
                                               batch_size=settings.batch_size)
                stages[f"{split}_inference_seconds"] = time.perf_counter() - start
                start = time.perf_counter()
                events, aggregate = save_evaluation(df, osub, predictions, scales, thresholds, behavior,
                                                    output, f"chronos2_{split}", "chronos2_zero_shot")
                events_all.append(events)
                stages[f"{split}_scoring_export_plots_seconds"] = time.perf_counter() - start
                print(aggregate[aggregate.horizon_minutes.isin(HORIZONS)].to_string(index=False), flush=True)
        pd.concat(events_all).to_csv(output / "chronos2_event_metrics.csv", index=False)
        meta["status"] = "smoke_completed" if settings.smoke_test else "completed"
        meta["selected_origins_file"] = "evaluation_origins.csv"
        meta["forecast_shapes_per_origin"] = {"input": [11, 60], "quantiles": [11, 15, 3], "point": [11, 15]}
        return meta
    except Exception as exc:
        meta.update(status="failed", error_type=type(exc).__name__, error=str(exc), traceback=traceback.format_exc())
        raise
    finally:
        meta["stages"] = stages
        meta["resources"] = monitor.finish()
        meta["finished_utc"] = datetime.now(timezone.utc).isoformat()
        meta["final_free_disk_bytes"] = shutil.disk_usage(output).free
        artifacts = list(output.glob("*")) + list((output / "plots").glob("*"))
        meta["output_file_sha256"] = {str(p.relative_to(output)): data_sha256(p) for p in artifacts
            if p.is_file() and p.name != "chronos2_experiment_metadata.json"}
        write_json(output / "chronos2_experiment_metadata.json", meta)
        print(f"{meta['status']}: {output.resolve()} ({meta['resources']['wall_seconds']:.2f}s)", flush=True)


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--audit-only", action="store_true", help="Audit files and export shared contract; no inference")
    mode.add_argument("--baseline-only", action="store_true", help="Real-data persistence; no model loading")
    mode.add_argument("--smoke-test", action="store_true", help="REAL pretrained CPU inference: 1 validation + 1 test origin; 11 sensors")
    parser.add_argument("--device", choices=["cpu"], default="cpu")
    parser.add_argument("--batch-size", type=int, default=1, help="Complete 11-sensor tasks per inference batch (default 1)")
    parser.add_argument("--validation-origins", type=int, default=32)
    parser.add_argument("--test-origins", type=int, default=64)
    parser.add_argument("--output", help="Fresh output directory; default outputs_level5 (or audit/baseline/smoke child)")
    parser.add_argument("--data-dir", default=str(ROOT / "data"))
    parser.add_argument("--threads", type=int, default=4, help="PyTorch intra-op CPU threads; inter-op=1")
    args = parser.parse_args()
    if min(args.batch_size, args.validation_origins, args.test_origins, args.threads) < 1:
        parser.error("Batch size, origin counts and thread count must be positive")
    output = args.output or str(ROOT / "outputs_level5" / ("smoke" if args.smoke_test else
                   "audit" if args.audit_only else "baseline" if args.baseline_only else ""))
    run(Settings(**{**vars(args), "output": output}))


if __name__ == "__main__":
    cli()

