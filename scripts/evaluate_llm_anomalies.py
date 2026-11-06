#!/usr/bin/env python3
"""Blind synthetic-fault benchmark for the deployed Qwen3 validated room assistant.

Prepare reads labels once and exports separate public cases / PRIVATE answer key.
Run reads only public cases + sensor_history.csv + normal-only reference SQLite.
Score reads the hidden key *after inference*. No labels are passed to Qwen.

This tests an isolated focus sensor (one room point per request), not a whole-room
multisensor alarm. Fault-active means injected fault, not necessarily a visible spike.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
import csv
from datetime import datetime, timedelta
import json
import math
import os
from pathlib import Path
import random
import sqlite3
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from llm_service.validated_room import analyse_validated, parse_myt
from llm_service.shared_llm.ollama import OllamaClient


def read_csv(path):
    with Path(path).open(newline='', encoding='utf8') as fh:
        yield from csv.DictReader(fh)


def read_jsonl(path):
    with Path(path).open(encoding='utf8') as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def write_jsonl(path, records):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf8') as fh:
        for row in records:
            fh.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')


def registry():
    rows = json.loads((ROOT / 'shared' / 'sensorRegistry.json').read_text(encoding='utf8'))
    return {r['code']: r for r in rows}


def prepare_cases(folder, public_path, key_path, *, negatives=100, positive_per_event=2,
                  max_events=100, seed=42, normal_exclusion_minutes=60):
    """Create a balanced *diagnostic* sample; not an operational prevalence estimate."""
    folder, public_path, key_path = Path(folder), Path(public_path), Path(key_path)
    if public_path.resolve() == key_path.resolve():
        raise ValueError('Public cases and hidden answer key cannot share a path')
    if not key_path.name.endswith('_PRIVATE.jsonl'):
        raise ValueError('The hidden answer key filename must end with _PRIVATE.jsonl')
    if negatives < 1 or positive_per_event < 1 or max_events < 1:
        raise ValueError('Case counts must be positive')
    events = list(read_csv(folder / 'ground_truth_events.csv'))
    if not events:
        raise ValueError('No injected events: generate a fresh --fault-mode live or demo dataset')
    known = registry()
    events = [e for e in events if e.get('sensor_id') in known]
    rng = random.Random(seed)
    events.sort(key=lambda e: (e['start'], e['event_id']))
    rng.shuffle(events)
    selected = events[:max_events]
    selected_ids = {e['event_id'] for e in selected}
    if len(selected_ids) != len(selected):
        raise ValueError('Duplicate event IDs found')
    positive_by_event = defaultdict(list)
    candidates_negative = []
    for r in read_csv(folder / 'ground_truth_labels.csv'):
        if r.get('sensor_id') not in known:
            continue
        if r.get('fault_active') == '1' and r.get('event_id') in selected_ids:
            positive_by_event[r['event_id']].append(r)
        elif r.get('fault_active') == '0':
            candidates_negative.append(r)
    chosen = []
    for event in selected:
        samples = sorted(positive_by_event[event['event_id']], key=lambda r: r['timestamp'])
        if not samples:
            continue
        indices = sorted({round((i + 1) * (len(samples) - 1) / (positive_per_event + 1))
                          for i in range(positive_per_event)})
        for idx in indices:
            r = samples[idx]
            chosen.append((r, event))
    if not chosen:
        raise ValueError('No positive labels matched the selected events')
    # Exclude normal observations near *every* injected event, including
    # those not sampled. Recovery can persist beyond fault_active=0.
    every_event = list(read_csv(folder / 'ground_truth_events.csv'))
    exclusion = defaultdict(list)
    for e in every_event:
        try:
            exclusion[e['sensor_id']].append((parse_myt(e['start']) - timedelta(minutes=normal_exclusion_minutes),
                                               parse_myt(e['end']) + timedelta(minutes=normal_exclusion_minutes)))
        except (ValueError, KeyError):
            continue
    eligible = []
    for r in candidates_negative:
        try:
            instant = parse_myt(r['timestamp'])
        except ValueError:
            continue
        if all(not (start <= instant <= end) for start, end in exclusion[r['sensor_id']]):
            eligible.append(r)
    if not eligible:
        raise ValueError('No normal cases remain after event/recovery exclusion')
    rng.shuffle(eligible)
    chosen.extend((r, None) for r in eligible[:negatives])
    rng.shuffle(chosen)
    public, hidden = [], []
    for index, (label, event) in enumerate(chosen, 1):
        code = label['sensor_id']
        id_ = f'A{index:05d}'
        public.append({'case_id': id_, 'sensor_id': code,
                       'room_id': known[code]['simulatorRoomId'],
                       'at_time': label['timestamp']})
        hidden.append({'case_id': id_, 'fault_active': int(label['fault_active']),
                       'sensor_id': code, 'sensor_type': known[code]['sensorType'],
                       'at_time': label['timestamp'], 'scenario': label.get('scenario') or 'normal',
                       'event_id': label.get('event_id') or '',
                       'event_start': event['start'] if event else None})
    write_jsonl(public_path, public)
    write_jsonl(key_path, hidden)
    return {'cases': len(public), 'positive_cases': sum(r['fault_active'] for r in hidden),
            'negative_cases': sum(not r['fault_active'] for r in hidden),
            'events_sampled': len({r['event_id'] for r in hidden if r['event_id']}),
            'public_cases': str(public_path), 'private_answer_key': str(key_path),
            'warning': 'The PRIVATE answer key must never be used by run/inference.'}


def load_history(path, sensor_ids):
    """Index sensor values only. Explicitly ignore labels and source metadata."""
    readings = defaultdict(list)
    for row in read_csv(path):
        code = row.get('sensor_id')
        if code not in sensor_ids:
            continue
        try:
            moment = parse_myt(row['timestamp'])
            value = float(row['value'])
            if not math.isfinite(value):
                continue
        except (KeyError, ValueError, TypeError):
            continue
        readings[code].append((moment, value))
    for values in readings.values():
        values.sort(key=lambda pair: pair[0])
    return readings


def make_request(case, point, indexed, window_minutes=60):
    """Only readings at/before the origin, never fault labels, future values or truth."""
    cutoff = parse_myt(case['at_time'])
    rows = indexed.get(case['sensor_id'], [])
    # Sorted timestamp lists permit a deterministic inclusive cutoff.
    times = [stamp for stamp, _ in rows]
    end = bisect_right(times, cutoff)
    start = cutoff - timedelta(minutes=window_minutes)
    values = [(t, v) for t, v in rows[max(0, end - 18000):end] if t >= start]
    if not values:
        raise ValueError('No observed sensor readings within the historical window')
    return {'room_id': point['simulatorRoomId'],
            'room_name': point.get('locationLabel'),
            'points': [point], 'as_of': cutoff.isoformat(),
            'source': 'historical_replay',
            'question': f"At {cutoff.isoformat()}, does sensor {point['code']} require investigation? Explain verified evidence.",
            'history': [{'point_code': point['code'], 'timestamp': t.isoformat(),
                         'value': v, 'quality': 'ok'} for t, v in values]}


def infer_case(case, point, history, db_path, factory):
    started = time.perf_counter()
    result = {'case_id': case['case_id'], 'sensor_id': case['sensor_id'],
              'at_time': case['at_time'], 'model': 'qwen3:1.7b',
              'llm_raw': None, 'llm_scorable': None, 'historical_rule': None,
              'validated_hybrid': None, 'operational_triage': None,
              'status': 'runtime_error', 'numeric_verification_passed': False,
              'narrative_numeric_issues': 0, 'finding': '', 'error': None}
    try:
        request = make_request(case, point, history)
        response = analyse_validated(request, {'model': 'qwen3:1.7b', 'prompt': 'concise',
                            'validation_mode': 'hybrid_semantic', 'history_db': str(db_path)}, factory)
        status = response['status']
        assessment = response['decision_assessment']
        result.update(status=status,
                      llm_raw=assessment.get('llm_alert_raw'),
                      llm_scorable=assessment.get('llm_alert_scorable'),
                      historical_rule=assessment.get('historical_rule_alert'),
                      validated_hybrid=True if status == 'alert' else False if status == 'no_alert' else None,
                      operational_triage=status in ('alert', 'review_required') if status in
                          ('alert', 'review_required', 'no_alert') else None,
                      numeric_verification_passed=response.get('numeric_verification_passed') is True,
                      narrative_numeric_issues=len(assessment.get('narrative_numeric_issues') or []),
                      finding=response.get('result', {}).get('finding', '')[:2000])
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {str(exc)[:240]}'
    result['elapsed_seconds'] = round(time.perf_counter() - started, 3)
    return result


def run_cases(public_path, sensor_csv, db_path, output, *, ollama_url='http://127.0.0.1:11434',
              limit=0, resume=False, factory=None):
    """BLIND inference: intentionally has no parameter for truth or answer keys."""
    if not Path(db_path).is_file():
        raise ValueError('A normal-history SQLite file is required for consistent rule comparisons')
    with sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True) as db:
        fields = {r[1] for r in db.execute('PRAGMA table_info(sensor_readings)')}
        required = {'dataset','sensor_id','timestamp','weekday','minute_of_day','quality_flag','value'}
        if not required.issubset(fields):
            raise ValueError('Normal history SQLite lacks required sensor_readings columns: ' + str(sorted(required-fields)))
        if db.execute("SELECT 1 FROM sensor_readings WHERE dataset='normal' LIMIT 1").fetchone() is None:
            raise ValueError('Normal history SQLite contains no normal sensor readings')
    public = list(read_jsonl(public_path))
    if not public:
        raise ValueError('Public cases are empty')
    ids = [r.get('case_id') for r in public]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate public case IDs')
    known = registry()
    for case in public:
        if case.get('sensor_id') not in known or case.get('room_id') != known[case['sensor_id']]['simulatorRoomId']:
            raise ValueError('Unknown sensor or mismatched room in public case')
        if set(case) != {'case_id','sensor_id','room_id','at_time'}:
            raise ValueError('Public case has unexpected fields; labels must never enter inference')
    indexed = load_history(sensor_csv, {r['sensor_id'] for r in public})
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if factory is None:
        factory = lambda model: OllamaClient(base_url=ollama_url, model=model,
                                             temperature=0, timeout=180)
    previous = list(read_jsonl(output)) if resume and output.exists() else []
    by_id = {r['case_id']: r for r in previous}
    lookup = {case['case_id']: case for case in public}
    if len(by_id) != len(previous) or not set(by_id).issubset(ids) or any(
            saved.get('sensor_id') != lookup[cid]['sensor_id'] or
            saved.get('at_time') != lookup[cid]['at_time'] for cid, saved in by_id.items()):
        raise ValueError('Invalid or mismatched resumed predictions')
    if not resume:
        write_jsonl(output, [])
    new_count = 0
    for case in public:
        if case['case_id'] in by_id:
            continue
        record = infer_case(case, known[case['sensor_id']], indexed, db_path, factory)
        with output.open('a', encoding='utf8') as fh:
            fh.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n')
            fh.flush()
            os.fsync(fh.fileno())
        by_id[case['case_id']] = record
        new_count += 1
        print(f"{case['case_id']} {case['sensor_id']} {record['status']}", flush=True)
        if limit and new_count >= limit:
            break
    return {'completed_cases': len(by_id), 'scheduled_cases': len(public), 'new_cases': new_count,
            'partial_run': len(by_id) < len(public), 'output': str(output)}


def classification(records, key, field):
    """Abstentions remain in the denominator; never silently count as correct."""
    count = Counter()
    for case_id, label in key.items():
        actual = bool(label['fault_active'])
        predicted = records.get(case_id, {}).get(field)
        if type(predicted) is not bool:
            count['abstain_positive' if actual else 'abstain_negative'] += 1
        else:
            count['TP' if predicted and actual else 'FP' if predicted else 'FN' if actual else 'TN'] += 1
    tp, fp, fn, tn = (count[k] for k in ('TP', 'FP', 'FN', 'TN'))
    covered = tp + fp + fn + tn
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    accuracy = (tp + tn) / covered if covered else None
    specificity = tn / (tn + fp) if tn + fp else None
    balanced_accuracy = (recall + specificity) / 2 if tp + fn and specificity is not None else None
    positives = sum(bool(x['fault_active']) for x in key.values())
    negatives = len(key) - positives
    return {'TP': tp, 'FP': fp, 'FN': fn, 'TN': tn,
            'abstain_positive': count['abstain_positive'],
            'abstain_negative': count['abstain_negative'],
            'total': len(key), 'scored': covered, 'coverage_pct': round(100 * covered / len(key), 2) if key else None,
            'precision': round(precision, 4), 'recall_on_scored': round(recall, 4),
            'accuracy_on_scored': round(accuracy, 4) if accuracy is not None else None,
            'specificity_on_scored': round(specificity, 4) if specificity is not None else None,
            'balanced_accuracy_on_scored': round(balanced_accuracy, 4) if balanced_accuracy is not None else None,
            'f1_on_scored': round(f1, 4),
            'recall_all_positives': round(tp / positives, 4) if positives else None,
            'fpr_on_scored': round(fp / (fp + tn), 4) if fp + tn else None,
            'false_alarms_per_1000_scored_normals': round(1000 * fp / (fp + tn), 2) if fp + tn else None,
            'positives': positives, 'negatives': negatives}


def event_metrics(records, key, field):
    by_event = defaultdict(list)
    for case_id, label in key.items():
        if label.get('fault_active') and label.get('event_id'):
            by_event[label['event_id']].append((label, records.get(case_id, {}).get(field)))
    detected, delays = 0, []
    for event, cases in by_event.items():
        matched = [label for label, pred in cases if pred is True]
        if not matched:
            continue
        detected += 1
        start = cases[0][0].get('event_start')
        if start:
            first = min(parse_myt(label['at_time']) for label in matched)
            delays.append(max(0.0, (first - parse_myt(start)).total_seconds() / 60))
    return {'sampled_events': len(by_event), 'detected_events': detected,
            'sampled_event_recall': round(detected / len(by_event), 4) if by_event else None,
            'median_sampled_detection_delay_minutes': round(statistics.median(delays), 2) if delays else None,
            'note': 'Sampling-limited earliest positive case, NOT continuous event detection delay.'}


def score_cases(predictions_path, hidden_key_path, report_path):
    """The ONLY evaluation phase that reads private ground truth."""
    key = {r['case_id']: r for r in read_jsonl(hidden_key_path)}
    predictions_list = list(read_jsonl(predictions_path))
    predictions = {r['case_id']: r for r in predictions_list}
    if not key or len(predictions) != len(predictions_list) or not set(predictions).issubset(key):
        raise ValueError('Duplicate/unknown/missing ground-truth case IDs')
    columns = {'llm_raw': 'llm_raw', 'llm_validated': 'llm_scorable',
               'historical_rule': 'historical_rule',
               'validated_hybrid': 'validated_hybrid',
               'operational_triage': 'operational_triage'}
    comparison = {name: classification(predictions, key, field) for name, field in columns.items()}
    events = {name: event_metrics(predictions, key, field) for name, field in columns.items()}
    groups = defaultdict(dict)
    for case_id, truth in key.items():
        groups[(truth['sensor_type'], truth['scenario'])][case_id] = truth
    by_scenario = [{'sensor_type': kind, 'scenario': scenario,
                    'cases': len(cases),
                    'methods': {name: classification(predictions, cases, field)
                                for name, field in columns.items()}}
                   for (kind, scenario), cases in sorted(groups.items())]
    assessed = list(predictions.values())
    status_counts = Counter(p.get('status', 'missing') for p in assessed)
    latencies = [p['elapsed_seconds'] for p in assessed if isinstance(p.get('elapsed_seconds'), (int, float))]
    report = {
        'schema_version': 1, 'method': 'blind_synthetic_fault_cases',
        'status': 'evaluated' if len(predictions) == len(key) else 'partial',
        'model': 'qwen3:1.7b', 'dataset': 'simulator_injected_faults_not_physical_sensors',
        'total_cases': len(key), 'evaluated_cases': len(predictions),
        'methods': comparison, 'event_results': events, 'by_scenario': by_scenario,
        'reliability': {
            'status_counts': dict(sorted(status_counts.items())),
            'numeric_verification_pass_pct': round(100 * sum(p.get('numeric_verification_passed') is True for p in assessed) / len(assessed), 2) if assessed else None,
            'numeric_narrative_issue_cases': sum(bool(p.get('narrative_numeric_issues')) for p in assessed),
            'mean_response_seconds': round(statistics.mean(latencies), 3) if latencies else None,
            'p95_response_seconds': round(sorted(latencies)[math.ceil(.95 * len(latencies)) - 1], 3) if latencies else None},
        'interpretation': [
            'The event-balanced diagnostic sample is not real fault prevalence; precision is sample-specific.',
            'A fault_active label means simulation injection, not necessarily observable deviation.',
            'Validated hybrid abstains on review_required, insufficient_evidence and validation_failed.',
            'Operational triage treats review_required as investigate, not a confirmed fault.',
            'Event recall and delay are computed on sampled instants, not minute-by-minute monitoring.',
            'Raw model, post-validation model and rule outputs must not be confused.',
            'No physical sensors or independent real-world fault labels were tested.'
        ]}
    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf8')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare', help='Sample fault cases and create separate PRIVATE key')
    prep.add_argument('--dataset-dir', required=True)
    prep.add_argument('--public-out', default='reports/llm_anomaly_eval/cases_public.jsonl')
    prep.add_argument('--key-out', default='reports/llm_anomaly_eval/answer_key_PRIVATE.jsonl')
    prep.add_argument('--negatives', type=int, default=100)
    prep.add_argument('--positive-per-event', type=int, default=2)
    prep.add_argument('--max-events', type=int, default=100)
    prep.add_argument('--seed', type=int, default=42)
    run = sub.add_parser('run', help='Blind Qwen inference; never loads the hidden key')
    run.add_argument('--cases', default='reports/llm_anomaly_eval/cases_public.jsonl')
    run.add_argument('--readings', required=True, help='Simulator sensor_history.csv')
    run.add_argument('--db', required=True, help='Normal-only historical SQLite reference database')
    run.add_argument('--out', default='reports/llm_anomaly_eval/predictions.jsonl')
    run.add_argument('--ollama-url', default='http://127.0.0.1:11434')
    run.add_argument('--limit', type=int, default=0, help='Maximum NEW requests; 0=all')
    run.add_argument('--resume', action='store_true')
    score = sub.add_parser('score', help='Score blind predictions against separate PRIVATE key')
    score.add_argument('--predictions', default='reports/llm_anomaly_eval/predictions.jsonl')
    score.add_argument('--key', default='reports/llm_anomaly_eval/answer_key_PRIVATE.jsonl')
    score.add_argument('--out', default='reports/llm_anomaly_eval/summary.json')
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        result = prepare_cases(args.dataset_dir, args.public_out, args.key_out,
                               negatives=args.negatives, positive_per_event=args.positive_per_event,
                               max_events=args.max_events, seed=args.seed)
    elif args.command == 'run':
        if args.limit < 0:
            parser.error('--limit must be >= 0')
        result = run_cases(args.cases, args.readings, args.db, args.out,
                           ollama_url=args.ollama_url, limit=args.limit, resume=args.resume)
    else:
        result = score_cases(args.predictions, args.key, args.out)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
