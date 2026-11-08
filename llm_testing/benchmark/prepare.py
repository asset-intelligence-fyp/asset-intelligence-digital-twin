"""Build input-only time-indexed evidence. Keys read exclusively for evaluation-case sampling.
Never put target columns, event IDs, or anomaly descriptions into evidence packets.
"""
from __future__ import annotations
import argparse, bisect, collections, random, json, math
from datetime import timedelta
from pathlib import Path
from .common import *

def build_anomaly_cases(input_zip=INPUT,keys_zip=KEYS,seed=42,normal_ratio=1):
    events=list(read_csv(keys_zip,'ground_truth_events.csv'))
    sensors=list(read_csv(input_zip,'sensor_registry.csv'))
    if len(events)!=200:print(f'NOTICE: {len(events)} events, expected 200')
    by_sensor={}
    event_spans=collections.defaultdict(list)
    positive=[]
    for i,e in enumerate(sorted(events,key=lambda r:(r['start_time'],r['event_id']))):
        a,b=stamp(e['start_time']),stamp(e['end_time'])
        t=a+timedelta(minutes=5*max(1,int(((b-a).total_seconds()/60/5)*.75)))
        if t>=b:t=b-timedelta(minutes=5)
        for sid in e['affected_sensor_ids'].split(';'):
            event_spans[sid].append((a,b))
            positive.append(dict(case_id=f'A{i:03d}_{len(positive)%10}',sensor_id=sid,as_of=t.isoformat(),_answer=True,_group=e['event_id'],_type=e['scenario']))
    randomizer=random.Random(seed)
    negative=[]
    for i,p in enumerate(positive):
        original=stamp(p['as_of']); sid=p['sensor_id']
        for j in range(normal_ratio):
            candidates=[original+timedelta(days=k) for k in range(-35,36) if k!=0]
            randomizer.shuffle(candidates)
            good=next((t for t in candidates if t.year==2026 and t.month<=3 and all(not a-timedelta(hours=24)<=t<=b+timedelta(hours=1) for a,b in event_spans[sid])),None)
            if good is not None: negative.append(dict(case_id=f'N{i:03d}_{j}',sensor_id=sid,as_of=good.isoformat(),_answer=False,_group=f'normal-{i}-{j}',_type='normal'))
    allcases=positive+negative
    if len(set(c['case_id'] for c in allcases))!=len(allcases):raise ValueError('Duplicate case ids')
    return allcases

