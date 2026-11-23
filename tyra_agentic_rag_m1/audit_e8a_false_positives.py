#!/usr/bin/env python3
"""Post-hoc E8-A false-positive audit. Standard-library only; no LLM calls.

Ground-truth labels are read for OFFLINE ANALYSIS ONLY. Never import/use this
module in src/e8a.py or any inference prompt/retriever.
"""
from __future__ import annotations
import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

ALERTS = {'anomaly', 'suspect'}
UTC = timezone.utc


def dt(value):
    out = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if out.tzinfo is None:
        raise ValueError(f'Naive timestamp refused: {value}')
    return out.astimezone(UTC)


def key(sensor, timestamp):
    return sensor, dt(timestamp).isoformat()


def read_jsonl(path):
    with Path(path).open(encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def first_n(value, count=800):
    return ' '.join(str(value or '').split())[:count]


def fnum(value):
    return round(value, 6) if isinstance(value, (int, float)) else ''


def recent_5min_change(pred):
    """Find true adjacent sample delta via cited source comparisons, if present."""
    current = pred.get('current_observation') or {}
    t = dt(pred['origin'])
    value = current.get('value')
    sensor = pred['sensor_id']
    for comp in (pred.get('validation') or {}).get('validated_comparisons', []):
        left, right = comp.get('left') or {}, comp.get('right') or {}
        if not comp.get('valid') or not left or not right:
            continue
        if left.get('sensor_id') != sensor or right.get('sensor_id') != sensor:
            continue
        if left.get('timestamp') and right.get('timestamp'):
            if dt(left['timestamp']) == t and dt(right['timestamp']) == t - timedelta(minutes=5):
                if value is not None and right.get('value') is not None:
                    return fnum(value - right['value']), right['value'], right['timestamp']
    return '', '', ''


def historical_context(pred):
    ref = (pred.get('trajectory') or {}).get('historical_change_reference') or {}
    summary = {}
    for horizon in ('1h', '3h', '6h', '24h'):
        stats = ref.get(horizon) or {}
        d, p10, p90 = (stats.get('current_delta'), stats.get('p10'), stats.get('p90'))
        within = ''
        if all(isinstance(v, (int, float)) for v in (d,p10,p90)):
            within = p10 <= d <= p90
        summary[horizon] = {'delta': fnum(d), 'p10': fnum(p10), 'p90': fnum(p90),
                            'within_p10_p90': within}
    return summary


def lexical_flags(text):
    s = text.lower()
    return {
        'mentions_normal_or_no_fault': bool(re.search(
            r'\bwithin (?:the |a )?(?:normal|historical|expected)|\bno (?:clear |specific |immediate |significant )?(?:evidence|fault|anomaly|cause)|\bconsistent with (?:the |a )?(?:normal|historical|expected)', s)),
        'mentions_trend_or_change': bool(re.search(
            r'\b(?:rise|rising|increas\w*|fall|fell|decreas\w*|drop\w*|drift|gradual|trend|persistent)\b',s)),
        'asserts_five_minute_change': bool(re.search(r'\b(?:within|over (?:a )?span of|in) (?:just )?5 minutes\b',s)),
        'mentions_sensor_fault': bool(re.search(r'\bfault\b|\bmalfunction\b|\bfailed\b',s)),
    }


def make_rows(preds, truth):
    result=[]
    for r in preds:
        k=key(r['sensor_id'],r['origin'])
        if k not in truth:
            raise ValueError(f'Missing ground truth: {k}')
        label=truth[k]
        verified=r.get('verified_status') or 'unknown'
        if label != 'normal' or verified not in ALERTS:
            continue
        delta5,prev5,prevts=recent_5min_change(r)
        context=historical_context(r)
        reason=first_n((r.get('verification') or {}).get('explanation'),1600)
        screen_reason=first_n((r.get('screening') or {}).get('explanation'),1600)
        flags=lexical_flags(reason)
        tools=[x.get('tool') for x in r.get('trace',[]) if x.get('tool')]
        row={
            'sensor_id':r['sensor_id'], 'sensor_type_prefix':r['sensor_id'].split('-')[0],
            'origin_utc':dt(r['origin']).isoformat(),
            'origin_malaysia':dt(r['origin']).astimezone(timezone(timedelta(hours=8))).isoformat(),
            'ground_truth':'normal', 'screening_status':r.get('screening_status',''),
            'verified_status':verified, 'evidence_status':r.get('evidence_status',''),
            'current_value':(r.get('current_observation') or {}).get('value',''),
            'value_5min_before':prev5, 'change_5min':delta5,
            'time_5min_before':prevts,
            'optional_retrieval_used': any(t not in ('trajectory',) for t in tools),
            'retrieval_tools':'|'.join(tools),
            'repair_attempted': bool((r.get('review_audit') or {}).get('repair_attempted')),
            'evidence_ids':'|'.join((r.get('verification') or {}).get('evidence_ids') or []),
            'comparison_count':len((r.get('verification') or {}).get('comparisons') or []),
            'verification_explanation':reason, 'screening_explanation':screen_reason,
            'explanation_similar_to_screening': reason == screen_reason or (reason in screen_reason or screen_reason in reason),
            **flags,
        }
        for h,stats in context.items():
            for k2,v2 in stats.items():row[f'{h}_{k2}']=v2
        result.append(row)
    return result


def nearby_positive(row, positive_times, minutes=15):
    t=dt(row['origin_utc'])
    return any(abs((t-other).total_seconds()) <= minutes*60 for other in positive_times.get(row['sensor_id'],[]))


def write_csv(path,rows):
    if not rows:return
    with Path(path).open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]),extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)


