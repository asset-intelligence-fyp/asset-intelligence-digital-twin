#!/usr/bin/env python3
"""Offline final-test report: point metrics + sampled event recall and delay.

This is an EVALUATION-ONLY process: it reads private labels and the private
manifest audit; never import or call it from E7 inference or retrieval.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ALERT={'suspect','anomaly'}
GOOD={'normal','suspect','anomaly'}
POS={'1','true','t','yes','y'}
NEG={'0','false','f','no','n'}

def dt(s):
    d=datetime.fromisoformat(str(s).replace('Z','+00:00'))
    if d.tzinfo is None:raise ValueError(f'Missing timestamp timezone: {s}')
    return d.astimezone(timezone.utc)

def file_hash(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1024*1024): h.update(block)
    return h.hexdigest()

def digest(rows):
    return hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def wanted_observations(manifest):
    owner={}
    for case in manifest['cases']:
        first=dt(case['start'])
        for i in range(int(case['limit'])):
            from datetime import timedelta
            key=(case['sensor_id'],first+timedelta(minutes=5*i*int(case['stride'])))
            if key in owner:raise ValueError(f'Overlapping manifest windows: {key}')
            owner[key]=case['case_id']
    return owner

def read_truth(path, keys):
    found={}
    sensors={s for s,_ in keys}
    with path.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.DictReader(f)
        for r in reader:
            sensor=(r.get('sensor_id') or '').strip()
            if sensor not in sensors:continue
            key=(sensor,dt(r['timestamp']))
            if key not in keys:continue
            x=(r.get('fault_active') or '').lower().strip()
            if x not in POS | NEG:raise ValueError(f'Invalid label for {key}: {x}')
            if key in found:raise ValueError(f'Duplicate ground-truth label: {key}')
            found[key] = x in POS
    missing=set(keys)-set(found)
    if missing:raise ValueError(f'{len(missing)} manifest observations lack labels: {next(iter(missing))}')
    return found

def read_preds(path, keys):
    data={}
    with path.open(encoding='utf-8') as f:
        for line in f:
            if not line.strip():continue
            r=json.loads(line)
            key=(r['sensor_id'],dt(r['origin']))
            if key not in keys:raise ValueError(f'Unexpected prediction in {path}: {key}')
            if key in data:raise ValueError(f'Duplicate prediction in {path}: {key}')
            status=(r.get('answer') or {}).get('status','unclassified')
            if r.get('valid') is False: status='unclassified'
            data[key]=status
    missing=set(keys)-set(data)
    if missing:raise ValueError(f'{len(missing)} predictions missing in {path}: {next(iter(missing))}')
    return data

def summarize(preds, truth, owner, audit):
    counts=Counter()
    for k,label in truth.items():
        p=preds[k]
        if p not in GOOD:
            counts['unknown_positive' if label else 'unknown_normal']+=1
        elif label and p in ALERT:counts['tp']+=1
        elif label:counts['fn']+=1
        elif p in ALERT:counts['fp']+=1
        else:counts['tn']+=1
    tp=counts['tp'];fp=counts['fp'];tn=counts['tn'];fn=counts['fn']
    up=counts['unknown_positive'];un=counts['unknown_normal']
    def div(n,d):return round(n/d,6) if d else None
    event_total=0;event_detected=0;delays=[]
    normal_windows=0;normal_windows_with_fp=0
    by_case=defaultdict(list)
    for key,case_id in owner.items():by_case[case_id].append(key)
    for a in audit['cases']:
        case_keys=sorted(by_case[a['case_id']],key=lambda k:k[1])
        if a['selection_type']=='fault':
            event_total+=1
            positive_keys=[k for k in case_keys if truth[k]]
            if not positive_keys:raise ValueError(f"Fault case without positive label: {a['case_id']}")
            detected=[k for k in positive_keys if preds[k] in ALERT]
            if detected:
                event_detected+=1
                delays.append(round((detected[0][1]-positive_keys[0][1]).total_seconds()/60,3))
        elif a['selection_type']=='normal':
            normal_windows+=1
            if any(truth[k] for k in case_keys):raise ValueError(f"Normal case with fault label: {a['case_id']}")
            if any(preds[k] in ALERT for k in case_keys):normal_windows_with_fp+=1
        else:raise ValueError(f"Unknown audit selection type: {a['selection_type']}")
    return {
      'observations':len(truth),'tp':tp,'fp':fp,'tn':tn,'fn':fn,
      'unknown_positive':up,'unknown_normal':un,
      'classification_coverage':div(tp+fp+tn+fn,len(truth)),
      'accuracy_on_classified':div(tp+tn,tp+fp+tn+fn),
      'precision_on_classified':div(tp,tp+fp),
      'recall_end_to_end':div(tp,tp+fn+up),
      'f1_on_classified':div(2*tp,2*tp+fp+fn),
      'false_positive_rate_on_classified':div(fp,fp+tn),
      'false_alert_fraction_all_normal_points':div(fp,fp+tn+un),
      'selected_fault_events':event_total,
      'detected_fault_events_in_sampled_windows':event_detected,
      'event_recall_in_sampled_windows':div(event_detected,event_total),
      'detected_event_delay_minutes':{
          'median': sorted(delays)[len(delays)//2] if len(delays)%2 else round((sorted(delays)[len(delays)//2-1]+sorted(delays)[len(delays)//2])/2,3) if delays else None,
          'min':min(delays) if delays else None, 'max':max(delays) if delays else None,
          'count':len(delays),
      },
      'selected_normal_windows':normal_windows,
      'normal_windows_with_at_least_one_false_alert':normal_windows_with_fp,
      'normal_window_false_alert_fraction':div(normal_windows_with_fp,normal_windows),
      'event_delay_note':'Delay is relative to first fault-positive reading in sampled window; not necessarily global event onset.'
    }

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',type=Path,default=Path('evaluation/E7_frozen_manifest.json'))
    ap.add_argument('--private-audit',type=Path,default=Path('evaluation_private/E7_selection_audit.json'))
    ap.add_argument('--labels',type=Path,required=True)
    ap.add_argument('--predictions',type=Path,nargs='+',required=True)
    ap.add_argument('--out',type=Path,default=Path('results/E7_final_event_metrics.json'))
    args=ap.parse_args()
    m=json.loads(args.manifest.read_text())
    a=json.loads(args.private_audit.read_text())
    if a.get('source_labels_sha256')!=file_hash(args.labels):
        raise ValueError('The ground-truth label file differs from the frozen selection source')
    hash_expected=digest(m['cases'])
    if m['cases_sha256']!=hash_expected or a['inference_cases_sha256']!=hash_expected:
        raise ValueError('Manifest/private audit changed or do not match')
    expected={r['case_id'] for r in m['cases']}
    if {r['case_id'] for r in a['cases']}!=expected:
        raise ValueError('Private audit case IDs do not match manifest')
    owner=wanted_observations(m)
    truth=read_truth(args.labels,owner)
    report={'manifest_cases_sha256':hash_expected,
            'note':'Stratified event/window sample; accuracy and precision depend on oversampled anomaly prevalence.',
            'methods':{}}
    for path in args.predictions:
        preds=read_preds(path,owner)
        report['methods'][path.name]=summarize(preds,truth,owner,a)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    for name,results in report['methods'].items():
        print(f"{name}: coverage={results['classification_coverage']}, recall={results['recall_end_to_end']}, F1={results['f1_on_classified']}, event recall={results['event_recall_in_sampled_windows']}, normal FPR={results['false_positive_rate_on_classified']}")
    print('Wrote',args.out)
if __name__=='__main__':main()
