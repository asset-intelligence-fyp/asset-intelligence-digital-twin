#!/usr/bin/env python3
"""Paired blind evaluation of fixed retrieval versus bounded Agentic RAG.

The 'run' command NEVER opens private labels. Only 'score' reads the answer
key after inference. Both methods use identical focus sensors, cutoffs,
historical normal SQLite, Qwen3 1.7B and synthetic test cases.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from llm_service.agentic_room import analyse_agentic
from llm_service.validated_room import analyse_validated
from llm_service.shared_llm.ollama import OllamaClient
from scripts.evaluate_llm_anomalies import (
    classification, event_metrics, load_history, make_request, read_jsonl,
    registry, write_jsonl,
)


def validate_public_cases(cases):
    known = registry()
    ids = set()
    for case in cases:
        if set(case) != {'case_id', 'sensor_id', 'room_id', 'at_time'}:
            raise ValueError('Public case has unexpected fields: do not pass ground-truth labels')
        if case['case_id'] in ids:
            raise ValueError('Duplicate public case IDs')
        ids.add(case['case_id'])
        point = known.get(case['sensor_id'])
        if point is None or case['room_id'] != point['simulatorRoomId']:
            raise ValueError('Unregistered or mismatched sensor/room in public cases')
    return known


def infer(case, point, indexed, db, model_factory, method):
    started = perf_counter()
    record = {'case_id': case['case_id'], 'sensor_id': case['sensor_id'],
              'at_time': case['at_time'], 'method': method, 'status': 'runtime_error',
              'llm_raw': None, 'validated_hybrid': None,
              'operational_triage': None, 'tool_call_count': 0, 'error': None}
    try:
        # Both methods receive the same previous 24h. Fixed retrieval still
        # summarizes only the final 60m; the agent can choose longer windows.
        request = make_request(case, point, indexed, window_minutes=24 * 60)
        config = {'model': 'qwen3:1.7b', 'prompt': 'concise',
                  'validation_mode': 'hybrid_semantic', 'history_db': str(db)}
        answer = (analyse_agentic if method == 'agentic' else analyse_validated)(
            request, config, model_factory)
        status = answer['status']
        assessment = answer['decision_assessment']
        record.update(
            status=status, llm_raw=assessment.get('llm_alert_raw'),
            validated_hybrid=(True if status == 'alert' else
                              False if status == 'no_alert' else None),
            operational_triage=(status in ('alert', 'review_required')
                                if status in ('alert', 'no_alert', 'review_required') else None),
            tool_call_count=answer.get('agentic', {}).get('tool_call_count', 0),
            numeric_verification_passed=answer.get('numeric_verification_passed'),
            finding=(answer.get('result', {}).get('finding') or '')[:2000],
            tool_trace=[{'tool': t.get('tool'), 'status': t.get('status'),
                         'selection_mode': t.get('selection_mode')}
                        for t in answer.get('tool_trace', [])],
        )
    except Exception as exc:
        record['error'] = type(exc).__name__ + ': ' + str(exc)[:240]
    record['elapsed_seconds'] = round(perf_counter() - started, 3)
    return record


def run(cases_path, readings_path, db_path, out, method, *, limit=0, resume=False,
        ollama_url='http://127.0.0.1:11434', factory=None):
    cases = list(read_jsonl(cases_path))
    if not cases:
        raise ValueError('No public cases found: run the existing anomaly prepare command')
    known = validate_public_cases(cases)
    if not Path(db_path).is_file():
        raise ValueError('Normal historical SQLite reference database is missing')
    indexed = load_history(readings_path, {c['sensor_id'] for c in cases})
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    old = list(read_jsonl(out)) if resume and out.is_file() else []
    prior = {row['case_id']: row for row in old}
    lookup = {c['case_id']: c for c in cases}
    if len(prior) != len(old) or not set(prior).issubset(lookup):
        raise ValueError('Duplicate or mismatched resumed case IDs')
    if any(r.get('method') != method or
           r.get('sensor_id') != lookup[k]['sensor_id'] or
           r.get('at_time') != lookup[k]['at_time'] for k, r in prior.items()):
        raise ValueError('Resumed results do not match the selected method/test cases')
    if not resume:
        write_jsonl(out, [])
    factory = factory or (lambda model: OllamaClient(
        base_url=ollama_url, model=model, temperature=0, timeout=50 if method == 'agentic' else 150))
    added = 0
    for case in cases:
        if case['case_id'] in prior:
            continue
        result = infer(case, known[case['sensor_id']], indexed, db_path, factory, method)
        with out.open('a', encoding='utf8') as stream:
            stream.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        prior[case['case_id']] = result
        added += 1
        print(case['case_id'], method, result['status'], flush=True)
        if limit and added >= limit:
            break
    return {'status': 'partial' if len(prior) != len(cases) else 'complete',
            'method': method, 'processed': len(prior), 'scheduled': len(cases),
            'new_cases': added, 'out': str(out)}


def score(fixed_path, agentic_path, hidden_key_path, out):
    # This is the sole location in this file that opens the PRIVATE answer key.
    key_list = list(read_jsonl(hidden_key_path))
    key = {c['case_id']: c for c in key_list}
    if not key or len(key) != len(key_list):
        raise ValueError('Missing or duplicate ground-truth case IDs')
    results = {}
    for name, path in [('fixed', fixed_path), ('agentic', agentic_path)]:
        rows = list(read_jsonl(path))
        observations = {c['case_id']: c for c in rows}
        if len(observations) != len(rows) or not set(observations).issubset(key):
            raise ValueError('Duplicate or unknown case IDs in '+str(path))
        metrics = {
            label: classification(observations, key, label)
            for label in ('llm_raw', 'validated_hybrid', 'operational_triage')
        }
        events = {
            label: event_metrics(observations, key, label)
            for label in ('llm_raw', 'validated_hybrid', 'operational_triage')
        }
        latencies = [r['elapsed_seconds'] for r in rows
                     if isinstance(r.get('elapsed_seconds'), (int, float))]
        results[name] = {
            'processed_cases': len(rows),
            'methods': metrics, 'sampled_event_metrics': events,
            'runtime_errors': sum(r.get('status') == 'runtime_error' for r in rows),
            'mean_seconds': round(statistics.mean(latencies), 3) if latencies else None,
            'p95_seconds': round(sorted(latencies)[math.ceil(.95 * len(latencies)) - 1], 3)
                           if latencies else None,
            'average_tool_calls': round(statistics.mean(
                r.get('tool_call_count', 0) for r in rows), 2) if rows else None,
        }
    report = {
        'schema_version': 1,
        'status': ('complete' if all(v['processed_cases'] == len(key)
                                     for v in results.values()) else 'partial'),
        'test_cases': len(key), 'models': ['qwen3:1.7b'],
        'comparison': results,
        'note': ('Use recall_all_positives (includes missing/abstained cases) and '
                 'fpr_on_scored together; test samples are synthetic, not real fault prevalence. '
                 'Agentic mode can choose up to 24 hours of sensor history, fixed mode uses '
                 'the existing 60-minute evidence builder.'),
    }
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    command = sub.add_parser('run', help='Blind inference; never accesses answer key')
    command.add_argument('--method', choices=('fixed', 'agentic'), required=True)
    command.add_argument('--cases', default='reports/llm_anomaly_eval/cases_public.jsonl')
    command.add_argument('--readings', required=True)
    command.add_argument('--db', default='storage/digital_twin.sqlite')
    command.add_argument('--out')
    command.add_argument('--limit', type=int, default=0)
    command.add_argument('--resume', action='store_true')
    command.add_argument('--ollama-url', default='http://127.0.0.1:11434')
    evaluate = sub.add_parser('score', help='Read hidden key only after inference')
    evaluate.add_argument('--fixed', default='reports/agentic_rag_eval/fixed_predictions.jsonl')
    evaluate.add_argument('--agentic', default='reports/agentic_rag_eval/agentic_predictions.jsonl')
    evaluate.add_argument('--key', default='reports/llm_anomaly_eval/answer_key_PRIVATE.jsonl')
    evaluate.add_argument('--out', default='reports/agentic_rag_eval/summary.json')
    args = parser.parse_args()
    if args.command == 'run':
        if args.limit < 0:
            parser.error('--limit must be >= 0')
        result = run(args.cases, args.readings, args.db,
                     args.out or 'reports/agentic_rag_eval/'+args.method+'_predictions.jsonl',
                     args.method, limit=args.limit, resume=args.resume,
                     ollama_url=args.ollama_url)
    else:
        result = score(args.fixed, args.agentic, args.key, args.out)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
