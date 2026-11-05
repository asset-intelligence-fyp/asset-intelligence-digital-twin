#!/usr/bin/env python3
"""Leakage-controlled, one-month walk-forward backtest for TwinLabs Qwen3 1.7B.

One call to the EXISTING production forecast_room_reading per eligible case.
Forecast input: only normal synthetic observations timestamped <= cutoff.
Ground truth: separately retrieved AFTER the forecast, at cutoff + 1 calendar month.
The production function requires source='http'; here we REPLAY pre-cutoff SQLite
normal observations as an *offline evaluation*, not as live HTTP data.

Generates summary.json (for GET /api/assistant/evaluation), cases.csv and
protocol.json. No trained forecasting model, data mutation, or fabricated scores.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from llm_service.prediction import add_months, forecast_room_reading
from llm_service.shared_llm.ollama import OllamaClient

MYT = timezone(timedelta(hours=8))
BAD_QUALITY = {'invalid', 'bad', 'error', 'fault'}


def months_between(first: str, last: str):
    y, m = map(int, first.split('-'))
    ey, em = map(int, last.split('-'))
    while (y, m) <= (ey, em):
        yield y, m
        m += 1
        if m > 12:
            m, y = 1, y + 1


def pre_cutoff_history(db, sensor_id, cutoff, limit=18000):
    """Most recent same-sensor, normal, good-quality rows; NEVER future rows."""
    lower = (cutoff - timedelta(days=1095)).isoformat()
    rows = db.execute('''SELECT timestamp, value, quality_flag
       FROM sensor_readings
       WHERE dataset='normal' AND sensor_id=? AND timestamp<=?
         AND timestamp>=? AND value IS NOT NULL
         AND (quality_flag='ok' OR quality_flag IS NULL)
       ORDER BY timestamp DESC LIMIT ?''',
       (sensor_id, cutoff.isoformat(), lower, limit)).fetchall()
    history = []
    for stamp, val, quality in reversed(rows):
        try:
            t = datetime.fromisoformat(stamp)
            v = float(val)
            if (t.tzinfo is None or t > cutoff or not math.isfinite(v)
                or str(quality or '').lower() in BAD_QUALITY):
                continue
            history.append({'point_code':sensor_id,'timestamp':t.isoformat(),
                            'value':v,'quality':quality or 'ok'})
        except (TypeError, ValueError):
            pass
    return history


def ground_truth_at(db, sensor_id, target, tolerance_minutes=30):
    """Nearest valid observation within tolerance, queried only after prediction."""
    offset = timedelta(minutes=tolerance_minutes)
    rows = db.execute('''SELECT timestamp,value FROM sensor_readings
       WHERE dataset='normal' AND sensor_id=? AND timestamp>=? AND timestamp<=?
         AND value IS NOT NULL AND (quality_flag='ok' OR quality_flag IS NULL)''',
       (sensor_id, (target-offset).isoformat(), (target+offset).isoformat())).fetchall()
    options = []
    for stamp, val in rows:
        try:
            t, v = datetime.fromisoformat(stamp), float(val)
            if t.tzinfo is None or not math.isfinite(v):
                continue
            minutes = abs((t-target).total_seconds())/60
            if minutes <= tolerance_minutes:
                options.append((minutes, t, v))
        except (TypeError, ValueError):
            continue
    if not options:
        return None
    minutes, stamp, actual = min(options, key=lambda z:(z[0],z[1]))
    return {'actual':actual,'ground_truth_timestamp':stamp.isoformat(),
            'target_match_minutes':round(minutes,2)}


def evaluate_case(db, point, origin, factory, db_path, tolerance=30):
    """One actual Qwen request from pre-cutoff evidence, followed by truth lookup."""
    code = point['code']
    target = add_months(origin, 1)
    common = {'sensor_id':code,'sensor_type':point['sensorType'],
              'unit':point['unit'],'horizon_months':1,
              'origin':origin.isoformat(),'target_time':target.isoformat(),
              'model':'qwen3:1.7b','temperature':0,
              'evidence_source':'offline_sqlite_normal_backtest',
              'ground_truth_source':'held_out_normal_synthetic_reading'}
    history = pre_cutoff_history(db,code,origin)
    latest = history[-1]['value'] if history else None
    response = None
    if not history:
        status, reason = 'insufficient_history','No matching pre-cutoff historical observations'
    elif origin-datetime.fromisoformat(history[-1]['timestamp'])>timedelta(hours=2):
        status, reason = 'insufficient_history','The latest pre-cutoff sensor reading is stale'
    else:
        req = {'point':point,'room_id':point['simulatorRoomId'],
               'as_of':origin.isoformat(),'horizon_months':1,'source':'http',
               'history':history}
        config = {'model':'qwen3:1.7b','prompt':'concise','history_db':str(db_path)}
        try:
            response = forecast_room_reading(req,config,factory)
            status = response.get('status','runtime_error')
            reason = response.get('reason','')
        except Exception as exc:
            status, reason = 'runtime_error', f'{type(exc).__name__}: {str(exc)[:200]}'
    # Only now obtain the future observed value; it was never supplied to Qwen.
    actual_record = ground_truth_at(db,code,target,tolerance)
    row = {**common,'status':status,'reason':reason,
           'projected_value':response.get('projected_value') if response else None,
           'lower_scenario':response.get('lower_scenario') if response else None,
           'upper_scenario':response.get('upper_scenario') if response else None,
           'data_basis':response.get('data_basis') if response else None,
           'history_days':response.get('coverage',{}).get('historical_normal_days') if response else None,
           'last_observed_value':latest,
           'actual':None,'ground_truth_timestamp':None,'target_match_minutes':None,
           'abs_error':None,'squared_error':None,'signed_error':None,
           'persistence_abs_error':None,'scenario_contains_actual':None}
    if actual_record is not None:
        row.update(actual_record)
    if status=='llm_projection' and row['projected_value'] is not None and actual_record is not None:
        predicted, actual = float(row['projected_value']), actual_record['actual']
        row.update(abs_error=abs(predicted-actual),squared_error=(predicted-actual)**2,
                   signed_error=predicted-actual,
                   persistence_abs_error=abs(float(latest)-actual),
                   scenario_contains_actual=(response['lower_scenario']<=actual<=response['upper_scenario']))
    return row


def rnum(number, decimals=3):
    return round(number,decimals) if number is not None and math.isfinite(number) else None


def summary_for(rows, year, mode):
    """Compute metrics on paired, valid outcomes only; show skipped cases too."""
    grouped = {}
    for r in rows:
        grouped.setdefault(r['sensor_id'],[]).append(r)
    metrics=[]
    for sensor, cases in sorted(grouped.items()):
        paired=[r for r in cases if r.get('actual') is not None]
        valid=[r for r in paired if r.get('status')=='llm_projection' and r.get('abs_error') is not None]
        total_actual=sum(abs(r['actual']) for r in valid)
        absolute_total=sum(r['abs_error'] for r in valid)
        mae=statistics.mean(r['abs_error'] for r in valid) if valid else None
        rmse=math.sqrt(statistics.mean(r['squared_error'] for r in valid)) if valid else None
        bias=statistics.mean(r['signed_error'] for r in valid) if valid else None
        baseline=statistics.mean(r['persistence_abs_error'] for r in valid) if valid else None
        wape_pct=100*absolute_total/total_actual if total_actual>0 else None
        accuracy_pct=max(0,100-wape_pct) if wape_pct is not None else None
        skill_pct=100*(1-mae/baseline) if mae is not None and baseline is not None and baseline>0 else None
        coverage_pct=100*sum(r['scenario_contains_actual'] is True for r in valid)/len(valid) if valid else None
        metrics.append({'sensor_id':sensor,'sensor_type':cases[0]['sensor_type'],'unit':cases[0]['unit'],
            'horizon_months':1,'ground_truth_year':year,'evaluation_mode':mode,
            'planned_cases':len(cases),'cases_with_ground_truth':len(paired),
            'valid_predictions':len(valid),
            'prediction_success_pct':rnum(100*len(valid)/len(paired)) if paired else None,
            'MAE':rnum(mae),'RMSE':rnum(rmse),'bias':rnum(bias),
            'WAPE_pct':rnum(wape_pct),
            'accuracy_score_pct':rnum(accuracy_pct),
            'persistence_MAE':rnum(baseline),'skill_vs_persistence_pct':rnum(skill_pct),
            'scenario_containment_pct_not_calibrated':rnum(coverage_pct),
            'failures':{key:sum(r['status']==key for r in cases) for key in
                        sorted({r['status'] for r in cases if r['status']!='llm_projection'})}})
    return {'schema_version':1,'status':'evaluated' if any(x['valid_predictions'] for x in metrics) else 'no_valid_predictions',
            'method':'one_month_rolling_origin_llm_only_backtest',
            'model':'qwen3:1.7b','horizon_months':1,'ground_truth_year':year,
            'evaluation_mode':mode,'metric_definition':{
                'accuracy_score_pct':'max(0, 100 - WAPE_pct). WAPE = 100 * sum(|prediction - actual|) / sum(|actual|). Descriptive index, NOT classification accuracy.',
                'MAE':'Mean absolute error, in sensor units.',
                'RMSE':'Root mean squared error, in sensor units.',
                'bias':'Mean(prediction - actual), in sensor units.',
                'skill_vs_persistence_pct':'100 * (1 - LLM_MAE/persistence_MAE) on identical valid cases. Positive is better; null if baseline MAE=0.',
                'prediction_success_pct':'Valid Qwen projections divided by cases with available ground truth.',
                'scenario_containment_pct_not_calibrated':'Share of actual readings within LLM low/high scenarios; ranges are NOT calibrated intervals.'},
            'summary':metrics}


def run(args, factory=None):
    path=Path(args.db).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f'Database not found: {path}')
    repo_registry=ROOT/'shared'/'sensorRegistry.json'
    points={p['code']:p for p in json.loads(repo_registry.read_text(encoding='utf8'))
            if p['sensorType'] in ('temperature','humidity','co2')}
    selected=[x.strip() for x in args.sensors.split(',') if x.strip()]
    if not selected or any(code not in points for code in selected):
        raise ValueError('Sensors must be canonical temperature, humidity or CO2 IDs from shared/sensorRegistry.json')
    if args.target_year<2024:
        raise ValueError('Target year must have historical context (2024 or later)')
    days=sorted(set(int(x) for x in args.origin_days.split(',')))
    hours=sorted(set(int(x) for x in args.origin_hours.split(',')))
    if not days or any(not 1<=d<=28 for d in days) or not hours or any(not 0<=h<=23 for h in hours):
        raise ValueError('Use --origin-days 1-28 and --origin-hours 0-23')
    if args.limit_cases<0 or not 0<=args.tolerance_minutes<=60:
        raise ValueError('Invalid limit or tolerance')
    if args.origin_from > args.origin_to:
        raise ValueError('Origin period must be chronological')
    output=Path(args.output).expanduser().resolve()
    output.mkdir(parents=True,exist_ok=True)
    if factory is None:
        factory=lambda model:OllamaClient(base_url=args.ollama_url,model=model,temperature=0,timeout=180)
    results=[]
    backup=output/'cases.partial.jsonl'
    backup.write_text('',encoding='utf8')
    db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=30)
    try:
        coverage=db.execute("SELECT substr(timestamp,1,4),COUNT(DISTINCT sensor_id),COUNT(*) FROM sensor_readings WHERE dataset='normal' GROUP BY 1 ORDER BY 1").fetchall()
        print('Normal-history coverage (year, sensors, rows):', coverage,flush=True)
        stop=False
        for code in selected:
            for year,month in months_between(args.origin_from,args.origin_to):
                if args.mode=='strict' and year>=args.target_year:
                    continue
                for day in days:
                    for hour in hours:
                        origin=datetime(year,month,day,hour,tzinfo=MYT)
                        target=add_months(origin,1)
                        if target.year!=args.target_year:
                            continue
                        result=evaluate_case(db,points[code],origin,factory,path,args.tolerance_minutes)
                        results.append(result)
                        with backup.open('a',encoding='utf8') as f:
                            f.write(json.dumps(result,ensure_ascii=False,allow_nan=False)+'\n')
                        print(f"{code} {origin.date()}+1mo: {result['status']} predicted={result['projected_value']} actual={result['actual']}",flush=True)
                        if args.limit_cases and len(results)>=args.limit_cases:
                            stop=True;break
                    if stop:break
                if stop:break
            if stop:break
    finally:
        db.close()
    if not results:
        raise ValueError('No valid origin/target combinations. Check --origin-from, --origin-to and --target-year.')
    cols=list(dict.fromkeys(field for row in results for field in row))
    with (output/'cases.csv').open('w',encoding='utf8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=cols)
        writer.writeheader();writer.writerows(results)
    report=summary_for(results,args.target_year,args.mode)
    report['origin_months']=[args.origin_from,args.origin_to]
    report['origin_days']=days
    report['origin_hours']=hours
    (output/'summary.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf8')
    (output/'protocol.json').write_text(json.dumps({
        'evidence_database':str(path),'dataset_year_coverage':coverage,
        'source_provenance':'offline_sqlite_backtest_normal. Existing predictor requires source=http; NOT a live HTTP reading.',
        'prediction':'production llm_service.prediction.forecast_room_reading with Qwen3 1.7B temperature=0',
        'truth':'nearest held-out normal synthetic observation within +/-'+str(args.tolerance_minutes)+' minutes of target',
        'data_cutoff':'All observations supplied to Qwen have timestamps at or before the origin; target read separately afterwards.',
        'origin_period':[args.origin_from,args.origin_to],
        'target_year':args.target_year,'mode':args.mode,'origin_days':days,'origin_hours':hours,
        'historical_lookback_days':1095,'http_replay_max_samples':18000,
        'synthetic_data_warning':'These values are from generated building data, not installed physical sensors.',
        'note':'Earlier observations from the target year MAY be visible in rolling mode, but NEVER target or later values. No model training occurs.'
    },indent=2),encoding='utf8')
    print('\nSummary (actual calculated metrics):')
    for metric in report['summary']:
        print(json.dumps({k:metric[k] for k in ('sensor_id','valid_predictions','MAE','RMSE','accuracy_score_pct','skill_vs_persistence_pct')},ensure_ascii=False))
    print(f'\nFiles saved in: {output}')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--db',default=os.environ.get('LLM_HISTORY_DB','storage/digital_twin.sqlite'))
    parser.add_argument('--sensors',default='TEMP-L03-MEET-01,RH-L03-MEET-01,CO2-L03-MEET-01')
    parser.add_argument('--target-year',type=int,default=2025)
    parser.add_argument('--origin-from',default='2024-12')
    parser.add_argument('--origin-to',default='2025-11')
    parser.add_argument('--origin-days',default='15',help='Comma-separated month days, e.g. 1,8,15,22')
    parser.add_argument('--origin-hours',default='14',help='Comma-separated hours (Malaysia time), e.g. 10,14')
    parser.add_argument('--mode',choices=['rolling','strict'],default='rolling')
    parser.add_argument('--limit-cases',type=int,default=0,help='Run first N eligible cases for smoke testing')
    parser.add_argument('--tolerance-minutes',type=int,default=30)
    parser.add_argument('--ollama-url',default=os.environ.get('OLLAMA_URL','http://127.0.0.1:11434'))
    parser.add_argument('--output',default='reports/llm_one_month_eval',help='Relative to current working directory')
    args=parser.parse_args()
    try:
        report=run(args)
        return 0 if report['status']=='evaluated' else 2
    except (ValueError,sqlite3.Error) as exc:
        parser.error(str(exc))


if __name__=='__main__':
    raise SystemExit(main())
