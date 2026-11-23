from datetime import datetime,timedelta,timezone
from src.e8b_features import make_features, qtile

def example():
    origin=datetime(2026,1,6,22,45,tzinfo=timezone.utc)
    rows=[]
    for minutes in range(0,1441,5):
        t=origin-timedelta(minutes=minutes)
        rows.append({'sensor_id':'TEMP-L03-MEET-01','timestamp':t.isoformat(),
                     'value':25.48 if minutes==0 or minutes==5 else (25.23 if minutes==180 else 25.4)})
    traj={'historical_change_reference':{'1h':{'n':12,'p10':-.15,'p90':.10},
                                         '3h':{'n':12,'p10':-.23,'p90':.07},
                                         '6h':{'n':12,'p10':-.4,'p90':.4},
                                         '24h':{'n':12,'p10':-.5,'p90':.5}}}
    return origin,rows,traj

def test_five_minute_unchanged_three_hour_rise():
    origin,rows,traj=example()
    x=make_features(sensor_id='TEMP-L03-MEET-01',origin=origin,
                    readings=rows,trajectory=traj,current=rows[0])
    assert x['changes']['5min']['delta']==0.0
    assert x['changes']['3h']['delta']==.25
    assert x['changes']['5min']['lag_minutes']==5
    assert x['changes']['3h']['lag_minutes']==180
    assert x['candidate_numeric_indicators']['historical_change_outside_band'] is True
    assert x['candidate_numeric_indicators']['unusual_five_minute_step'] is False

def test_future_data_ignored_and_current_mismatch_errors():
    origin,rows,traj=example()
    future={'sensor_id':rows[0]['sensor_id'], 'timestamp':(origin+timedelta(minutes=5)).isoformat(), 'value':1e9}
    x=make_features(sensor_id=rows[0]['sensor_id'],origin=origin,
                    readings=rows+[future],trajectory=traj)
    assert x['current_value']==25.48
    assert x['changes']['5min']['delta']==0.0
    bad=dict(rows[0]);bad['timestamp']=future['timestamp']
    import pytest
    with pytest.raises(ValueError,match='cutoff'):
        make_features(sensor_id=rows[0]['sensor_id'],origin=origin,
                      readings=rows,trajectory=traj,current=bad)

def test_missing_exact_anchor_is_not_interpolated():
    origin,rows,traj=example()
    rows=[r for r in rows if r['timestamp']!=(origin-timedelta(minutes=5)).isoformat()]
    x=make_features(sensor_id=rows[0]['sensor_id'],origin=origin,readings=rows,trajectory=traj)
    assert x['changes']['5min']['delta'] is None
    assert x['candidate_numeric_indicators']['unusual_five_minute_step'] is False

def test_quantile_reference():
    assert qtile([0,1,2,3,4],.95)==3.8
    assert qtile([],.95) is None
