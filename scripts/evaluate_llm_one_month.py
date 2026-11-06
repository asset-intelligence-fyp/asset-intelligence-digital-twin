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
import hashlib
import io
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import sys
import uuid

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



def baseline_forecasts(history, origin, target):
    """No-training baselines from observations at or before the forecast origin.

    Seasonal naive: most recent reading matching the *target* weekday and clock
    time (within 30 minutes); recent mean: available readings from last 7 days.
    The function also enforces the cutoff independently of the SQL query.
    """
    observed = []
    for row in history:
        try:
            stamp = datetime.fromisoformat(row['timestamp'])
            val = float(row['value'])
            if stamp.tzinfo is not None and stamp <= origin and math.isfinite(val):
                observed.append((stamp, val))
        except (KeyError, TypeError, ValueError):
            continue
    recent = [v for stamp, v in observed if stamp >= origin - timedelta(days=7)]
    target_clock = target.hour * 60 + target.minute
    seasonal = [(stamp, v) for stamp, v in observed
                if stamp.weekday() == target.weekday()
                and abs(stamp.hour * 60 + stamp.minute - target_clock) <= 30]
    return {
        'recent_mean': statistics.mean(recent) if recent else None,
        'seasonal_naive': max(seasonal, key=lambda item: item[0])[1] if seasonal else None,
    }


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
    baselines = baseline_forecasts(history, origin, target)
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
           'persistence_abs_error':None,
           'recent_mean_prediction':baselines['recent_mean'],
           'recent_mean_abs_error':None,
           'seasonal_naive_prediction':baselines['seasonal_naive'],
           'seasonal_naive_abs_error':None,
           'scenario_contains_actual':None}
    if actual_record is not None:
        row.update(actual_record)
        actual = actual_record['actual']
        if latest is not None:
            row['persistence_abs_error'] = abs(float(latest) - actual)
        for name in ('recent_mean', 'seasonal_naive'):
            predicted = baselines[name]
            if predicted is not None:
                row[name + '_abs_error'] = abs(predicted - actual)
    if status=='llm_projection' and row['projected_value'] is not None and actual_record is not None:
        predicted, actual = float(row['projected_value']), actual_record['actual']
        row.update(abs_error=abs(predicted-actual),squared_error=(predicted-actual)**2,
                   signed_error=predicted-actual,
                   persistence_abs_error=abs(float(latest)-actual),
                   scenario_contains_actual=(response['lower_scenario']<=actual<=response['upper_scenario']))
    return row


def rnum(number, decimals=3):
    return round(number,decimals) if number is not None and math.isfinite(number) else None


def _nearest_rank(values, percentile):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(percentile * len(ordered)) - 1)] if ordered else None


def _metrics_for(cases, year, mode):
    paired = [r for r in cases if r.get('actual') is not None]
    valid = [r for r in paired if r.get('status') == 'llm_projection'
             and r.get('abs_error') is not None]
    errors = [r['abs_error'] for r in valid]
    total_actual = sum(abs(r['actual']) for r in valid)
    mae = statistics.mean(errors) if errors else None
    rmse = math.sqrt(statistics.mean(r['squared_error'] for r in valid)) if valid else None
    bias = statistics.mean(r['signed_error'] for r in valid) if valid else None
    wape_pct = 100 * sum(errors) / total_actual if total_actual > 0 else None
    result = {
        'sensor_id': cases[0]['sensor_id'],
        'sensor_type': cases[0]['sensor_type'],
        'unit': cases[0]['unit'],
        'horizon_months': 1, 'ground_truth_year': year, 'evaluation_mode': mode,
        'planned_cases': len(cases), 'cases_with_ground_truth': len(paired),
        'ground_truth_coverage_pct': rnum(100 * len(paired) / len(cases)),
        'valid_predictions': len(valid),
        'prediction_success_pct': rnum(100 * len(valid) / len(paired)) if paired else None,
        'MAE': rnum(mae), 'RMSE': rnum(rmse), 'bias': rnum(bias),
        'median_AE': rnum(statistics.median(errors)) if errors else None,
        'p90_AE': rnum(_nearest_rank(errors, 0.9)),
        'WAPE_pct': rnum(wape_pct),
        'accuracy_score_pct': rnum(max(0, 100 - wape_pct)) if wape_pct is not None else None,
        'scenario_containment_pct_not_calibrated':
            rnum(100 * sum(r.get('scenario_contains_actual') is True for r in valid) / len(valid))
            if valid else None,
        'failures': {status: sum(r['status'] == status for r in cases)
                     for status in sorted({r['status'] for r in cases
                                           if r['status'] != 'llm_projection'})},
    }
    for label, field in (
        ('persistence', 'persistence_abs_error'),
        ('recent_mean', 'recent_mean_abs_error'),
        ('seasonal_naive', 'seasonal_naive_abs_error'),
    ):
        # Compare identical valid origins; do not penalize either method for
        # missing baseline values by comparing different subsets.
        matched = [r for r in valid if r.get(field) is not None]
        baseline_mae = statistics.mean(r[field] for r in matched) if matched else None
        paired_llm_mae = statistics.mean(r['abs_error'] for r in matched) if matched else None
        result[label + '_MAE'] = rnum(baseline_mae)
        result[label + '_matched_cases'] = len(matched)
        result['skill_vs_' + label + '_pct'] = (
            rnum(100 * (1 - paired_llm_mae / baseline_mae))
            if baseline_mae is not None and baseline_mae > 0 else None
        )
    return result


