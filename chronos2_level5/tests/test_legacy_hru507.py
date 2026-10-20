"""Offline deterministic test suite. Does not pretend to run the pretrained model."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd
from legacy_hru507 import (COLS, HORIZONS, chronological_splits, origins_for_segment,
                  forecast_windows, build_prediction_rows, score_forecasts,
                  event_thresholds, select_event_origins)


class Mock:
    def predict_quantiles(self, inputs, prediction_length, quantile_levels, **kwargs):
        assert inputs.ndim == 3 and inputs.shape[1:] == (3, 60)
        pts = np.repeat(inputs[:, :, -1:], prediction_length, axis=2)
        qs = np.stack((pts-1, pts, pts+1), axis=-1)
        return [qs[i] for i in range(len(pts))], [pts[i] for i in range(len(pts))]


def fixture_df(n=1000):
    t = np.arange(n)
    return pd.DataFrame({
        'timestamp': pd.date_range('2024-01-01', periods=n, freq='min'),
        'temperature_c':20+t*0.001,
        'humidity_rh':50+np.sin(t/30),
        'co2_ppm':420+t*0.01,
    })


def test_splits_future_targets_within_split():
    parts = chronological_splits(1000)
    assert parts['train'] == (0,700)
    assert parts['validation'] == (700,850)
    assert parts['test'] == (850,1000)
    origins = origins_for_segment(*parts['test'], 12, 60)
    assert np.min(origins+1) >= 850
    assert np.max(origins+max(HORIZONS)) <= 999


def test_multivariate_shape_and_no_future_target_passed():
    df = fixture_df()
    arr = df[list(COLS)].to_numpy()
    origins = np.array([300,400])
    forecast = forecast_windows(Mock(), arr, origins, 60, 2)
    for o in origins:
        med, quant = forecast[o]
        assert med.shape == (3,15) and quant.shape == (3,15,3)
        np.testing.assert_allclose(med[:,0], arr[o].astype('float32'))
        # The mock takes only the LAST SEEN sample, never t+1 labels.
        assert (med[:,0] != arr[o+1]).all()


def test_baseline_mae_is_model_mae_for_persistence():
    df = fixture_df()
    paths = build_prediction_rows(df, np.array([300,400]), None, 'test', 'persistence_baseline')
    report = score_forecasts(paths)
    assert (report['mae'] == report['persistence_mae']).all()
    assert (report['rmse'] == report['persistence_rmse']).all()
    assert len(report)==len(COLS)*len(HORIZONS)


def test_event_thresholds_only_depend_on_train():
    df = fixture_df()
    a = event_thresholds(df, 700, 0.98)
    df.loc[900:,'temperature_c'] += 500
    b = event_thresholds(df, 700, 0.98)
    assert a==b
    origins, labels = select_event_origins(df, 850,1000, a, 3,60)
    assert len(origins) <= 3*3 and all(t >= 849 for t in origins)
    assert len(labels) == len(origins)

