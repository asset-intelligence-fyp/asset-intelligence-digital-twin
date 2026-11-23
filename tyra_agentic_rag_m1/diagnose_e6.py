#!/usr/bin/env python3
"""Read-only diagnostics for TYRA E6 JSONL anomaly predictions.

Labels are read only from the independent evaluation report; this script does
not call an LLM, modify model answers, or perform retrieval.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def utc_key(s: str) -> str:
    dt = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError(f'Timestamp missing timezone: {s}')
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def myt_time(s: str) -> str:
    from datetime import timedelta
    dt = datetime.fromisoformat(utc_key(s).replace('Z', '+00:00'))
    return (dt + timedelta(hours=8)).strftime('%m-%d %H:%M')


def main() -> None:
    p = argparse.ArgumentParser(description='Diagnose E6 results without using labels in inference')
    p.add_argument('--predictions', required=True)
    p.add_argument('--evaluation', required=True)
    p.add_argument('--out', default='results/E6_diagnostic_breakdown.csv')
    args = p.parse_args()
    pred_path = Path(args.predictions)
    eva = json.loads(Path(args.evaluation).read_text(encoding='utf-8'))
    methods = eva['methods']
    method = methods.get(pred_path.name)
    if method is None:
        if len(methods) == 1:
            method = next(iter(methods.values()))
        else:
            raise SystemExit(f'No results for {pred_path.name}; found: {list(methods)}')
    truth = { (r['sensor_id'], utc_key(r['timestamp_utc'])): r
             for r in method.get('predictions', [])}
    rows=[]
    for line in pred_path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        answer = rec.get('answer') or {}
        v = rec.get('validation') or {}
        ref = (rec.get('retrieved_reference') or {})
        summ = ref.get('reference_summary') or {}
        trend = ref.get('recent_trend') or {}
        target = ref.get('current') or {}
        key = (rec.get('sensor_id'), utc_key(rec['origin']))
        gt = truth.get(key, {})
        rows.append({
            'myt': myt_time(rec['origin']),
            'origin_utc': utc_key(rec['origin']),
            'label': gt.get('label', 'NOT_MATCHED'),
            'status': answer.get('status', 'FAILED'),
            'first_pass_status': v.get('original_first_pass_status', ''),
            'evidence_recheck': v.get('evidence_recheck_performed', False),
            'guard_abstained': v.get('evidence_guard_abstained', False),
            'current_value': target.get('value', ''),
            'reference_median': summ.get('median', ''),
            'current_minus_median': summ.get('current_minus_median', ''),
            'ref_n': summ.get('n', ''),
            'delta_1h': trend.get('delta_1h', ''),
            'delta_3h': trend.get('delta_3h', ''),
            'evidence_timestamps': ' | '.join(map(str, answer.get('evidence_timestamps', []))),
            'tools': ' > '.join(x.get('tool','?') for x in rec.get('trace',[])),
            'llm_calls': rec.get('llm_calls',''),
            'explanation': answer.get('explanation',''),
        })
    if not rows:
        raise SystemExit('No predictions found')
    print('MYT          LABEL     FINAL     FIRST     GUARD  RECHECK  CURRENT  ΔvsREF  Δ1h  Δ3h  TOOLS')
    print('-'*112)
    for r in rows:
        def fmt(x):
            return '-' if x == '' or x is None else str(x)
        print(f"{r['myt']:<12} {r['label']:<9} {r['status']:<9} "
              f"{fmt(r['first_pass_status']):<9} {str(bool(r['guard_abstained'])):<6} "
              f"{str(bool(r['evidence_recheck'])):<7} {fmt(r['current_value']):<8} "
              f"{fmt(r['current_minus_median']):<7} {fmt(r['delta_1h']):<5} "
              f"{fmt(r['delta_3h']):<5} {r['tools']}")
    status = Counter(r['status'] for r in rows)
    unknowns=[r for r in rows if r['status']=='unknown']
    print('\nStatus counts:', dict(status))
    print('Unknowns from evidence guard:', sum(bool(r['guard_abstained']) for r in unknowns))
    print('Unknowns without evidence-guard abstention:', sum(not r['guard_abstained'] for r in unknowns))
    print('First-pass positive -> final unknown:', sum(r['first_pass_status'] in ('suspect','anomaly') and r['status']=='unknown' for r in rows))
    print('\nUnknown explanations:')
    for r in unknowns:
        print(f"  {r['myt']} (truth={r['label']}, first={r['first_pass_status']}, guard={r['guard_abstained']}): {r['explanation'][:260]}")
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('w', newline='', encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    print(f'\nSaved {len(rows)} diagnostic rows to {out}')


if __name__=='__main__':
    main()