def summary_for(rows, year, mode):
    """Unit-aware sensor and target-month metrics; never pool raw error across units."""
    grouped = {}
    grouped_months = {}
    for r in rows:
        grouped.setdefault(r['sensor_id'], []).append(r)
        month = r['target_time'][:7] if r.get('target_time') else 'unknown'
        grouped_months.setdefault((r['sensor_id'], month), []).append(r)
    metrics = [_metrics_for(cases, year, mode) for _, cases in sorted(grouped.items())]
    by_month = [
        {'target_month': month, **_metrics_for(cases, year, mode)}
        for (_, month), cases in sorted(grouped_months.items())
    ]
    truth_count = sum(r.get('actual') is not None for r in rows)
    valid_count = sum(r.get('actual') is not None and
                      r.get('status') == 'llm_projection' and r.get('abs_error') is not None
                      for r in rows)
    return {
        'schema_version': 1,
        'status': 'evaluated' if valid_count else 'no_valid_predictions',
        'method': 'one_month_rolling_origin_llm_only_backtest',
        'model': 'qwen3:1.7b', 'horizon_months': 1,
        'ground_truth_year': year, 'evaluation_mode': mode,
        'metric_definition': {
            'accuracy_score_pct': 'max(0, 100 - WAPE_pct). WAPE = 100 * sum(|prediction - actual|) / sum(|actual|). Descriptive index, NOT classification accuracy.',
            'MAE': 'Mean absolute error, in sensor units.',
            'RMSE': 'Root mean squared error, in sensor units.',
            'bias': 'Mean(prediction - actual), in sensor units.',
            'median_AE': 'Median absolute error, in sensor units.',
            'p90_AE': 'Nearest-rank 90th percentile absolute error, in sensor units.',
            'skill_vs_persistence_pct': '100 * (1 - LLM_MAE/persistence_MAE) on identical valid cases. Positive is better; null if baseline MAE=0.',
            'skill_vs_recent_mean_pct': 'Same paired-case skill versus trailing seven-day observed mean.',
            'skill_vs_seasonal_naive_pct': 'Same paired-case skill versus most recent pre-cutoff reading at target weekday and clock time.',
            'prediction_success_pct': 'Valid Qwen projections divided by cases with available ground truth.',
            'ground_truth_coverage_pct': 'Cases with held-out target observations divided by scheduled cases.',
            'scenario_containment_pct_not_calibrated': 'Share of actual readings within LLM low/high scenarios; ranges are NOT calibrated intervals.'
        },
        'overall': {
            'planned_cases': len(rows), 'cases_with_ground_truth': truth_count,
            'valid_predictions': valid_count,
            'ground_truth_coverage_pct': rnum(100 * truth_count / len(rows)) if rows else None,
            'prediction_success_pct': rnum(100 * valid_count / truth_count) if truth_count else None,
            'note': 'Only counts are pooled across sensor units; errors stay per sensor.'
        },
        'summary': metrics,
        'by_target_month': by_month,
    }


def _atomic_text(path, content):
    """Replace a report/checkpoint atomically, even if its directory disappeared.

    Each write contains a complete snapshot, so recreating a deleted mirror
    restores ALL completed cases, not just the latest case. The independent
    storage journal survives cleanup of reports/llm_one_month_eval/.
    """
    path = Path(path)
    for attempt in range(3):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f'.{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp')
        try:
            with temp.open('w', encoding='utf8') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            temp.replace(path)
            return
        except FileNotFoundError:
            if attempt == 2:
                raise
        finally:
            temp.unlink(missing_ok=True)