def make_packets(input_zip=INPUT,keys_zip=KEYS,output=None,seed=42,normal_ratio=1):
    out=Path(output or OUT/'prepared');out.mkdir(parents=True,exist_ok=True)
    cases=build_anomaly_cases(input_zip,keys_zip,seed,normal_ratio)
    asofs=collections.defaultdict(list)
    for case in cases:asofs[case['sensor_id']].append(stamp(case['as_of']))
    min_t=min(t for times in asofs.values() for t in times)-timedelta(hours=24)
    max_t=max(t for times in asofs.values() for t in times)
    # Load readings for selected sensors in one streaming pass; store data sorted by timestamp.
    readings=collections.defaultdict(list)
    for r in read_csv(input_zip,'sensor_history.csv'):
        sid=r['sensor_id']
        if sid not in asofs:continue
        t=stamp(r['timestamp'])
        if min_t<=t<=max_t and fnum(r['value']) is not None:
            readings[sid].append((t,round(float(r['value']),3)))
    for sid in readings:readings[sid].sort()
    features=collections.defaultdict(list)
    rooms={r['sensor_id']:r['room_id'] for r in read_csv(input_zip,'sensor_registry.csv')}
    for r in read_csv(input_zip,'training_features.csv'):
        if r['room_id'] not in set(rooms.values()):continue
        t=stamp(r['timestamp'])
        if min_t<=t<=max_t:
            features[r['room_id']].append((t,{k:r.get(k) for k in ('headcount','ac_on','ac_setpoint_c','ventilation_level','local_rain_mm_h','rain_wet','working_day','holiday','outdoor_temp_c','temperature_c','humidity_pct','co2_ppm','floor_power_kw')}))
    for room in features:features[room].sort(key=lambda x:x[0])
    metadata={r['sensor_id']:r for r in read_csv(input_zip,'sensor_registry.csv')}
    normal=collections.defaultdict(list)
    for r in read_csv(input_zip,'daily_sensor_conditions.csv'):
        if r['sensor_id'] in asofs and r['date']<'2026-01-01':normal[r['sensor_id']].append(r)
    for sid in normal:normal[sid].sort(key=lambda x:x['date'])
    # Parse timestamps only up through the evaluation origin. No future readings in packets.
    evidence=[]
    truth=[]
    for c in cases:
        sid,t=c['sensor_id'],stamp(c['as_of']);seq=readings[sid];room=rooms[sid]
        left=bisect.bisect_right(seq,(t-timedelta(hours=24),float('inf')))
        right=bisect.bisect_right(seq,(t,float('inf')))
        recent=seq[left:right]
        fseq=features.get(room,[])
        fs=[v for ft,v in fseq if t-timedelta(hours=1)<=ft<=t]
        refs=normal.get(sid,[])
        # Comparable past weekday and annual season, truncated prior to inference time.
        hist=[r for r in refs if r['date']<t.date().isoformat() and ((stamp(r['date']).weekday()==t.weekday()) or r['date'][5:7]==t.strftime('%m'))]
        hist=hist[-35:]
        # 5-minute history represented as actual time-stamped pairs, not a precomputed anomaly decision.
        def segment(hours,maxpoints):
            chosen=[(ts.isoformat(),val) for ts,val in recent if ts>=t-timedelta(hours=hours)]
            if len(chosen)>maxpoints:chosen=chosen[::max(1,math.ceil(len(chosen)/maxpoints))]
            return chosen
        payload={'case_id':c['case_id'],'sensor':metadata[sid], 'as_of':c['as_of'],
            'recent_1h':segment(1,13),'recent_6h':segment(6,73),'recent_24h':segment(24,72),
            'context_1h':fs[::max(1,len(fs)//7)] if fs else [],
            'historical_comparable_days':[{'date':r['date'],'mean':r['mean'],'p10':r['p10'],'p90':r['p90'],'min':r['min'],'max':r['max'],'mean_open_headcount':r.get('mean_open_headcount'),'local_rain_wet_fraction':r.get('local_rain_wet_fraction'),'status':r.get('status')} for r in hist]}
        # Historical daily status is from normal training history only (not current test labels).
        check_evidence(payload)
        evidence.append(payload)
        truth.append({'case_id':c['case_id'],'anomaly':c['_answer'],'fault_type':c['_type'],'group_id':c['_group'],'sensor_id':sid})
    write_jsonl(out/'anomaly_inputs.jsonl',evidence)
    write_jsonl(out/'anomaly_truth_PRIVATE.jsonl',truth)
    make_forecast_packets(input_zip,out)
    (out/'manifest.json').write_text(json.dumps({'seed':seed,'anomaly_cases':len(evidence),'positive_cases':len(positive) if (positive:= [x for x in truth if x['anomaly']]) else 0,'dataset':'v4','input_sha256':__import__('hashlib').sha256(Path(input_zip).read_bytes()).hexdigest(),'selection':'200 supplied events and matched non-event controls; event-origin stratified, NOT natural prevalence','keys_location':'anomaly_truth_PRIVATE.jsonl (DO NOT LOAD INTO MODEL)'},indent=2),encoding='utf8')
    print('Prepared',len(evidence),'anomaly cases, forecast cases in',out)

def make_forecast_packets(input_zip,out):
    daily=collections.defaultdict(list)
    for r in read_csv(input_zip,'daily_sensor_conditions.csv'):daily[r['sensor_id']].append(r)
    for s in daily:daily[s].sort(key=lambda r:r['date'])
    weekly=collections.defaultdict(list)
    for r in read_csv(input_zip,'weekly_sensor_conditions.csv'):weekly[r['sensor_id']].append(r)
    for s in weekly:weekly[s].sort(key=lambda r:r['week_start'])
    metadata={r['sensor_id']:r for r in read_csv(input_zip,'sensor_registry.csv')}
    origins=list(read_csv(input_zip,'forecast_90day_inputs.csv'))
    packets=[]
    for r in origins:
        sid=r['sensor_id'];origin=r['as_of_date']
        dr=[v for v in daily[sid] if v['date']<origin][-180:]
        wr=[v for v in weekly[sid] if (__import__('datetime').date.fromisoformat(v['week_start'])+timedelta(days=7)) <= __import__('datetime').date.fromisoformat(origin)][-52:]
        packet={'case_id':'H_'+sid+'_'+origin,'as_of_date':origin,'sensor':metadata[sid],
            'forecast_input':r,'daily_history':[{'date':x['date'],'mean':x['mean'],'p90':x['p90'],'warning_samples':x['warning_samples'],'mean_open_headcount':x.get('mean_open_headcount'),'local_rain_wet_fraction':x.get('local_rain_wet_fraction')} for x in dr[::max(1,len(dr)//90)]],
            'weekly_history':[{'week_start':x['week_start'],'mean_daily_value':x['mean_daily_value'],'mean_daily_p90':x['mean_daily_p90'],'warning_days':x['warning_days']} for x in wr]}
        check_evidence(packet);packets.append(packet)
    visible=list(read_csv(input_zip,'forecast_cases_history_VISIBLE.csv'))
    vc=collections.defaultdict(list)
    for r in visible:vc[r['case_id']].append(r)
    future=collections.defaultdict(list)
    for r in read_csv(input_zip,'forecast_cases_future_known_VISIBLE.csv'):future[r['case_id']].append(r)
    for cid,rows in sorted(vc.items()):
        if not rows:continue
        origin=rows[0]['as_of_date']
        packets.append({'case_id':cid,'as_of_date':origin,'forecast_kind':'scenario','history_visible':[v for v in rows if v['date']<origin], 'future_calendar_climatology_only':future[cid]})
    for packet in packets:check_evidence(packet)
    write_jsonl(out/'forecast_inputs.jsonl',packets)
    print('Forecast prepared:',len(origins),'historical records and',len(vc),'scenarios')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inputs',default=INPUT);p.add_argument('--keys',default=KEYS);p.add_argument('--out');p.add_argument('--seed',type=int,default=42);p.add_argument('--normal-ratio',type=int,default=1);a=p.parse_args();make_packets(a.inputs,a.keys,a.out,a.seed,a.normal_ratio)
