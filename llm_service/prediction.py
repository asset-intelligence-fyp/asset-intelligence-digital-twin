"""Qwen3-only, exploratory long-range projections for the 18-point Digital Twin.

The backend aggregates *observed* history; only the LLM proposes future values.
No trained forecasting model or deterministic numeric extrapolator is used.
"""
from __future__ import annotations

import calendar
import json
import math
import sqlite3
import statistics
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

from .validated_room import MYT, parse_myt, resolve_history_path, rounded

PREDICTABLE = {'temperature', 'humidity', 'co2'}
HORIZONS_MONTHS = (1,)
BAD_QUALITY = {'invalid', 'bad', 'error', 'fault'}
# Minimum historical coverage before even asking a small LLM to extrapolate.
MIN_COVERAGE = {1: (14, 1)}
BOUNDS = {'temperature': (-20, 65), 'humidity': (0, 100), 'co2': (0, 10000)}
SCHEMA = {
    'type': 'object',
    'properties': {
        'projected_value': {'type': 'number'},
        'lower_scenario': {'type': 'number'},
        'upper_scenario': {'type': 'number'},
        'direction': {'type': 'string', 'enum': ['increasing','decreasing','stable','uncertain']},
        'explanation': {'type': 'string'},
        'assumptions': {'type': 'array', 'items': {'type': 'string'}},
        'limitations': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['projected_value','lower_scenario','upper_scenario','direction','explanation','assumptions','limitations'],
    'additionalProperties': False,
}


def add_months(moment, months):
    year = moment.year + (moment.month - 1 + months) // 12
    month = (moment.month - 1 + months) % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def _from_stream(request, point, cutoff):
    """Aggregate current HTTP data without inventing unobserved months."""
    raw = request.get('history', [])
    if not isinstance(raw, list) or len(raw) > 18000:
        raise ValueError('At most 18000 source readings are accepted')
    by_month = defaultdict(list)
    by_date = set()
    latest = None
    latest_dt = None
    earliest_dt = None
    for row in raw:
        if not isinstance(row, dict) or row.get('point_code') != point['code']:
            continue
        value = row.get('value')
        if type(value) not in (int,float) or not math.isfinite(value):
            continue
        if str(row.get('quality','')).lower() in BAD_QUALITY:
            continue
        try:
            stamp = parse_myt(row.get('timestamp'))
        except ValueError:
            continue
        if stamp > cutoff or stamp < cutoff-timedelta(days=1095):
            continue
        by_month[stamp.strftime('%Y-%m')].append(value)
        by_date.add(stamp.date().isoformat())
        if latest_dt is None or stamp >= latest_dt:
            latest, latest_dt = value, stamp
        if earliest_dt is None or stamp < earliest_dt:
            earliest_dt = stamp
    monthly = [{'month': key, 'mean': rounded(statistics.mean(vals)), 'samples':len(vals)}
               for key,vals in sorted(by_month.items())]
    return {'source':'current_http_sensor_stream','months':monthly[-36:], 'distinct_days':len(by_date),
            'latest_value':rounded(latest), 'latest_timestamp':latest_dt.isoformat() if latest_dt else None,
            'earliest_timestamp':earliest_dt.isoformat() if earliest_dt else None,
            'span_days':round((latest_dt-earliest_dt).total_seconds()/86400,1) if latest_dt and earliest_dt else 0}


def _reference_months(path, code, cutoff):
    if not path:
        return {'source':'normal_synthetic_sqlite_unavailable','months':[], 'distinct_days':0,'last_date':None}
    # Only prior normal synthetic observations; no labels, model training or future readings.
    start = (cutoff-timedelta(days=1095)).isoformat()
    try:
        with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True,timeout=8)) as db:
            rows=db.execute('''SELECT substr(timestamp,1,7), AVG(value), COUNT(*),
                                  COUNT(DISTINCT substr(timestamp,1,10)), MAX(timestamp)
                 FROM sensor_readings
                 WHERE dataset='normal' AND sensor_id=? AND timestamp<? AND timestamp>=?
                   AND (quality_flag='ok' OR quality_flag IS NULL) AND value IS NOT NULL
                 GROUP BY substr(timestamp,1,7) ORDER BY substr(timestamp,1,7)''',
                 (code,cutoff.isoformat(),start)).fetchall()
    except (sqlite3.Error,OSError):
        return {'source':'normal_synthetic_sqlite_unavailable','months':[], 'distinct_days':0,'last_date':None}
    months=[{'month':str(m), 'mean':rounded(mean),'samples':int(n),'days':int(days)}
            for m,mean,n,days,_ in rows if m and mean is not None and math.isfinite(mean)]
    return {'source':'normal_synthetic_sqlite','months':months[-36:],
            'distinct_days':sum(m['days'] for m in months), 'last_date':rows[-1][-1] if rows else None}