def _checkpoint_identity(path, args, sensors, days, hours):
    """Do not reuse checkpoints for different input files or test protocols."""
    stat = path.stat()
    setting = {
        'version': 2, 'database': str(path),
        'database_size': stat.st_size, 'database_mtime_ns': stat.st_mtime_ns,
        'sensors': sensors, 'target_year': args.target_year,
        'origin_from': args.origin_from, 'origin_to': args.origin_to,
        'origin_days': days, 'origin_hours': hours,
        'mode': args.mode, 'tolerance_minutes': args.tolerance_minutes,
        'model': 'qwen3:1.7b', 'forecast_horizon_months': 1,
    }
    return hashlib.sha256(json.dumps(setting, sort_keys=True).encode('utf8')).hexdigest()[:24]


def _read_checkpoint(path, scheduled):
    rows = []
    seen = set()
    for line_number, line in enumerate(path.read_text(encoding='utf8').splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f'Invalid recovery journal line {line_number}: {exc}') from exc
        if not isinstance(row, dict):
            raise ValueError(f'Invalid recovery journal record on line {line_number}')
        key = (row.get('sensor_id'), row.get('origin'))
        if key not in scheduled or key in seen:
            raise ValueError(f'Unexpected or repeated recovery journal case on line {line_number}: {key}')
        seen.add(key)
        rows.append(row)
    return rows


def _save_progress(rows, durable_checkpoint, report_mirror):
    snapshot = ''.join(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n'
                       for row in rows)
    # Save to a separate durable path first. Output mirror is reconstructed
    # on every step if a cleanup task removes the report directory.
    _atomic_text(durable_checkpoint, snapshot)
    _atomic_text(report_mirror, snapshot)


