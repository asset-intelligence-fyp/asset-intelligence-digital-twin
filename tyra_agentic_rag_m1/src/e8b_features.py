"""Causal, label-free sensor features for E8-B.

E8-B never uses test labels and never interprets 'inside p10/p90' as
proof of normality. Features describe current readings and past context.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from statistics import median
import math
from typing import Any

HORIZONS = (5, 60, 180, 360, 1440)


def utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt=value
    else:
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if dt.tzinfo is None:
        # Project DB emits naive UTC timestamps, while source CSV context is
        # handled separately by e8b_context.py (defaults Asia/Kuching).
        dt=dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def qtile(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    vals=sorted(xs)
    p=(len(vals)-1)*q
    a=int(math.floor(p)); b=int(math.ceil(p))
    return vals[a]+(vals[b]-vals[a])*(p-a)


def near(a: float,b: float) -> bool:
    return math.isclose(a,b,rel_tol=1e-8,abs_tol=1e-6)


def make_features(*, sensor_id: str, origin: Any, readings: list[dict],
                  trajectory: dict | None, current: dict | None = None) -> dict:
    cutoff=utc(origin)
    by_time={}
    for x in readings:
        if str(x.get('sensor_id',sensor_id)) != sensor_id:continue
        try:
            stamp=utc(x['timestamp'])
            value=float(x['value'])
        except (KeyError,TypeError,ValueError,OverflowError):
            continue
        if not math.isfinite(value) or stamp > cutoff:
            continue
        by_time[stamp]=value
    if current is not None:
        curtime=utc(current['timestamp']); curval=float(current['value'])
        if curtime != cutoff or str(current.get('sensor_id')) != sensor_id:
            raise ValueError('Current evidence differs from sensor/cutoff')
        if curtime in by_time and not near(curval,by_time[curtime]):
            raise ValueError('Conflicting current readings')
        by_time[curtime]=curval
    if cutoff not in by_time:
        raise ValueError(f'No actual current sensor reading for {sensor_id} at {cutoff}')

    val=by_time[cutoff]
    change={}
    ref=(trajectory or {}).get('historical_change_reference') or {}
    for minutes in HORIZONS:
        key='5min' if minutes==5 else f'{minutes//60}h'
        stamp=cutoff-timedelta(minutes=minutes)
        previous=by_time.get(stamp)
        item={'lag_minutes':minutes,'current_time_utc':cutoff.isoformat(),
              'previous_time_utc':stamp.isoformat(),
              'previous_value':previous,'delta':None,
              'rate_per_hour':None, 'reference':None,'outside_reference_band':None}
        if previous is not None:
            delta=val-previous
            item['delta']=round(delta,6)
            item['rate_per_hour']=round(delta*60/minutes,6)
        historical=ref.get(key)
        if key!='5min' and isinstance(historical,dict):
            try:
                n=int(historical.get('n',0)); lo=float(historical['p10']);hi=float(historical['p90'])
            except (TypeError,ValueError,KeyError):
                pass
            else:
                if n>=8 and math.isfinite(lo) and math.isfinite(hi) and lo <= hi:
                    item['reference']={'n':n,'p10':lo,'p90':hi,
                                       'method':'unconditioned historical change reference'}
                    if item['delta'] is not None:
                        item['outside_reference_band']=bool(item['delta'] < lo or item['delta'] > hi)
        change[key]=item

    # 5-minute step comparison against only earlier completed 5-minute steps;
    # do not include the target change in its own reference distribution.
    past_times=sorted(t for t in by_time if t < cutoff and t >= cutoff-timedelta(hours=24))
    old_deltas=[]
    for t in past_times:
        prev=by_time.get(t-timedelta(minutes=5))
        if prev is not None:
            old_deltas.append(abs(by_time[t]-prev))
    p95=qtile(old_deltas,.95) if len(old_deltas)>=24 else None
    current_delta=change['5min']['delta']
    large_step=(p95 is not None and current_delta is not None
                and abs(current_delta)>p95 and not near(abs(current_delta),p95))
    outside=[k for k in ('1h','3h','6h','24h') if change[k]['outside_reference_band'] is True]
    sign=[1 if change[k]['delta']>0 else -1 if change[k]['delta']<0 else 0
          for k in outside]
    persistent_shift=len(outside)>=2 and (all(x>0 for x in sign) or all(x<0 for x in sign))

    # These are numerical candidate indicators, NOT anomaly decisions.
    candidates={
       'historical_change_outside_band':bool(outside),
       'persistent_outside_band_same_direction':bool(persistent_shift),
       'unusual_five_minute_step':bool(large_step),
    }
    return {'sensor_id':sensor_id,'as_of_utc':cutoff.isoformat(),
            'current_value':round(val,6),'sensor_prefix':sensor_id.split('-')[0],
            'changes':change,'five_minute_p95_abs_reference':p95,
            'five_minute_reference_n':len(old_deltas),
            'outside_horizon_names':outside,
            'candidate_numeric_indicators':candidates,
            'warnings':['Historical p10-p90 bands are descriptive and may include faults, seasonality, and different operating contexts.',
                        'Numerical indicators alone do not prove a sensor malfunction.',
                        'An unchanged five-minute reading may still be faulty if stuck or biased.']}