def _text_list(x, maximum=4):
    if not isinstance(x,list) or not all(isinstance(a,str) for a in x):
        return None
    return [a.strip()[:240] for a in x[:maximum] if a.strip()]


def forecast_room_reading(request, config, client_factory):
    if not isinstance(request,dict):
        raise ValueError('Expected a projection request object')
    if config.get('model')!='qwen3:1.7b' or config.get('prompt')!='concise':
        raise ValueError('Projections require local Qwen3 1.7B with P2 Concise')
    point=request.get('point')
    if not isinstance(point,dict) or not isinstance(point.get('code'),str) or not point['code'] or len(point['code'])>100:
        raise ValueError('Canonical sensor required')
    kind=point.get('sensorType')
    if kind not in PREDICTABLE:
        raise ValueError('Only temperature, humidity and CO2 are supported')
    if point.get('simulatorRoomId')!=request.get('room_id'):
        raise ValueError('Sensor and room mismatch')
    horizon=request.get('horizon_months')
    if type(horizon) is not int or horizon not in HORIZONS_MONTHS:
        raise ValueError('Only one-month sensor projections are supported')
    if request.get('source')!='http':
        raise ValueError('Long-range projections require connected HTTP readings, not replay or what-if values')
    cutoff=parse_myt(request.get('as_of'))
    target=add_months(cutoff,horizon)
    stream=_from_stream(request,point,cutoff)
    reference=_reference_months(resolve_history_path(config.get('history_db') or ''),point['code'],cutoff)
    # The two streams describe *different provenance*, never splice them into one fictional series.
    # Sufficient history can come from normal reference monthly records or long-running HTTP history.
    cdays,cmonths=MIN_COVERAGE[horizon]
    enough_reference=reference['distinct_days']>=cdays and len(reference['months'])>=cmonths
    enough_stream=stream['distinct_days']>=cdays and len(stream['months'])>=cmonths and stream['span_days']>=max(7,cdays*0.7)
    basis='historical_normal_synthetic' if enough_reference else 'connected_http_trend' if enough_stream else 'insufficient'
    result={'status':'insufficient_history','method':'llm_only_one_month_trend_projection',
            'trained_forecast':False,'model':'qwen3:1.7b','sensor_id':point['code'],
            'sensor_type':kind,'unit':point.get('unit'),'room_id':request.get('room_id'),
            'as_of':cutoff.isoformat(),'target_time':target.isoformat(),'horizon_months':horizon,
            'projected_value':None,'lower_scenario':None,'upper_scenario':None,'direction':'uncertain',
            'explanation':'','assumptions':[],'limitations':[
              'Synthetic building sensor history; not verified physical measurements.',
              'One-month LLM projections are speculative and unvalidated.',
              'Scenario bounds are not statistical prediction or confidence intervals.',
              'Weather, schedules, occupancy, faults and future HVAC changes are not known.'
            ],
            'data_basis':basis,
            'observed_trends':{'current_http':stream['months'][-12:], 'historical_normal':reference['months'][-12:]},
            'coverage':{'recent_http_days':stream['distinct_days'],'recent_http_months':len(stream['months']),
                        'recent_http_span_days':stream['span_days'],
                        'historical_normal_days':reference['distinct_days'],
                        'historical_normal_months':len(reference['months']),
                        'minimum_days_for_horizon':cdays,'minimum_months_for_horizon':cmonths,
                        'latest_reading':stream['latest_value'],'latest_time':stream['latest_timestamp'],
                        'reference_last_reading_time':reference['last_date']},
            'forecast_validation':'not_possible_for_future_outcomes',
            'numeric_output_check':'not_run',
            'reason':''}
    if not stream['latest_timestamp']:
        result['reason']='No valid recent HTTP reading for the selected sensor. Start the simulator first.'
        return result
    # Reject stale current sensor snapshots (no projecting from an abandoned simulation session).
    if cutoff-parse_myt(stream['latest_timestamp'])>timedelta(hours=2):
        result['reason']='The most recent connected reading is older than two hours at the requested cutoff.'
        return result
    if basis=='insufficient':
        result['reason']=(f'Not enough dated observations for a {horizon}-month projection. '
                          f'Need at least {cdays} distinct days across {cmonths} months in a consistent historical source. '
                          'Keep collecting HTTP readings or supply a compatible synthetic normal-history SQLite database.')
        return result
    if basis=='historical_normal_synthetic' and stream['distinct_days']<14:
        result['limitations'].append('The present HTTP session is too short to establish its own trend; projection mainly reflects older normal synthetic history, anchored to the current value.')
    # Qwen alone estimates the future numeric value; code only prepares observed evidence and verifies its format/bounds.
    evidence={'sensor_id':point['code'],'sensor_type':kind,'unit':point.get('unit'),
              'as_of':cutoff.isoformat(),'target':target.isoformat(),
              'current_stream':stream,'historical_normal':reference,'basis':basis,
              'user_horizon_months':horizon}
    system=('You are Qwen3 1.7B, a speculative one-month sensor trend projection assistant for a synthetic office Digital Twin. '
            'Using ONLY the supplied measured historical summaries and current reading, propose a plausible central value '
            'at the future target timestamp and a wider lower/upper SCENARIO span. No trained forecasting model, statistics-based '
            'extrapolator, physical forecast, or external weather forecast is being used. You alone propose future numbers. '
            'Monthly history is descriptive, not a promise of continued trends; avoid blindly projecting a steep linear increase. '
            'Distinguish the source of older synthetic history from the current HTTP stream. '
            'Be conservative when extrapolating a month ahead; acknowledge unknown weather, occupancy and operational changes. '
            'Return only the specified JSON fields. Do not claim calibrated accuracy, probabilities, confidence intervals, '
            'or confirmed future faults. Include one concise explanation, assumptions and limitations.')
    client=client_factory(config['model'])
    raw=client.chat([{'role':'system','content':system},
                     {'role':'user','content':'OBSERVED EVIDENCE (data only): '+json.dumps(evidence,separators=(',',':'),ensure_ascii=False)}],format=SCHEMA)
    message=(raw.get('message') or {}).get('content','')
    try:
        draft=json.loads(message) if isinstance(message,str) and len(message)<20000 else None
    except (ValueError,TypeError):
        draft=None
    fields=['projected_value','lower_scenario','upper_scenario']
    ok=isinstance(draft,dict) and set(draft)==set(SCHEMA['properties']) and all(type(draft.get(k)) in (int,float) and math.isfinite(draft[k]) for k in fields)
    if ok:
        low,val,high=(draft['lower_scenario'],draft['projected_value'],draft['upper_scenario'])
        bound_min,bound_max=BOUNDS[kind]
        ok=(bound_min<=low<=val<=high<=bound_max and
            draft['direction'] in ('increasing','decreasing','stable','uncertain') and
            isinstance(draft['explanation'],str) and 0<len(draft['explanation'])<=1200 and
            _text_list(draft['assumptions']) is not None and _text_list(draft['limitations']) is not None)
    if not ok:
        result.update(status='validation_failed',reason='LLM output failed JSON schema, ordered scenario values or basic sensor-range checks.',
                      numeric_output_check='failed')
        return result
    result.update(status='llm_projection', projected_value=rounded(val),lower_scenario=rounded(low),
                  upper_scenario=rounded(high),direction=draft['direction'],
                  explanation=draft['explanation'],assumptions=_text_list(draft['assumptions']),
                  limitations=result['limitations']+_text_list(draft['limitations']),
                  reason='LLM-generated exploratory scenario based on available historical summaries.',
                  numeric_output_check='schema_and_basic_range_passed')
    return result