def run(args, factory=None):
    path=Path(args.db).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f'Database not found: {path}')
    repo_registry=ROOT/'shared'/'sensorRegistry.json'
    points={p['code']:p for p in json.loads(repo_registry.read_text(encoding='utf8'))
            if p['sensorType'] in ('temperature','humidity','co2')}
    selected=(list(points) if args.sensors.strip().lower()=='all' else
              [x.strip() for x in args.sensors.split(',') if x.strip()])
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
    # Preserve the established deterministic loop order for reproducible resume.
    schedule=[
        (code, datetime(year,month,day,hour,tzinfo=MYT))
        for code in selected
        for year,month in months_between(args.origin_from,args.origin_to)
        if args.mode!='strict' or year<args.target_year
        for day in days for hour in hours
        if add_months(datetime(year,month,day,hour,tzinfo=MYT),1).year==args.target_year
    ]
    expected_cases=len(schedule)
    scheduled_keys={(code, origin.isoformat()) for code, origin in schedule}
    if expected_cases != len(scheduled_keys):
        raise ValueError('Duplicate sensor/origin entries in the evaluation schedule')
    output=Path(args.output).expanduser().resolve()
    output.mkdir(parents=True,exist_ok=True)
    if factory is None:
        factory=lambda model:OllamaClient(base_url=args.ollama_url,model=model,temperature=0,timeout=180)
    checkpoint_dir=Path(getattr(args,'checkpoint_dir',None) or
                        (ROOT/'storage'/'llm_one_month_checkpoints')).expanduser().resolve()
    checkpoint_id=_checkpoint_identity(path,args,selected,days,hours)
    durable=checkpoint_dir/f'cases_{checkpoint_id}.jsonl'
    backup=output/'cases.partial.jsonl'
    resume=bool(getattr(args,'resume',False))
    results=_read_checkpoint(durable,scheduled_keys) if resume and durable.is_file() else []
    resumed_cases=len(results)
    if resume:
        print(f'Resuming {resumed_cases} completed cases from {durable}',flush=True)
    _save_progress(results,durable,backup)
    db=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=30)
    try:
        coverage=db.execute("SELECT substr(timestamp,1,4),COUNT(DISTINCT sensor_id),COUNT(*) FROM sensor_readings WHERE dataset='normal' GROUP BY 1 ORDER BY 1").fetchall()
        print('Normal-history coverage (year, sensors, rows):', coverage,flush=True)
        completed={(row['sensor_id'],row['origin']) for row in results}
        new_cases=0
        for code,origin in schedule:
            if (code,origin.isoformat()) in completed:
                continue
            result=evaluate_case(db,points[code],origin,factory,path,args.tolerance_minutes)
            results.append(result)
            completed.add((code,origin.isoformat()))
            _save_progress(results,durable,backup)
            print(f"{code} {origin.date()}+1mo: {result['status']} predicted={result['projected_value']} actual={result['actual']}",flush=True)
            new_cases+=1
            if args.limit_cases and new_cases>=args.limit_cases:
                break
    finally:
        db.close()
    if not results:
        raise ValueError('No valid origin/target combinations. Check --origin-from, --origin-to and --target-year.')
    order={(code,origin.isoformat()):i for i,(code,origin) in enumerate(schedule)}
    results.sort(key=lambda row: order[(row['sensor_id'],row['origin'])])
    _save_progress(results,durable,backup)
    cols=list(dict.fromkeys(field for row in results for field in row))
    table=io.StringIO()
    writer=csv.DictWriter(table,fieldnames=cols)
    writer.writeheader();writer.writerows(results)
    _atomic_text(output/'cases.csv',table.getvalue())
    report=summary_for(results,args.target_year,args.mode)
    report['origin_months']=[args.origin_from,args.origin_to]
    report['origin_days']=days
    report['origin_hours']=hours
    report['configured_sensors']=selected
    report['expected_planned_cases']=expected_cases
    report['partial_run']=len(results)<expected_cases
    report['evaluation_scope']='smoke_test' if args.limit_cases else 'configured_full_period'
    report['resumed_cases']=resumed_cases
    report['checkpoint_id']=checkpoint_id
    _atomic_text(output/'summary.json',json.dumps(report,indent=2,allow_nan=False))
    _atomic_text(output/'protocol.json',json.dumps({
        'evidence_database':str(path),'dataset_year_coverage':coverage,
        'source_provenance':'offline_sqlite_backtest_normal. Existing predictor requires source=http; NOT a live HTTP reading.',
        'prediction':'production llm_service.prediction.forecast_room_reading with Qwen3 1.7B temperature=0',
        'truth':'nearest held-out normal synthetic observation within +/-'+str(args.tolerance_minutes)+' minutes of target',
        'data_cutoff':'All observations supplied to Qwen have timestamps at or before the origin; target read separately afterwards.',
        'origin_period':[args.origin_from,args.origin_to],
        'target_year':args.target_year,'mode':args.mode,'origin_days':days,'origin_hours':hours,
        'configured_sensors':selected,'expected_planned_cases':expected_cases,
        'completed_cases':len(results),'partial_run':report['partial_run'],
        'resumed_cases':resumed_cases,'checkpoint_id':checkpoint_id,
        'evaluation_scope':report['evaluation_scope'],
        'baseline_definitions':{
          'persistence':'Last pre-cutoff sensor reading',
          'recent_mean':'Mean of available pre-cutoff readings in trailing 7 days',
          'seasonal_naive':'Most recent pre-cutoff reading matching target weekday and time within 30 minutes'},
        'historical_lookback_days':1095,'http_replay_max_samples':18000,
        'synthetic_data_warning':'These values are from generated building data, not installed physical sensors.',
        'note':'Earlier observations from the target year MAY be visible in rolling mode, but NEVER target or later values. No model training occurs.'
    },indent=2),encoding='utf8')
    print('\nSummary (actual calculated metrics):')
    for metric in report['summary']:
        print(json.dumps({k:metric[k] for k in ('sensor_id','planned_cases','valid_predictions','MAE','RMSE','accuracy_score_pct','skill_vs_persistence_pct','skill_vs_seasonal_naive_pct')},ensure_ascii=False))
    if report['partial_run']:
        print('WARNING: This is a partial/smoke-test report, NOT a full-period accuracy evaluation.')
    print(f'\nFiles saved in: {output}')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--db',default=os.environ.get('LLM_HISTORY_DB','storage/digital_twin.sqlite'))
    parser.add_argument('--sensors',default='all',help='all = every supported temperature/humidity/CO2 registry sensor; or comma-separated IDs')
    parser.add_argument('--target-year',type=int,default=2025)
    parser.add_argument('--origin-from',default='2024-12')
    parser.add_argument('--origin-to',default='2025-11')
    parser.add_argument('--origin-days',default='1,8,15,22',help='Comma-separated month days, e.g. 1,8,15,22')
    parser.add_argument('--origin-hours',default='14',help='Comma-separated hours (Malaysia time), e.g. 10,14')
    parser.add_argument('--mode',choices=['rolling','strict'],default='rolling')
    parser.add_argument('--limit-cases',type=int,default=0,help='Limit NEW cases in this invocation; 0 runs all remaining cases')
    parser.add_argument('--resume',action='store_true',help='Resume previously completed cases with identical inputs and settings')
    parser.add_argument('--checkpoint-dir',default=None,help='Durable journals; default is storage/llm_one_month_checkpoints/')
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
