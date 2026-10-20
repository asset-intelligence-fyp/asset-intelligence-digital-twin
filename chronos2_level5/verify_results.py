"""Independently verify saved Level 5 research artifacts, data identity and legacy preservation."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from PIL import Image
from main import ROOT, COLS, PARTITIONS, data_sha256


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def close(actual, expected, message):
    check(np.allclose(actual, expected, rtol=1e-8, atol=1e-8, equal_nan=True), message)


def verify(output):
    output = Path(output).resolve()
    meta = json.loads((output / "chronos2_experiment_metadata.json").read_text())
    config = json.loads((output / "shared_experiment_config.json").read_text())
    audit = json.loads((output / "dataset_audit.json").read_text())
    check(meta["status"] in ("completed", "smoke_completed"), "No completed real-model run")
    check(meta["model_loaded"] and meta["all_parameters_frozen"], "Model did not load frozen weights")
    check(meta["device"] == "cpu" and "+cpu" in meta["packages"]["torch"], "Not CPU-only")
    check(not meta["weights_trained_or_finetuned"], "Weights were trained")
    check(not meta["future_sensor_values_provided_to_model"], "Future sensor values provided")
    check(config["sensors_in_exact_order"] == list(COLS), "Sensor ordering mismatch")
    check(config["context_timesteps"] == 60 and config["prediction_length"] == 15, "Task reduced")
    check(not audit["issues"], "Unresolved dataset audit issues")
    for filename, expected in meta["output_file_sha256"].items():
        check(data_sha256(output / filename) == expected, f"Output checksum mismatch: {filename}")
    for filename, expected in meta.get("source_code_sha256", {}).items():
        check(data_sha256(ROOT / filename) == expected, f"Source changed since run: {filename}")
    frames = []
    for split, filename in PARTITIONS.items():
        path = Path(meta["settings"]["data_dir"]) / filename
        check(data_sha256(path) == config["dataset_hashes"][split], f"Dataset changed: {split}")
        frames.append(pd.read_csv(path, usecols=["timestamp", *COLS]))
    data = pd.concat(frames, ignore_index=True)
    data["timestamp"] = pd.to_datetime(data.timestamp)
    origins = pd.read_csv(output / "evaluation_origins.csv")
    check(not origins.origin_id.duplicated().any(), "Duplicate shared origin ID")
    scales = config["normalization_scales_train_std_ddof0"]
    train_end = config["partition_indices"]["train"][1]
    for sensor in COLS:
        scale = float(data[sensor].iloc[:train_end].std(ddof=0))
        close(scale if scale > 1e-8 else np.nan, scales[sensor] or np.nan, "Training-only scale mismatch")
    report = {"status": "passed", "run_status": meta["status"], "splits": {}, "plots": {}, "legacy_preservation": {}}
    saved_paths = {}
    for split in ("validation", "test"):
        selected = origins[origins.split == split]
        count = config["origin_counts"][split]
        check(len(selected) == count, "Origin count mismatch")
        a, b = config["partition_indices"][split]
        expected_indices = np.unique(np.linspace(max(59, a - 1), b - 16,
                                       num=min(count, b - 16 - max(59, a - 1) + 1), dtype=np.int64))
        check(np.array_equal(selected.origin_global_index, expected_indices), "Non-deterministic origins")
        check((selected.target_start_global_index >= a).all(), "Target precedes evaluation partition")
        check((selected.target_end_global_index < b).all(), "Target exceeds evaluation partition")
        check((selected.context_end_global_index < selected.target_start_global_index).all(), "Context leaks")
        p = pd.read_csv(output / f"chronos2_{split}_forecast_paths.csv",
                        parse_dates=["origin_timestamp", "target_timestamp"])
        saved_paths[split] = p
        baseline = pd.read_csv(output / f"baseline_{split}_forecast_paths.csv")
        metrics = pd.read_csv(output / f"chronos2_{split}_metrics.csv")
        aggregate = pd.read_csv(output / f"chronos2_{split}_aggregate_metrics.csv")
        check(len(p) == count * 11 * 15, "Forecast shape mismatch")
        check(set(p.sensor) == set(COLS), "Missing forecasting sensor")
        check(set(p.origin_id) == set(selected.origin_id), "Model origins differ from shared origins")
        check(not p.duplicated(["origin_id", "sensor", "horizon_minutes"]).any(), "Duplicate predictions")
        check(np.isfinite(p[["actual", "predicted", "p10", "p50", "p90"]]).all().all(), "Nonfinite forecasts")
        close(p.predicted, p.p50, "p50 mismatch")
        check((p.p10 <= p.p50 + 1e-6).all() and (p.p50 <= p.p90 + 1e-6).all(), "Quantiles crossed")
        check(((p.target_timestamp - p.origin_timestamp).dt.total_seconds() == p.horizon_minutes * 60).all(),
              "Incorrect target timestamps")
        for sensor_index, sensor in enumerate(COLS):
            g = p[p.sensor == sensor]
            check(g.sensor_index.eq(sensor_index).all(), "Sensor index mismatch")
            target = g.origin_global_index + g.horizon_minutes
            close(g.actual, data[sensor].iloc[target].to_numpy(), "Labels differ from real CSV")
            close(g.persistence, data[sensor].iloc[g.origin_global_index].to_numpy(), "Persistence mismatch")
        check(len(baseline) == len(p), "Baseline/model shapes differ")
        close(baseline.actual, p.actual, "Baseline/model labels differ")
        close(baseline.predicted, p.persistence, "Incorrect baseline forecasts")
        check(baseline[["p10", "p50", "p90"]].isna().all().all(), "Baseline has fabricated intervals")
        check(len(metrics) == 11 * 15, "Per-horizon metric shape mismatch")
        for row in metrics.itertuples(index=False):
            g = p[(p.sensor == row.sensor) & (p.horizon_minutes == row.horizon_minutes)]
            error = g.predicted.to_numpy() - g.actual.to_numpy()
            base_error = g.persistence.to_numpy() - g.actual.to_numpy()
            mae = np.abs(error).mean()
            rmse = np.sqrt(np.mean(error**2))
            bm = np.abs(base_error).mean()
            close(row.mae, mae, "MAE mismatch")
            close(row.rmse, rmse, "RMSE mismatch")
            close(row.persistence_mae, bm, "Persistence MAE mismatch")
            close(row.mae_skill_vs_persistence, 1 - mae / bm if bm > 0 else np.nan, "Skill mismatch")
            close(row.p10_p90_coverage, ((g.actual >= g.p10) & (g.actual <= g.p90)).mean(), "Coverage mismatch")
            close(row.p10_p90_mean_width, (g.p90 - g.p10).mean(), "Interval width mismatch")
        for row in aggregate.itertuples(index=False):
            g = metrics[metrics.horizon_minutes == row.horizon_minutes]
            close(row.macro_normalized_mae, g.normalized_mae.mean(), "Normalized macro MAE mismatch")
            close(row.macro_normalized_rmse, g.normalized_rmse.mean(), "Normalized macro RMSE mismatch")
        binary = pd.read_csv(output / f"chronos2_{split}_binary_fan_metrics.csv")
        check(len(binary) == 15, "Missing fan horizons")
        for r in binary.itertuples(index=False):
            g = p[(p.sensor == "FS-501A") & (p.horizon_minutes == r.horizon_minutes)]
            close(r.accuracy, ((g.actual >= .5) == (g.predicted >= .5)).mean(), "Fan accuracy mismatch")
        report["splits"][split] = {"origins": count, "forecast_rows": len(p), "metric_rows": len(metrics),
                                     "all_11_sensors_verified": True}
    events = pd.read_csv(output / "chronos2_event_metrics.csv")
    check(len(events) == 2 * 11 * 15, "Missing event diagnostic rows")
    for r in events.itertuples(index=False):
        p = saved_paths[r.split]
        g = p[(p.sensor == r.sensor) & (p.horizon_minutes == r.horizon_minutes)]
        threshold = config["event_thresholds_train_abs_change_q98"][r.sensor][str(r.horizon_minutes)]
        eligible = (g.actual - g.persistence).abs() > max(threshold, 1e-8)
        check(r.n_event_origins == int(eligible.sum()), "Event diagnostic mismatch")
        if not eligible.any():
            check(pd.isna(r.mae), "Empty event score must be unavailable")
    for path in (output / "plots").glob("*.png"):
        with Image.open(path) as image:
            check(image.width >= 1000 and image.height >= 600, f"Undersized plot: {path.name}")
            check(np.asarray(image.convert("RGB")).std() > 5, f"Blank plot: {path.name}")
            report["plots"][path.name] = list(image.size)
    check(len(report["plots"]) == 12, "Expected 12 charts, each sensor panel contains all 11 targets")
    manifest = ROOT / "backups" / "pre_level5_20261021" / "preservation_manifest.json"
    if manifest.exists():
        expected = json.loads(manifest.read_text())
        for filename, digest in expected.items():
            check(data_sha256(ROOT / filename) == digest, f"Protected original changed: {filename}")
        report["legacy_preservation"] = {"checked_files": len(expected), "all_hashes_unchanged": True}
    else:
        report["legacy_preservation"] = {"status": "manifest unavailable in this copy"}
    report["model_revision"] = meta["model_revision"]
    report["weights_sha256"] = meta["weights_sha256"]
    (output / "verification_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "outputs_level5"))
    print(json.dumps(verify(parser.parse_args().output), indent=2))

