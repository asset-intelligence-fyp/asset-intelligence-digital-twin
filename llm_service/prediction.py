"""Read-only normal-history expected reading for the active TwinLabs assistant.

This is a comparable-day baseline, NOT a trained forecast. Calculations happen
in Python, not in Qwen; historical rows beyond the requested as_of are excluded.
"""
from __future__ import annotations

import math
import sqlite3
import statistics
from collections import defaultdict
from contextlib import closing
from datetime import timedelta
from pathlib import Path

from .validated_room import MYT, parse_myt, resolve_history_path, rounded

PREDICTABLE = {'temperature', 'humidity', 'co2'}
HORIZONS = (1, 24)
MIN_DAYS = 5


def _percentile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q
    low = int(position)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (position - low)


def expected_room_reading(request, reference_path=''):
    """Compute a source-backed typical reading at +1h or +24h for a canonical sensor."""
    if not isinstance(request, dict):
        raise ValueError('Expected a prediction request object')
    point = request.get('point')
    if not isinstance(point, dict):
        raise ValueError('Canonical sensor point is required')
    code = point.get('code')
    sensor_type = point.get('sensorType')
    if not isinstance(code, str) or not code or len(code) > 100:
        raise ValueError('Invalid canonical sensor ID')
    if sensor_type not in PREDICTABLE:
        raise ValueError('Only temperature, humidity and CO2 are supported')
    if point.get('simulatorRoomId') != request.get('room_id'):
        raise ValueError('Selected sensor and room mismatch')
    horizon = request.get('horizon_hours')
    if type(horizon) is not int or horizon not in HORIZONS:
        raise ValueError('Prediction horizon must be 1 or 24 hours')
    cutoff = parse_myt(request.get('as_of'))
    target = cutoff + timedelta(hours=horizon)
    if request.get('source') not in {'http', 'browser_demo', 'historical_replay', 'what_if'}:
        raise ValueError('Unknown observation source')

    base = {
        'status': 'insufficient_history',
        'sensor_id': code, 'room_id': request.get('room_id'),
        'sensor_type': sensor_type, 'unit': point.get('unit'),
        'as_of': cutoff.isoformat(), 'target_time': target.isoformat(),
        'horizon_hours': horizon, 'expected_value': None,
        'historical_range': None, 'historical_days': 0,
        'minimum_required_days': MIN_DAYS,
        'historical_source': 'unavailable',
        'method': 'Historical same-weekday, ±30-minute comparable-day median',
        'model': 'deterministic_historical_estimator',
        'trained_forecast': False,
        'note': 'Typical historical value for the requested future time, not a trained or validated future forecast.',
        'limitations': [
            'Synthetic normal-history reference; not physical sensor measurements.',
            'Does not predict changes in future occupancy, weather, ventilation or faults.',
            'Historical p10–p90 spread is not a calibrated prediction interval.',
        ],
    }
    if request['source'] != 'http':
        base['limitations'].append('The currently displayed room values are a client-supplied demo/replay/what-if snapshot; the estimate uses a separate historical dataset.')
    path = resolve_history_path(reference_path)
    if not path:
        base['reason'] = 'No local normal-history SQLite database is configured or discovered.'
        return base

    minute = target.hour * 60 + target.minute
    start = (cutoff - timedelta(days=1095)).isoformat()
    daily = defaultdict(list)
    try:
        with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
            matches = db.execute('''SELECT timestamp,value FROM sensor_readings
                 WHERE dataset='normal' AND sensor_id=? AND timestamp<? AND timestamp>=?
                   AND weekday=? AND minute_of_day BETWEEN ? AND ?
                   AND (quality_flag='ok' OR quality_flag IS NULL)
                   AND value IS NOT NULL AND substr(timestamp,1,10)<?
                 ORDER BY timestamp DESC LIMIT 2400''',
                 (code, cutoff.isoformat(), start, target.weekday(),
                  max(0, minute - 30), min(1439, minute + 30),
                  cutoff.date().isoformat()))
            for stamp, value in matches:
                if type(value) in (int, float) and math.isfinite(value):
                    daily[stamp[:10]].append(float(value))
    except (sqlite3.Error, OSError):
        base['reason'] = 'Normal-history database is unreadable or has an incompatible schema.'
        return base
    sample = [statistics.median(vals) for _, vals in sorted(daily.items())][-60:]
    base['historical_days'] = len(sample)
    base['historical_source'] = 'normal_synthetic_sqlite'
    if len(sample) < MIN_DAYS:
        base['reason'] = f'Only {len(sample)} earlier comparable normal days found; at least {MIN_DAYS} are required.'
        return base
    base.update(status='ok', expected_value=rounded(statistics.median(sample)),
                historical_range={'p10': rounded(_percentile(sample, .1)),
                                  'p90': rounded(_percentile(sample, .9))},
                reason='Sufficient comparable historical normal days available.')
    return base