def examples_by_sensor(rows, n=18):
    selected=[]
    seen=set()
    for r in rows:
        kind=r['sensor_type_prefix']
        # Prefer distinct types and 'screening unknown -> alert' cases first.
        tag=(kind,r['screening_status'])
        if tag not in seen:
            seen.add(tag);selected.append(r)
        if len(selected)>=n:return selected
    for r in rows:
        if r not in selected:selected.append(r)
        if len(selected)>=n:break
    return selected


def write_review_guide(path,rows, summary):
    lines=[
        '# E8-A false-positive reasoning audit (offline)',
        '',
        'This review uses hidden labels **after** inference. Never feed labels to the LLM.',
        'The LLM explanations are generated justifications, not a verified record of hidden internal reasoning.',
        'A grounded arithmetic comparison proves only an observed relationship, not an equipment fault.',
        '',
        '## Counts',
        f"- Total evaluated: {summary['total_predictions']}",
        f"- False positives: {summary['false_positives']}",
        f"- Screening unknown → verified alert: {summary['screening_unknown_to_alert_false_positives']}",
        f"- No optional retrieval: {summary['false_positives_without_optional_retrieval']}",
        f"- Grounded evidence: {summary['false_positives_with_grounded_evidence']}",
        f"- Same/substring screening-review explanation (heuristic): {summary['explanation_overlap_flag_count']}",
        '',
        '## Audit rubric',
        '',
        '| Manual category | Question |',
        '|---|---|',
        '| Incorrect elapsed-time claim | Did it call a 3-hour difference a 5-minute jump? |',
        '| Small change overinterpreted | Is the claimed fault based on a minor or normal range of changes? |',
        '| Unsupported normal-range claim | Was a normal range named but not shown in evidence? |',
        '| Conflicting explanation/status | Does text say normal/no clear fault but status is suspect or anomaly? |',
        '| Missing building context | Would as-of occupancy, HVAC, rain, outdoor humidity, or schedule change interpretation? |',
        '| Fault boundary / recovery | Does a former fault reading persist even though the label turns normal? |',
        '| Ground-truth definition | Is this label strictly injected fault_active, while the reading remains unusual? |',
        '| Insufficient evidence | Is the fault conclusion stronger than the available comparisons? |',
        '| Other / undetermined | No justified root cause without more data |',
        '',
        'The pattern flags below are **screening aids**, not confirmed root causes.',
        '',
        '## First representative examples',
    ]
    for i,r in enumerate(examples_by_sensor(rows),1):
        lines += [
            '',f"### {i}. {r['sensor_id']} — {r['origin_malaysia']}",
            f"- Screening → verified: `{r['screening_status']}` → `{r['verified_status']}`",
            f"- Current: `{r['current_value']}`; preceding 5-minute change: `{r['change_5min']}`",
            f"- Retrieval: `{r['retrieval_tools']}`; evidence: `{r['evidence_status']}`",
            f"- 1h delta/reference p10–p90: `{r['1h_delta']}` / `{r['1h_p10']}`–`{r['1h_p90']}`",
            f"- Reviewer explanation: {r['verification_explanation']}",
            '- Manual root cause: __________',
        ]
    Path(path).write_text('\n'.join(lines)+'\n',encoding='utf-8')


