"""Offline tests verify logic; they do NOT claim pretrained model performance."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main as m


def frame(n=300):
    t = np.arange(n)
    data = {"timestamp": pd.date_range("2024-01-01", periods=n, freq="min")}
    for j, sensor in enumerate(m.COLS):
        data[sensor] = (t // 20) % 2 if sensor == "FS-501A" else 25 + j + np.sin(t / 30)
    return pd.DataFrame(data)


def origins(df):
    return m.make_origins(df, {"train": (0, 180), "validation": (180, 240), "test": (240, 300)},
                          {"validation": 3, "test": 4})


class Spy:
    def __init__(self, bad=None):
        self.inputs = []
        self.bad = bad

    def predict_quantiles(self, inputs, **kwargs):
        assert inputs.shape[1:] == (11, 60)
        assert kwargs["cross_learning"] is False
        assert kwargs["context_length"] == 60
        assert kwargs["quantile_levels"] == [0.1, 0.5, 0.9]
        assert kwargs["batch_size"] >= len(inputs) * 11
        self.inputs.append(inputs.copy())
        p = np.repeat(inputs[:, :, -1:], 15, axis=2)
        q = np.stack([p - 1, p, p + 1], axis=-1)
        if self.bad == "nonfinite":
            q[0, 0, 0, 0] = np.nan
        if self.bad == "crossing":
            q[..., 0] = p + 2
        if self.bad == "median":
            p = p + 1
        if self.bad == "shape":
            q = q[:, :-1]
        return list(q), list(p)


def test_shared_origins_and_partition_boundary_history():
    df = frame()
    o = origins(df)
    for split, a, b, count in [("validation", 180, 240, 3), ("test", 240, 300, 4)]:
        g = o[o.split == split]
        assert len(g) == count
        assert g.iloc[0].origin_global_index == a - 1
        assert (g.target_start_global_index >= a).all()
        assert (g.target_end_global_index < b).all()
        assert (g.context_end_global_index < g.target_start_global_index).all()
        assert g.origin_global_index.is_monotonic_increasing
    pd.testing.assert_frame_equal(o, origins(df))


def test_all_sensor_order_and_future_mutation_isolation():
    arr = np.arange(300 * 11, dtype=float).reshape(300, 11)
    first, second = Spy(), Spy()
    a = m.forecast_windows(first, arr, np.array([100]), batch_size=1)
    changed = arr.copy()
    changed[101:] = -999999
    b = m.forecast_windows(second, changed, np.array([100]), batch_size=1)
    np.testing.assert_array_equal(first.inputs[0], arr[41:101].T[None].astype("float32"))
    np.testing.assert_array_equal(first.inputs[0], second.inputs[0])
    np.testing.assert_array_equal(a[100][0], b[100][0])
    np.testing.assert_array_equal(a[100][0][:, 0], arr[100])
    assert a[100][1].shape == (11, 15, 3)


def test_batching_preserves_tasks_and_predictions():
    arr = frame()[list(m.COLS)].to_numpy()
    o = np.array([100, 150, 200])
    one = m.forecast_windows(Spy(), arr, o, batch_size=1)
    two = m.forecast_windows(Spy(), arr, o, batch_size=2)
    for t in o:
        np.testing.assert_array_equal(one[t][1], two[t][1])


def test_official_chronos_dataset_preserves_11_channel_groups():
    """Exercise installed official input adapter, without model weights or forecasts."""
    from chronos.chronos2.dataset import Chronos2Dataset, DatasetMode
    inputs = np.arange(2 * 11 * 60, dtype=np.float32).reshape(2, 11, 60)
    batches = list(Chronos2Dataset(inputs, context_length=60, prediction_length=15,
                                  batch_size=22, output_patch_size=16, mode=DatasetMode.TEST))
    assert len(batches) == 1
    batch = batches[0]
    assert batch["context"].shape == (22, 60)
    np.testing.assert_array_equal(batch["context"].numpy(), inputs.reshape(22, 60))
    np.testing.assert_array_equal(batch["group_ids"].numpy(), np.repeat([0, 1], 11))
    assert batch["target_idx_ranges"] == [(0, 11), (11, 22)]
    assert batch["future_target"] is None
    assert batch["future_covariates"].isnan().all()


@pytest.mark.parametrize("bad,exc", [("nonfinite", ValueError), ("crossing", ValueError),
                                     ("median", ValueError), ("shape", RuntimeError)])
def test_output_validation(bad, exc):
    with pytest.raises(exc):
        m.forecast_windows(Spy(bad), frame()[list(m.COLS)].to_numpy(), np.array([100]))


@pytest.mark.parametrize("o", [np.array([58]), np.array([300]), np.array([100.5])])
def test_bad_origins_rejected(o):
    with pytest.raises(ValueError):
        m.forecast_windows(Spy(), np.zeros((300, 11)), o)


def test_training_scales_and_thresholds_ignore_future():
    df = frame()
    a = m.training_statistics(df, 180)
    df.loc[180:, list(m.COLS)] += 10000
    assert a == m.training_statistics(df, 180)
    np.testing.assert_allclose(a[0]["SAT-501A"], df["SAT-501A"].iloc[:180].std(ddof=0))


def test_constant_sensor_does_not_create_false_events_or_division():
    df = frame()
    df["AF-501A"] = 0.
    scales, thresholds, behavior = m.training_statistics(df, 180)
    assert scales["AF-501A"] is None
    assert behavior["AF-501A"]["constant_train"]
    paths = m.build_prediction_rows(df, origins(df), None, "persistence_baseline")
    scores = m.score_forecasts(paths, scales)
    sub = scores[scores.sensor == "AF-501A"]
    assert sub.mae.eq(0).all() and sub.normalized_mae.isna().all()
    assert sub.mae_skill_vs_persistence.isna().all()
    e = m.event_metrics(paths, scales, thresholds)
    assert e[e.sensor == "AF-501A"].n_event_origins.eq(0).all()
    assert m.aggregate_metrics(scores).n_sensors_with_nonzero_train_scale.eq(10).all()


def test_forecast_rows_metrics_and_no_baseline_fake_intervals():
    df = frame()
    scales, _, _ = m.training_statistics(df, 180)
    o = origins(df)
    paths = m.build_prediction_rows(df, o, None, "persistence_baseline")
    assert len(paths) == 7 * 11 * 15
    assert not paths.duplicated(["origin_id", "sensor", "horizon_minutes"]).any()
    assert paths[["p10", "p50", "p90"]].isna().all().all()
    assert paths.predicted.eq(paths.persistence).all()
    assert (paths.target_timestamp > paths.origin_timestamp).all()
    metrics = m.score_forecasts(paths, scales)
    assert len(metrics) == 2 * 11 * 15
    np.testing.assert_array_equal(metrics.mae, metrics.persistence_mae)
    np.testing.assert_array_equal(metrics.rmse, metrics.persistence_rmse)
    r = paths[(paths.sensor == m.COLS[0]) & (paths.split == "test") & (paths.horizon_minutes == 5)]
    calculated = metrics[(metrics.sensor == m.COLS[0]) & (metrics.split == "test") & (metrics.horizon_minutes == 5)].iloc[0]
    assert calculated.mae == pytest.approx(np.abs(r.actual - r.predicted).mean())
    assert calculated.rmse == pytest.approx(np.sqrt(np.square(r.actual - r.predicted).mean()))


def test_intervals_and_binary_interpretation():
    df = frame()
    o = origins(df)
    arr = df[list(m.COLS)].to_numpy()
    forecasts = m.forecast_windows(Spy(), arr, o.origin_global_index.to_numpy())
    paths = m.build_prediction_rows(df, o, forecasts, "chronos2_zero_shot")
    assert paths.predicted.eq(paths.p50).all()
    scores = m.score_forecasts(paths, m.training_statistics(df, 180)[0])
    np.testing.assert_allclose(scores.p10_p90_mean_width, 2, atol=4e-6)
    assert scores.p10_p90_coverage.between(0, 1).all()
    binary = m.binary_metrics(paths)
    assert len(binary) == 30
    assert (binary.tp + binary.tn + binary.fp + binary.fn).eq(binary.n_predictions).all()


def write_partitions(folder, defect=None):
    df = frame()
    df["occupancy_507"] = 99999
    df["scenario"] = "normal"
    df["source_mode"] = "unverified"
    df["is_anomaly"] = 0
    if defect == "missing":
        df.loc[10, "AF-507"] = np.nan
    if defect == "binary":
        df.loc[10, "FS-501A"] = 3
    if defect == "gap":
        df.loc[180:, "timestamp"] += pd.Timedelta(minutes=1)
    if defect == "duplicate":
        df.loc[11, "timestamp"] = df.loc[10, "timestamp"]
    if defect == "reverse":
        df.iloc[:180] = df.iloc[:180].iloc[::-1].to_numpy()
    for split, a, b in [("train", 0, 180), ("validation", 180, 240), ("test", 240, 300)]:
        df.iloc[a:b].to_csv(folder / m.PARTITIONS[split], index=False)


def test_actual_csv_audit_excludes_metadata_without_resplitting(tmp_path):
    write_partitions(tmp_path)
    df, splits, audit = m.audit_datasets(tmp_path)
    assert not audit["issues"]
    assert list(df.columns) == ["timestamp", *m.COLS]
    assert splits == {"train": (0, 180), "validation": (180, 240), "test": (240, 300)}
    assert audit["partitions"]["train"]["rows"] == 180
    assert audit["partitions"]["train"]["metadata_values"]["occupancy_507"] == {"99999": 180}


@pytest.mark.parametrize("defect", ["missing", "binary", "gap", "duplicate", "reverse"])
def test_audit_fails_instead_of_silently_cleaning(tmp_path, defect):
    write_partitions(tmp_path, defect)
    _, _, audit = m.audit_datasets(tmp_path)
    assert audit["issues"]


def test_protect_old_outputs_and_existing_results(tmp_path):
    with pytest.raises(ValueError):
        m.protect_output(m.ROOT / "outputs")
    with pytest.raises(ValueError):
        m.protect_output(m.ROOT / "data" / "new")
    (tmp_path / "valuable.txt").write_text("keep")
    with pytest.raises(FileExistsError):
        m.protect_output(tmp_path)
    assert (tmp_path / "valuable.txt").read_text() == "keep"


def test_cli_help_and_rejects_bad_settings():
    script = str(m.ROOT / "main.py")
    result = subprocess.run([sys.executable, script, "--help"], capture_output=True, text=True)
    assert result.returncode == 0
    for flag in ("--audit-only", "--baseline-only", "--smoke-test", "--device", "--batch-size",
                 "--validation-origins", "--test-origins", "--output"):
        assert flag in result.stdout
    for args in (["--batch-size", "0"], ["--device", "cuda"], ["--test-origins", "-1"],
                 ["--baseline-only", "--smoke-test"]):
        result = subprocess.run([sys.executable, script, *args], capture_output=True, text=True)
        assert result.returncode == 2

