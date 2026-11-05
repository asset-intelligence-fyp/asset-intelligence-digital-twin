"""Export blind joint classification/forecast cases from recorded simulator CSVs.
The private key is never supplied to the model runner. Run on a separate held-out session.
"""
import argparse
import bisect
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import random

def stamp(s):
    dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamps must include a timezone')
    return dt.timestamp()

def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()

def prepare(readings, labels, out, count=40, horizon=15, seed=42):
    if count < 2 or horizon not in (5, 15, 30):
        raise ValueError('Use at least two cases and a 5/15/30 minute horizon')
    registry = json.loads((Path(__file__).resolve().parents[1] / 'shared/sensorRegistry.json').read_text())
    continuous = {p['code'] for p in registry if p['unit'] != 'binary'}
    groups = {}
    with Path(readings).open(newline='', encoding='utf8') as f:
        for r in csv.DictReader(f):
            code = r['sensor_id']
            if code in continuous:
                t = stamp(r['timestamp'])
                try:
                    value = float(r['value'])
                    if not math.isfinite(value):
                        value = None
                except (ValueError, TypeError):
                    value = None
                groups.setdefault(code, {})[t] = value
    truth = {}
    with Path(labels).open(newline='', encoding='utf8') as f:
        for r in csv.DictReader(f):
            if r['fault_active'] in ('0', '1'):
                truth[(r['sensor_id'], stamp(r['timestamp']))] = r['fault_active'] == '1'
    candidates = {False: [], True: []}
    for code, series in groups.items():
        times = sorted(series)
        for i, t in enumerate(times):
            label = truth.get((code, t))
            if label is None or series[t] is None:
                continue
            history_times = times[bisect.bisect_left(times, t - 3600):i + 1]
            good = [v for v in history_times if series[v] is not None]
            if len(good) < 6 or good[-1] - good[0] < 900 or any(b - a > 600 for a, b in zip(good, good[1:])):
                continue
            target = t + horizon * 60
            j = bisect.bisect_left(times, target)
            choices = [times[k] for k in (j - 1, j) if 0 <= k < len(times)]
            if not choices:
                continue
            actual = min(choices, key=lambda x: abs(x - target))
            if actual <= t or abs(actual - target) > 30 or series[actual] is None:
                continue
            candidates[label].append((code, t, history_times, actual, target))
    rng = random.Random(seed)
    public, private, selected = [], [], {}
    for label in (True, False):
        rng.shuffle(candidates[label])
        target_count = count // 2 if label else count - count // 2
        for code, t, history_times, actual, target in candidates[label]:
            # Avoid almost identical adjacent windows for one sensor.
            if any(abs(t - old) < 3600 for old in selected.get(code, [])):
                continue
            selected.setdefault(code, []).append(t)
            case_id = 'Q' + str(len(public) + 1).zfill(4)
            public.append({'case_id': case_id, 'task': 'combined', 'point_code': code, 'as_of': iso(t), 'horizon_minutes': horizon,
                           'question': 'Does this sensor need investigation now, and what is its expected future reading?',
                           'rows': [{'point_code': code, 'timestamp': iso(ht), 'value': groups[code][ht], 'quality': 'synthetic' if groups[code][ht] is not None else 'missing'} for ht in history_times]})
            private.append({'case_id': case_id, 'needs_investigation': label, 'point_code': code, 'horizon_minutes': horizon,
                            'target_time': iso(target), 'actual_observed_time': iso(actual), 'future_value': groups[code][actual]})
            target_count -= 1
            if target_count == 0:
                break
    paired = list(zip(public, private))
    rng.shuffle(paired)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if any((out / name).exists() for name in ('public.jsonl', 'answer_key_PRIVATE.jsonl', 'manifest.json')):
        raise ValueError('Refusing to overwrite an existing evaluation set')
    for filename, records in [('public.jsonl', [p for p, k in paired]), ('answer_key_PRIVATE.jsonl', [k for p, k in paired])]:
        path = out / filename
        if path.exists():
            raise ValueError('Refusing to overwrite an existing evaluation set')
        path.write_text(''.join(json.dumps(r) + '\n' for r in records))
    positives = sum(k['needs_investigation'] for k in private)
    report = {'cases': len(public), 'positives': positives, 'negatives': len(public) - positives, 'seed': seed, 'horizon_minutes': horizon,
              'source_sha256': {Path(p).name: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (readings, labels)},
              'warning': 'EXPLORATORY ONLY: both classes and the requested case count are required for the planned classification study.' if not positives or positives == len(public) or len(public) < count else 'Synthetic held-out evaluation; not real-building validation.',
              'method': 'Sensor-specific windows spaced at least one hour; future match within thirty seconds. No operating context is exported; context-dependent labels may be ambiguous. Review labels and split by recording session before evaluation.'}
    (out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--readings', required=True)
    parser.add_argument('--labels', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--count', type=int, default=40)
    parser.add_argument('--horizon', type=int, choices=(5, 15, 30), default=15)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(prepare(args.readings, args.labels, args.out_dir, args.count, args.horizon, args.seed), indent=2))
