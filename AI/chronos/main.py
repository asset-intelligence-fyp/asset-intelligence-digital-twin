"""Chronos-2 zero-shot multivariate sensor forecasting for HRU507 / S-L5-008.

Runs locally in VS Code. Inference requires the pretrained model download on first run.
No training or fine-tuning occurs anywhere in this program.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import matplotlib
matplotlib.use('Agg')  # Plot files work without a display; notebook can open saved images.
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

COLS = ('temperature_c', 'humidity_rh', 'co2_ppm')
UNITS = {'temperature_c': '°C', 'humidity_rh': '%RH', 'co2_ppm': 'ppm'}
PROVENANCE = ('temperature_provenance', 'humidity_provenance', 'co2_provenance', 'dataset_type')
HORIZONS = (5, 10, 15)
PREDICTION_LENGTH = max(HORIZONS)
QUANTILES = (0.1, 0.5, 0.9)
DEFAULT_CSV = Path('data/HRU507_S-L5-008_1min_aligned.csv')


@dataclass
class Settings:
    csv: str = str(DEFAULT_CSV)
    output: str = 'outputs'
    mode: str = 'chronos'  # chronos | baseline
    context_candidates: tuple[int, ...] = (60, 180)
    validation_origins: int = 32
    test_origins: int = 64
    event_origins: int = 18  # maximum per sensor / test period
    batch_size: int = 6
    device: str = 'auto'
    model_id: str = 'amazon/chronos-2'
    event_quantile: float = 0.98
    seed: int = 42


def data_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as source:
        for data in iter(lambda: source.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def load_dataset(path: str | Path) -> pd.DataFrame:
    """Read only inference targets and metadata; never feed metadata to the model."""
    csv_path = Path(path)
    if not csv_path.is_file():
        raise FileNotFoundError(f'Dataset not found: {csv_path.resolve()}. See README.md.')
    keep = ['timestamp', 'asset_id', 'sensor_id', *COLS, *PROVENANCE]
    df = pd.read_csv(csv_path, usecols=keep, parse_dates=['timestamp'], low_memory=False)
    if df.empty:
        raise ValueError('CSV has no rows.')
    if df['timestamp'].isna().any() or df['timestamp'].duplicated().any():
        raise ValueError('Missing or repeated timestamps: fix the source CSV, do not silently drop rows.')
    if not df['timestamp'].is_monotonic_increasing:
        raise ValueError('CSV timestamps must be sorted ascending; fix the original source ordering.')
    if df['asset_id'].nunique() != 1 or df['sensor_id'].nunique() != 1:
        raise ValueError('This experiment expects exactly one asset_id and sensor_id.')
    dt = df['timestamp'].diff().dropna()
    if not dt.eq(pd.Timedelta(minutes=1)).all():
        raise ValueError('Readings must be consecutive one-minute intervals; no automatic filling or interpolation.')
    for col in COLS:
        df[col] = pd.to_numeric(df[col], errors='raise')
        if not np.isfinite(df[col].to_numpy(dtype=np.float64)).all():
            raise ValueError(f'{col} contains missing, infinite, or invalid numerical values.')
    if not (df['humidity_rh'].between(0, 100).all() and df['co2_ppm'].ge(0).all()):
        raise ValueError('Found physically impossible humidity or CO2 values.')
    if len(df) < 500:
        raise ValueError('Need at least 500 one-minute samples for chronological evaluation.')
    return df


def chronological_splits(n: int) -> dict[str, tuple[int, int]]:
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)
    return {'train': (0, train_end), 'validation': (train_end, val_end), 'test': (val_end, n)}


def origins_for_segment(start: int, end: int, count: int, minimum_context: int) -> np.ndarray:
    """Each origin t predicts t+1 .. t+15, ALL inside this evaluation segment."""
    low = max(minimum_context - 1, start - 1)
    high = end - 1 - PREDICTION_LENGTH
    if high < low:
        raise ValueError('Insufficient consecutive rows for evaluation contexts and future horizon.')
    size = min(count, high - low + 1)
    return np.unique(np.linspace(low, high, num=size, dtype=np.int64))


def choose_device(request: str) -> str:
    if request not in ('auto', 'cuda', 'mps', 'cpu'):
        raise ValueError('device must be one of auto, cuda, mps, cpu')
    import torch
    if request == 'auto':
        if torch.cuda.is_available():
            return 'cuda'
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return 'mps'
        return 'cpu'
    if request == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA requested but unavailable. Use --device cpu or auto.')
    if request == 'mps' and not (hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()):
        raise RuntimeError('MPS requested but unavailable. Use --device cpu or auto.')
    return request


def load_chronos_pipeline(model_id: str, device: str):
    """Official Chronos-2 API: pretrained model; no .fit(), no gradient updates."""
    try:
        from chronos import Chronos2Pipeline
    except ImportError as exc:
        raise RuntimeError('Install requirements.txt: python -m pip install -r requirements.txt') from exc
    print(f'Loading {model_id} on {device} (first use downloads model weights)...', flush=True)
    try:
        return Chronos2Pipeline.from_pretrained(model_id, device_map=device)
    except Exception as exc:
        raise RuntimeError(
            f'Unable to load pretrained {model_id} on {device}. First download requires internet; '
            'check model access, package versions and available RAM. Try --device cpu.'
        ) from exc


def forecast_windows(pipeline, arr: np.ndarray, origins: np.ndarray, context: int,
                     batch_size: int) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    """Return origin -> (median [3,15], quantiles [3,15,3]). No future labels enter model."""
    result: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for start in range(0, len(origins), batch_size):
        batch_origins = origins[start:start + batch_size]
        windows = np.stack([
            arr[int(t) - context + 1:int(t) + 1, :].T
            for t in batch_origins
        ]).astype('float32', copy=False)  # [B, 3, C], all values <= origin time
        if windows.shape != (len(batch_origins), len(COLS), context):
            raise AssertionError('Incorrect past-context shape.')
        # Quantile 0.5 represents the median point prediction in official Chronos-2.
        predicted_quantiles, point_pred = pipeline.predict_quantiles(
            windows, prediction_length=PREDICTION_LENGTH,
            quantile_levels=list(QUANTILES), batch_size=batch_size, cross_learning=False
        )
        for i, origin in enumerate(batch_origins):
            med = np.asarray(point_pred[i], dtype=np.float64)
            qu = np.asarray(predicted_quantiles[i], dtype=np.float64)
            if med.shape != (len(COLS), PREDICTION_LENGTH) or qu.shape != (len(COLS), PREDICTION_LENGTH, 3):
                raise RuntimeError(f'Unexpected Chronos-2 prediction shapes: {med.shape}, {qu.shape}')
            if not (np.isfinite(med).all() and np.isfinite(qu).all()):
                raise ValueError(f'Nonfinite Chronos predictions for origin {origin}')
            result[int(origin)] = (med, qu)
        print(f'  Forecasted {min(start + batch_size, len(origins))}/{len(origins)} origins', flush=True)
    return result


def build_prediction_rows(df: pd.DataFrame, origins: np.ndarray,
                          forecasts: dict[int, tuple[np.ndarray, np.ndarray]] | None,
                          split: str, model_name: str) -> pd.DataFrame:
    values = df.loc[:, COLS].to_numpy(dtype=np.float64)
    timestamps = df['timestamp'].to_numpy()
    rows: list[dict] = []
    for t in origins:
        t = int(t)
        if forecasts is None:
            med = np.tile(values[t, :].reshape(3, 1), (1, PREDICTION_LENGTH))
            quant = np.full((3, PREDICTION_LENGTH, 3), np.nan)
        else:
            med, quant = forecasts[t]
        for c, col in enumerate(COLS):
            for h in range(1, PREDICTION_LENGTH + 1):
                rows.append({
                    'split': split, 'model': model_name, 'origin_timestamp': timestamps[t],
                    'target_timestamp': timestamps[t + h], 'horizon_minutes': h,
                    'sensor': col, 'units': UNITS[col], 'actual': float(values[t + h, c]),
                    'predicted': float(med[c, h - 1]),
                    'p10': float(quant[c, h - 1, 0]),
                    'p50': float(quant[c, h - 1, 1]),
                    'p90': float(quant[c, h - 1, 2]),
                    'persistence': float(values[t, c]),
                })
    return pd.DataFrame.from_records(rows)


def score_forecasts(paths: pd.DataFrame, selected_horizons: tuple[int, ...] = HORIZONS) -> pd.DataFrame:
    records = []
    for (split, model, sensor, h), group in paths[paths['horizon_minutes'].isin(selected_horizons)].groupby(
        ['split', 'model', 'sensor', 'horizon_minutes'], sort=True
    ):
        actual = group['actual'].to_numpy()
        forecast = group['predicted'].to_numpy()
        baseline = group['persistence'].to_numpy()
        mae = float(np.mean(np.abs(actual - forecast)))
        rmse = float(np.sqrt(np.mean((actual - forecast) ** 2)))
        base_mae = float(np.mean(np.abs(actual - baseline)))
        base_rmse = float(np.sqrt(np.mean((actual - baseline) ** 2)))
        cover = float(np.mean((actual >= group['p10']) & (actual <= group['p90']))) if group['p10'].notna().all() else None
        records.append({
            'split': split, 'model': model, 'sensor': sensor, 'units': UNITS[sensor],
            'horizon_minutes': int(h), 'n_origins': len(group), 'mae': mae, 'rmse': rmse,
            'persistence_mae': base_mae, 'persistence_rmse': base_rmse,
            'mae_skill_vs_persistence': (1 - mae / base_mae) if base_mae > 0 else None,
            'p10_p90_coverage': cover,
        })
    return pd.DataFrame.from_records(records)


def validation_score(metric_df: pd.DataFrame, training_scales: dict[str, float]) -> float:
    """Equal importance per sensor and horizon; avoid °C/%RH/ppm scale bias."""
    return float(np.mean([
        float(r['mae']) / training_scales[r['sensor']]
        for _, r in metric_df.iterrows()
    ]))


def event_thresholds(df: pd.DataFrame, train_end: int, quantile: float) -> dict[str, float]:
    v = df.loc[:, COLS].to_numpy(dtype=np.float64)
    # Thresholds are computed STRICTLY from the train segment.
    return {c: float(np.quantile(np.abs(v[PREDICTION_LENGTH:train_end, j] -
                                           v[:train_end-PREDICTION_LENGTH, j]), quantile))
            for j, c in enumerate(COLS)}


def select_event_origins(df: pd.DataFrame, test_start: int, test_end: int,
                         thresholds: dict[str, float], max_each: int, minimum_context: int
                         ) -> tuple[np.ndarray, dict[int, list[str]]]:
    """Outcome-labelled transition subset, used ONLY for post-hoc testing, never to tune settings.

    Selection uses actual t+15 solely to describe test events; models see only <= t.
    """
    v = df.loc[:, COLS].to_numpy(dtype=np.float64)
    eligible_start = max(test_start - 1, minimum_context - 1)
    eligible_end = test_end - 1 - PREDICTION_LENGTH
    all_origins = np.arange(eligible_start, eligible_end + 1)
    selected: dict[int, list[str]] = {}
    for j, sensor in enumerate(COLS):
        shift = np.abs(v[all_origins + PREDICTION_LENGTH, j] - v[all_origins, j])
        event_ix = np.flatnonzero(shift >= thresholds[sensor])
        if len(event_ix) > max_each:
            event_ix = event_ix[np.unique(np.linspace(0, len(event_ix)-1, max_each, dtype=int))]
        for ix in event_ix:
            t = int(all_origins[ix])
            selected.setdefault(t, []).append(sensor)
    return np.asarray(sorted(selected), dtype=np.int64), selected


def plot_example(paths: pd.DataFrame, output_file: Path, name: str) -> None:
    import matplotlib.dates as mdates
    all_origins = paths['origin_timestamp'].unique()
    if not len(all_origins):
        return
    # Choose a single origin around the center of evaluation for an easy-to-read trajectory.
    middle = all_origins[len(all_origins)//2]
    sample = paths[paths['origin_timestamp'] == middle]
    fig, axes = plt.subplots(3, 1, figsize=(11, 9), sharex=True, constrained_layout=True)
    for ax, sensor in zip(axes, COLS):
        sub = sample[sample.sensor == sensor].sort_values('horizon_minutes')
        x = pd.to_datetime(sub['target_timestamp'])
        ax.plot(x, sub['actual'], marker='o', ms=3, label='Actual', linewidth=1.7)
        ax.plot(x, sub['predicted'], marker='.', label=name, linewidth=1.7)
        if not (sub['model'] == 'persistence_baseline').all():
            ax.plot(x, sub['persistence'], linestyle='--', label='Persistence baseline', alpha=0.7)
        if sub['p10'].notna().all():
            ax.fill_between(x, sub['p10'].to_numpy(), sub['p90'].to_numpy(), alpha=0.17,
                            label='Chronos p10–p90 (80% interval)')
        ax.set_ylabel(f'{sensor} ({UNITS[sensor]})')
        ax.grid(alpha=0.2)
        ax.legend(fontsize=8, loc='best')
    axes[-1].xaxis.set_major_formatter(mdates.DateFormatter('%m-%d %H:%M'))
    axes[-1].tick_params(axis='x', rotation=20)
    fig.suptitle(f'{name}: 15-minute forecast from {pd.Timestamp(middle)} (test split)')
    fig.savefig(output_file, dpi=160)
    plt.close(fig)


def provenance_report(df: pd.DataFrame, splits: dict, path: Path, settings: Settings) -> dict:
    info = {
        'source_csv_name': Path(settings.csv).name,
        'source_csv_sha256': data_sha256(Path(settings.csv)),
        'n_samples': len(df),
        'timestamp_start': str(df['timestamp'].iloc[0]),
        'timestamp_end': str(df['timestamp'].iloc[-1]),
        'frequency': '1 minute; validated without filling',
        'asset_id': str(df['asset_id'].iloc[0]), 'sensor_id': str(df['sensor_id'].iloc[0]),
        'splits': {name: {'start_index': int(bounds[0]), 'end_index_exclusive': int(bounds[1]),
                           'first_timestamp': str(df['timestamp'].iloc[bounds[0]]),
                           'last_timestamp': str(df['timestamp'].iloc[bounds[1]-1])}
                   for name, bounds in splits.items()},
        'provenance': {c: df[c].value_counts(dropna=False).astype(int).to_dict() for c in PROVENANCE},
        'source_notes': [
            'Temperature is a proxy sourced from ZONE_TEMP_1 under an assumed Fahrenheit conversion.',
            'Humidity and CO2 are synthetic physical-mass-balance readings.',
            'Hybrid/simulated forecasting is NOT physical-building accuracy validation.',
            'The experiment excludes occupied_mode, scenario_occupants, and all provenance columns from model inputs.',
        ],
        'target_summary': df[list(COLS)].describe().round(4).to_dict(),
        'python_version': sys.version.split()[0], 'operating_system': platform.platform(),
        'settings': asdict(settings), 'model_was_finetuned': False,
    }
    (path / 'dataset_audit.json').write_text(json.dumps(info, indent=2, default=str), encoding='utf-8')
    return info


def save_paths_and_metrics(paths: pd.DataFrame, output: Path, prefix: str) -> pd.DataFrame:
    paths.to_csv(output / f'{prefix}_forecast_paths.csv', index=False)
    metrics = score_forecasts(paths)
    metrics.to_csv(output / f'{prefix}_metrics.csv', index=False)
    return metrics


def run(settings: Settings) -> dict:
    if not (0.5 < settings.event_quantile < 1.0):
        raise ValueError('Event quantile should be >0.5 and <1.')
    if any(c < PREDICTION_LENGTH for c in settings.context_candidates):
        raise ValueError('All context lengths must be at least 15 minutes.')
    np.random.seed(settings.seed)
    output = Path(settings.output); output.mkdir(parents=True, exist_ok=True)
    df = load_dataset(settings.csv)
    splits = chronological_splits(len(df))
    audit = provenance_report(df, splits, output, settings)
    print(f'Dataset: {len(df):,} rows, {audit["timestamp_start"]} to {audit["timestamp_end"]}')
    print('WARNING: humidity/CO2 are SIMULATED; temperature provenance assumes Fahrenheit.')
    training = df.iloc[slice(*splits['train'])]
    scales = {c: max(float(training[c].std()), 1e-6) for c in COLS}
    ctxmax = max(settings.context_candidates)
    val_origins = origins_for_segment(*splits['validation'], settings.validation_origins, ctxmax)
    test_origins = origins_for_segment(*splits['test'], settings.test_origins, ctxmax)
    arr = df.loc[:, COLS].to_numpy(dtype=np.float64)
    thresholds = event_thresholds(df, splits['train'][1], settings.event_quantile)
    audit['event_thresholds_15m_train_only'] = thresholds
    (output / 'dataset_audit.json').write_text(json.dumps(audit, indent=2, default=str), encoding='utf-8')
    print('Chronological splits:', {k:(df.timestamp.iloc[a],df.timestamp.iloc[b-1]) for k,(a,b) in splits.items()})
    print('Validation origins:', len(val_origins), 'Test origins:', len(test_origins))

    if settings.mode == 'baseline':
        bp = build_prediction_rows(df, test_origins, None, 'test', 'persistence_baseline')
        bm = save_paths_and_metrics(bp, output, 'baseline_test')
        plot_example(bp, output / 'baseline_test_example.png', 'Persistence baseline')
        event_origins, assigned = select_event_origins(df, *splits['test'], thresholds,
                                                       settings.event_origins, ctxmax)
        if len(event_origins):
            ep = build_prediction_rows(df, event_origins, None, 'test_events', 'persistence_baseline')
            ep['event_sensor_labels'] = ep['origin_timestamp'].map({df.timestamp.iloc[k]: ';'.join(v)
                                                                    for k, v in assigned.items()})
            save_paths_and_metrics(ep, output, 'baseline_events')
        print('Baseline-only finished. No Chronos-2 predictions were generated.')
        return {'mode':'baseline', 'dataset':audit, 'test_metrics':bm, 'n_events':len(event_origins)}
    if settings.mode != 'chronos':
        raise ValueError('mode must be chronos or baseline')

    device = choose_device(settings.device)
    pipeline = load_chronos_pipeline(settings.model_id, device)
    experiment_start = time.perf_counter()
    candidates = []
    # All candidate models are zero-shot; ONLY validation data chooses the context.
    for context in settings.context_candidates:
        print(f'Validating context length {context} minutes...', flush=True)
        v_forecasts = forecast_windows(pipeline, arr, val_origins, context, settings.batch_size)
        v_paths = build_prediction_rows(df, val_origins, v_forecasts, 'validation', 'chronos2_zero_shot')
        v_metrics = score_forecasts(v_paths)
        score = validation_score(v_metrics, scales)
        candidates.append({'context_minutes': context, 'normalized_validation_mae': score})
        v_metrics.to_csv(output / f'validation_context_{context}_metrics.csv', index=False)
    candidates_df = pd.DataFrame(candidates).sort_values(['normalized_validation_mae', 'context_minutes'])
    candidates_df.to_csv(output / 'validation_context_selection.csv', index=False)
    best_ctx = int(candidates_df.iloc[0]['context_minutes'])
    print(f'Chosen context (validation only): {best_ctx} minutes. Evaluating held-out test...', flush=True)
    test_forecasts = forecast_windows(pipeline, arr, test_origins, best_ctx, settings.batch_size)
    test_paths = build_prediction_rows(df, test_origins, test_forecasts, 'test', 'chronos2_zero_shot')
    test_metrics = save_paths_and_metrics(test_paths, output, 'chronos2_test')
    plot_example(test_paths, output / 'chronos2_test_example.png', 'Chronos-2 zero-shot median')

    events, assigned = select_event_origins(df, *splits['test'], thresholds,
                                            settings.event_origins, best_ctx)
    if len(events):
        print(f'Evaluating {len(events)} distinct transition origins...', flush=True)
        event_preds = forecast_windows(pipeline, arr, events, best_ctx, settings.batch_size)
        event_paths = build_prediction_rows(df, events, event_preds, 'test_events', 'chronos2_zero_shot')
        event_paths['event_sensor_labels'] = event_paths['origin_timestamp'].map(
            {df.timestamp.iloc[k]:';'.join(v) for k,v in assigned.items()})
        save_paths_and_metrics(event_paths, output, 'chronos2_events')
        # Also report event scores per triggering sensor, not only a mixed-event average.
        target_event_scores = []
        for sensor in COLS:
            relevant_times = {df.timestamp.iloc[k] for k, labels in assigned.items() if sensor in labels}
            sub = event_paths[(event_paths.sensor == sensor) &
                              (event_paths.origin_timestamp.isin(relevant_times))]
            if len(sub):
                target_event_scores.append(score_forecasts(sub))
        if target_event_scores:
            pd.concat(target_event_scores, ignore_index=True).to_csv(
                output / 'chronos2_triggered_sensor_event_metrics.csv', index=False)
    experiment_meta = {
        'model_id': settings.model_id, 'device': device, 'zero_shot': True,
        'multivariate_joint_targets': list(COLS), 'future_sensor_values_provided_to_model': False,
        'model_context_selected_from_validation_only': best_ctx, 'candidate_contexts': candidates,
        'selected_test_origins': len(test_origins), 'selected_transition_origins': len(events),
        'elapsed_seconds_including_validation': round(time.perf_counter()-experiment_start, 2),
        'scientific_caveat':'HYBRID_OBSERVED_PROXY_AND_SIMULATED dataset, not a real-building validation',
    }
    (output / 'experiment_metadata.json').write_text(json.dumps(experiment_meta, indent=2), encoding='utf-8')
    print(test_metrics.to_string(index=False))
    print('Chronos-2 evaluation finished. Outputs saved to:', output.resolve())
    return {'mode':'chronos', 'metadata':experiment_meta, 'test_metrics':test_metrics}


def self_test() -> None:
    """Synthetic unit smoke test (NOT an experiment or performance claim)."""
    class FakePipeline:
        def predict_quantiles(self, windows, prediction_length, quantile_levels, **kwargs):
            assert windows.ndim == 3 and windows.shape[1] == 3
            assert windows.shape[2] == 60
            med = np.repeat(windows[:, :, -1:,], prediction_length, axis=2)
            q = np.stack([med - 1, med, med + 1], axis=-1)
            return [q[i] for i in range(len(q))], [med[i] for i in range(len(med))]
    arr = np.arange(1000*3, dtype=np.float64).reshape(1000,3)
    origins = np.array([100, 300])
    forecasts = forecast_windows(FakePipeline(), arr, origins, 60, 2)
    assert (forecasts[100][0][:, 0] == arr[100]).all()
    assert (forecasts[100][0][:, 14] == arr[100]).all()
    assert (forecasts[100][0][:, 0] != arr[101]).all()
    assert forecasts[300][1].shape == (3, 15, 3)
    splits = chronological_splits(1000)
    assert splits['train'][1] == splits['validation'][0]
    assert splits['validation'][1] == splits['test'][0]
    print('SELF-TEST PASS: correct window isolation, shapes, split boundaries. Fake outputs were NOT saved.')


def cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', default=str(DEFAULT_CSV), help='One-minute aligned sensor CSV')
    parser.add_argument('--output', default='outputs', help='Output folder')
    parser.add_argument('--baseline-only', action='store_true', help='Only real-data persistence benchmark; NO pretrained model')
    parser.add_argument('--self-test', action='store_true', help='Synthetic leakage/shape smoke test, no results saved')
    parser.add_argument('--context-candidates', type=int, nargs='+', default=[60, 180])
    parser.add_argument('--validation-origins', type=int, default=32)
    parser.add_argument('--test-origins', type=int, default=64)
    parser.add_argument('--event-origins', type=int, default=18)
    parser.add_argument('--batch-size', type=int, default=6)
    parser.add_argument('--device', choices=['auto','cuda','mps','cpu'], default='auto')
    parser.add_argument('--model-id', default='amazon/chronos-2')
    args = parser.parse_args()
    if args.self_test:
        self_test(); return
    s = Settings(csv=args.csv, output=args.output, mode='baseline' if args.baseline_only else 'chronos',
                 context_candidates=tuple(args.context_candidates),
                 validation_origins=args.validation_origins, test_origins=args.test_origins,
                 event_origins=args.event_origins, batch_size=args.batch_size, device=args.device,
                 model_id=args.model_id)
    run(s)

if __name__ == '__main__':
    cli()