def run(args):
    preds=read_jsonl(args.predictions)
    metrics=json.loads(Path(args.metrics).read_text(encoding='utf-8'))
    methods=metrics.get('methods') or {}
    preferred='e8a_final_all_verified.jsonl'
    if preferred not in methods:
        options=[v for k,v in methods.items() if 'e8a' in k.lower() and 'verified' in k.lower()]
        if len(options)!=1:raise ValueError('Could not identify E8-A verified metrics')
        report=options[0]
    else:report=methods[preferred]
    reference=report['predictions']
    truth={key(m['sensor_id'],m['timestamp_utc']):m['label'] for m in reference}
    if len(truth)!=len(reference) or len(preds)!=len(reference):
        raise ValueError(f'Mismatch: {len(preds)} raw records, {len(reference)} labels, {len(truth)} distinct keys')
    if len({key(p['sensor_id'],p['origin']) for p in preds})!=len(preds):
        raise ValueError('Duplicate raw prediction keys')
    if any(not r.get('valid') for r in preds):
        raise ValueError('Some predictions are invalid; review batch errors first')
    rows=make_rows(preds,truth)
    positive_times=defaultdict(list)
    for (sensor,t),label in truth.items():
        if label=='anomaly':positive_times[sensor].append(dt(t))
    for r in rows:
        r['within_15min_of_sampled_fault_label']=nearby_positive(r,positive_times)
        r['manual_root_cause']=''
        r['manual_evidence_sufficient']=''
        r['manual_operational_context_needed']=''
        r['manual_notes']=''
    if len(rows)!=report['fp']:
        raise ValueError(f'Computed {len(rows)} false positives; metrics report {report["fp"]}')
    summary={
        'total_predictions':len(preds), 'false_positives':len(rows),
        'ground_truth_join':'sensor_id + UTC timestamp, all matched',
        'sensor_prefix_counts':dict(Counter(r['sensor_type_prefix'] for r in rows)),
        'sensor_id_counts':dict(Counter(r['sensor_id'] for r in rows)),
        'verified_alert_types':dict(Counter(r['verified_status'] for r in rows)),
        'screening_statuses_for_false_positives':dict(Counter(r['screening_status'] for r in rows)),
        'false_positives_without_optional_retrieval':sum(not r['optional_retrieval_used'] for r in rows),
        'screening_unknown_to_alert_false_positives':sum(r['screening_status']=='unknown' for r in rows),
        'false_positives_with_grounded_evidence':sum(r['evidence_status']=='grounded' for r in rows),
        'explanation_overlap_flag_count':sum(r['explanation_similar_to_screening'] for r in rows),
        'normal_or_no_fault_wording_flag_count':sum(r['mentions_normal_or_no_fault'] for r in rows),
        'five_minute_claim_flag_count':sum(r['asserts_five_minute_change'] for r in rows),
        'near_sampled_fault_label_within_15min':sum(r['within_15min_of_sampled_fault_label'] for r in rows),
        'reference_percentile_band_counts':{h:{str(v):sum(r[f'{h}_within_p10_p90'] is v for r in rows) for v in [True,False]} for h in ('1h','3h','6h','24h')},
        'interpretation':'Heuristic flags and correlations; do not treat them as confirmed causes. Metrics based on stratified sample.',
    }
    out=Path(args.out_dir);out.mkdir(parents=True,exist_ok=True)
    write_csv(out/'all_213_false_positives.csv',rows)
    sample=examples_by_sensor(rows,n=args.review_limit)
    write_csv(out/'manual_review_sample.csv',sample)
    (out/'audit_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    write_review_guide(out/'reasoning_review_guide.md',rows,summary)
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    print('Saved to',out)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--predictions',type=Path,required=True)
    p.add_argument('--metrics',type=Path,required=True)
    p.add_argument('--out-dir',type=Path,default=Path('results/e8a_fp_audit'))
    p.add_argument('--review-limit',type=int,default=18)
    run(p.parse_args())

if __name__=='__main__':main()
