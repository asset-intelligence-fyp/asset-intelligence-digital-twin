"""Independent evaluation. This module may read the secret ground-truth CSV.

Do NOT import ground_truth in retrieval.py or workflow.py.
"""
from __future__ import annotations
import csv
import json
import math
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
import numpy as np
from .db import valid_timestamp, exact_value, stamp


def read_jsonl(path):
    with open(path,encoding='utf-8') as f:
        return [json.loads(s) for s in f if s.strip()]


def read_events(path):
    with open(path,newline='') as f:
        rows=list(csv.DictReader(f))
    for r in rows:
        r['start']=valid_timestamp(r['start_timestamp'])
        r['end']=valid_timestamp(r['end_timestamp'])
    return rows


def evaluate_detection(results_path, ground_truth_path, alert_suspect=True):
    rows=[r for r in read_jsonl(results_path) if r['task']=='detect']
    if not rows:raise ValueError('No detection rows')
    all_events=read_events(ground_truth_path)
    coverage_ranges={}
    for sensor in set(r['sensor_id'] for r in rows):
        ts=[valid_timestamp(r['origin']) for r in rows if r['sensor_id']==sensor]
        coverage_ranges[sensor]=(min(ts),max(ts))
    # Point labels may include partial events, but event recall requires full coverage.
    events=[e for e in all_events if e['sensor_id'] in coverage_ranges
            and coverage_ranges[e['sensor_id']][0] <= e['start']
            and e['end'] <= coverage_ranges[e['sensor_id']][1]]
    valid_status={'normal','suspect','anomaly'}
    tp=fp=tn=fn=unknown_pos=unknown_neg=0
    per_sensor=defaultdict(list)
    for r in rows:
        sensor=r['sensor_id']; t=valid_timestamp(r['origin'])
        actual=int(any(e['sensor_id']==sensor and e['start']<=t<=e['end'] for e in all_events))
        status=r.get('answer',{}).get('status') if r.get('valid') else None
        if status not in valid_status:
            unknown_pos+=actual;unknown_neg+=(1-actual)
            continue
        predicted=int(status=='anomaly' or (alert_suspect and status=='suspect'))
        if actual and predicted:tp+=1
        elif actual:fn+=1
        elif predicted:fp+=1
        else:tn+=1
        per_sensor[sensor].append((t,predicted))
    valid=tp+fp+tn+fn
    coverage=valid/len(rows)
    precision=tp/(tp+fp) if (tp+fp) else 0.0
    recall=tp/(tp+fn) if (tp+fn) else None
    e2e_recall=tp/(tp+fn+unknown_pos) if (tp+fn+unknown_pos) else None
    fpr=fp/(fp+tn) if (fp+tn) else None
    f1=2*precision*recall/(precision+recall) if recall is not None and precision+recall else 0.0
    # Alert-episode construction uses only consecutive positive 5-minute observations.
    alert_episodes=[]
    for sensor, observations in per_sensor.items():
        observations.sort(key=lambda x:x[0])
        current=None
        for t, y in observations:
            if y==1:
                if current is not None and t-current['end']==timedelta(minutes=5):
                    current['end']=t
                else:
                    current={'sensor_id':sensor,'start':t,'end':t}
                    alert_episodes.append(current)
            else:
                current=None
    # Greedy one-to-one matching by earliest alert start.
    matched_event_ids=set()
    matched_alert_ids=set()
    delays=[]
    for ai,a in enumerate(alert_episodes):
        candidates=[(ei,e) for ei,e in enumerate(events)
                    if ei not in matched_event_ids and e['sensor_id']==a['sensor_id']
                    and a['start']<=e['end'] and a['end']>=e['start']]
        if not candidates:continue
        ei,e=min(candidates,key=lambda x:x[1]['start'])
        matched_event_ids.add(ei)
        matched_alert_ids.add(ai)
        delays.append(max(0,(max(a['start'],e['start'])-e['start']).total_seconds()/60))
    complete_cadence=True
    for sensor in coverage_ranges:
        times=sorted(valid_timestamp(r['origin']) for r in rows if r['sensor_id']==sensor)
        if any(b-a!=timedelta(minutes=5) for a,b in zip(times,times[1:])):
            complete_cadence=False
    false_episode_count=len(alert_episodes)-len(matched_alert_ids)
    alerts_per_sensor_day=(false_episode_count/(len(rows)/288)) if complete_cadence else None
    return {
        'evaluated_points':len(rows),'valid_points':valid,'coverage':coverage,
        'tp':tp,'fp':fp,'tn':tn,'fn':fn,'unknown_positive':unknown_pos,
        'unknown_normal':unknown_neg,'accuracy_valid':(tp+tn)/valid if valid else None,
        'precision_valid':precision,'recall_valid':recall,'f1_valid':f1,
        'false_positive_rate_valid':fpr,'recall_end_to_end':e2e_recall,
        'event_recall':len(matched_event_ids)/len(events) if events else None,
        'event_total':len(events),'event_detected':len(matched_event_ids),
        'mean_detection_delay_minutes':float(np.mean(delays)) if delays else None,
        'false_alert_episodes':false_episode_count,
        'false_alert_episodes_per_sensor_day':alerts_per_sensor_day,
        'important_caveat':'Events are counted only when their full interval lies inside the evaluated range; event metrics also require every 5-minute point to be evaluated.'
    }


def evaluate_forecast(results_path, db_path=None):
    rows=[r for r in read_jsonl(results_path) if r['task']=='forecast']
    if not rows:raise ValueError('No forecast rows')
    grouped=defaultdict(lambda:{'errors':[],'naive_errors':[],'valid':0,'total':0})
    for row in rows:
        sensor=row['sensor_id']; origin=valid_timestamp(row['origin']);
        h=row['horizon']; vals=row.get('answer',{}).get('values',[]) if row.get('valid') else []
        for i in range(1,h+1):
            g=grouped[(sensor,i)]
            actual=exact_value(sensor,origin+timedelta(minutes=5*i),db_path)
            if actual is None:continue
            g['total']+=1
            val=vals[i-1] if len(vals)==h else None
            if val is not None and math.isfinite(float(val)):
                g['errors'].append(float(actual)-float(val))
                g['valid']+=1
            persistence=exact_value(sensor,origin,db_path)
            if persistence is not None:
                g['naive_errors'].append(float(actual)-float(persistence))
    results=[]
    for (sensor,i), g in sorted(grouped.items()):
        err=np.array(g['errors'])
        baseline=np.array(g['naive_errors'])
        results.append({
          'sensor_id':sensor,'horizon_step':i,'horizon_minutes':i*5,
          'eligible_predictions':g['total'],'valid_predictions':g['valid'],
          'forecast_output_coverage':g['valid']/g['total'] if g['total'] else None,
          'mae':float(np.mean(np.abs(err))) if len(err) else None,
          'rmse':float(np.sqrt(np.mean(err**2))) if len(err) else None,
          'persistence_mae':float(np.mean(np.abs(baseline))) if len(baseline) else None,
          'skill_vs_persistence':(1-float(np.mean(np.abs(err)))/float(np.mean(np.abs(baseline))))
             if len(err) and len(baseline) and np.mean(np.abs(baseline))>0 else None
        })
    return results
