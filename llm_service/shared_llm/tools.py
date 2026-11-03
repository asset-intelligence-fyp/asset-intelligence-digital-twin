"""Read-only, bounded data-retrieval tools. LLM never receives raw SQL or fault labels."""
from __future__ import annotations
from datetime import datetime, timedelta
import json
import math
import re
import sqlite3
import statistics
from .db import connect

ID = re.compile(r'^[A-Za-z0-9_:\-]{1,90}$')
MIN_DELTA = {'temperature':1.5,'co2':175.,'humidity':10.,'light':100.,'power':1.0}

def iso(value: str) -> datetime:
    try: d=datetime.fromisoformat(value)
    except (TypeError,ValueError) as e: raise ValueError(f'Invalid ISO timestamp: {value!r}') from e
    if d.tzinfo is None or d.utcoffset()!=timedelta(hours=8):
        raise ValueError('Timestamp must be in Asia/Kuching with +08:00 offset')
    return d

def ident(value: str) -> str:
    if not isinstance(value,str) or not ID.fullmatch(value):
        raise ValueError('Invalid sensor/room identifier')
    return value

def safe_row(row): return dict(row) if row else None

def tool(name,description,properties,required):
    return {'type':'function','function':{'name':name,'description':description,
        'parameters':{'type':'object','properties':properties,'required':required,'additionalProperties':False}}}

def s(description): return {'type':'string','description':description}

TOOL_SPECS = [
 tool('list_rooms','List configured room IDs and known sensor IDs. Use before guessing identifiers.',{},[]),
 tool('get_sensor_history','Get up to 120 recent measured sensor readings in a requested time window (maximum 48 hours).',
      {'sensor_id':s('Exact sensor ID'),'start':s('ISO 8601 +08:00 start'),'end':s('ISO 8601 +08:00 end')},['sensor_id','start','end']),
 tool('get_sensor_summary','Get read-only count, min, mean, max and first/last values of a sensor over a period (up to 366 days).',
      {'sensor_id':s('Exact sensor ID'),'start':s('ISO +08:00 start'),'end':s('ISO +08:00 end')},['sensor_id','start','end']),
 tool('get_room_context','Get recent room sensor summary, headcount, weather, AC state, bookings and maintenance context at a timestamp.',
      {'room_id':s('Exact room ID'),'at_time':s('ISO +08:00 timestamp')},['room_id','at_time']),
 tool('get_expected_reading','Estimate a sensor reading at a target time from comparable prior same-weekday five-minute slots; NOT a trained predictor.',
      {'sensor_id':s('Exact sensor ID'),'target_time':s('ISO +08:00 target time')},['sensor_id','target_time']),
 tool('compare_to_baseline','Compare one observed reading against comparable historical NORMAL data and flag potential investigation, not a confirmed fault.',
      {'sensor_id':s('Exact sensor ID'),'at_time':s('ISO +08:00 observed timestamp')},['sensor_id','at_time']),
 tool('get_floor_energy','Estimate total energy (kWh) from the single floor power meter over a period, never summing duplicated room contexts.',
      {'start':s('ISO +08:00 start'),'end':s('ISO +08:00 end')},['start','end']),
]

TOOL_BY_NAME={t['function']['name']:t for t in TOOL_SPECS}

class RepositoryTools:
    def __init__(self,db_path,dataset='normal',as_of='2025-12-31T23:55:00+08:00',retrieval='contextual'):
        if dataset not in {'normal','fault'}: raise ValueError('Invalid dataset')
        if retrieval not in {'raw','summary','contextual'}: raise ValueError('Invalid retrieval mode')
        self.db_path=db_path;self.dataset=dataset;self.as_of=iso(as_of)
        self.retrieval=retrieval
        self.used=[]

    def specifications(self):
        names={'raw':{'list_rooms','get_sensor_history','get_room_context'},
               'summary':{'list_rooms','get_sensor_summary','get_expected_reading','compare_to_baseline','get_floor_energy'},
               'contextual':set(TOOL_BY_NAME)}[self.retrieval]
        return [t for t in TOOL_SPECS if t['function']['name'] in names]

    def _time(self,value,allow_future=False):
        d=iso(value)
        if d > self.as_of+(timedelta(days=7) if allow_future else timedelta(0)):
            raise ValueError('Time later than experiment as_of bound')
        return d

    def _period(self,start,end,max_days):
        a=self._time(start);b=self._time(end)
        if b < a: raise ValueError('Period end before start')
        if b-a > timedelta(days=max_days): raise ValueError(f'Window exceeds {max_days} days')
        return a,b

    def execute(self,name,args):
        if name not in {t['function']['name'] for t in self.specifications()}:
            raise ValueError('Tool not approved for retrieval mode')
        if not isinstance(args,dict): raise ValueError('Arguments must be a JSON object')
        spec=TOOL_BY_NAME[name]['function']['parameters']
        if set(args)-set(spec['properties']) or set(spec['required'])-set(args):
            raise ValueError('Invalid/missing arguments')
        value=getattr(self,name)(**args)
        self.used.append({'tool':name,'arguments':args,'result':value})
        return value

    def list_rooms(self):
        with connect(self.db_path,readonly=True) as db:
            rooms=[dict(r) for r in db.execute('SELECT room_id,room_name,room_type,max_capacity,ac_zone_id FROM rooms ORDER BY room_id')]
            s=[dict(r) for r in db.execute('SELECT sensor_id, room_id,sensor_type FROM sensor_readings WHERE dataset=? GROUP BY sensor_id,room_id,sensor_type ORDER BY room_id,sensor_id',(self.dataset,))]
        return {'dataset':self.dataset,'rooms':rooms,'sensors':s,'synthetic':True}

    def get_sensor_history(self,sensor_id,start,end):
        sensor_id=ident(sensor_id);self._period(start,end,2)
        with connect(self.db_path,readonly=True) as db:
            count=db.execute('SELECT COUNT(*) FROM sensor_readings WHERE dataset=? AND sensor_id=? AND timestamp>=? AND timestamp<=?',
                             (self.dataset,sensor_id,start,end)).fetchone()[0]
            values=list(db.execute('SELECT timestamp,sensor_id,room_id,sensor_type,value,unit,quality_flag FROM sensor_readings WHERE dataset=? AND sensor_id=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp DESC LIMIT 120',
                                   (self.dataset,sensor_id,start,end)))
        return {'dataset':self.dataset,'sensor_id':sensor_id,'total_points':count,'returned_points':len(values),
                'truncated_to_latest_120':count>120,'readings':[dict(r) for r in reversed(values)]}

    def get_sensor_summary(self,sensor_id,start,end):
        sensor_id=ident(sensor_id);self._period(start,end,366)
        with connect(self.db_path,readonly=True) as db:
            params=(self.dataset,sensor_id,start,end)
            base='FROM sensor_readings WHERE dataset=? AND sensor_id=? AND timestamp>=? AND timestamp<=? AND value IS NOT NULL'
            r=db.execute('SELECT COUNT(*) AS n,MIN(value) AS minimum,MAX(value) AS maximum,AVG(value) AS mean '+base,params).fetchone()
            first=db.execute('SELECT timestamp,value,unit,sensor_type '+base+' ORDER BY timestamp ASC LIMIT 1',params).fetchone()
            last=db.execute('SELECT timestamp,value,unit,sensor_type '+base+' ORDER BY timestamp DESC LIMIT 1',params).fetchone()
        result={'dataset':self.dataset,'sensor_id':sensor_id,'start':start,'end':end,'count':r['n'],
                'minimum':r['minimum'],'maximum':r['maximum'],'average':round(r['mean'],3) if r['mean'] is not None else None,
                'first':safe_row(first),'last':safe_row(last)}
        if first and last: result['change']=round(last['value']-first['value'],3)
        return result

    def get_room_context(self,room_id,at_time):
        room_id=ident(room_id);self._time(at_time)
        with connect(self.db_path,readonly=True) as db:
            room=db.execute('SELECT room_id,room_name,room_type,area_m2,max_capacity,ac_zone_id FROM rooms WHERE room_id=?',(room_id,)).fetchone()
            row=db.execute('SELECT * FROM room_features WHERE dataset=? AND room_id=? AND timestamp<=? ORDER BY timestamp DESC LIMIT 1',
                           (self.dataset,room_id,at_time)).fetchone()
            latest=db.execute('SELECT MAX(timestamp) FROM sensor_readings WHERE dataset=? AND room_id=? AND timestamp<=?',
                              (self.dataset,room_id,at_time)).fetchone()[0]
            sensors=[dict(r) for r in db.execute('SELECT sensor_id,sensor_type,value,unit,quality_flag FROM sensor_readings WHERE dataset=? AND room_id=? AND timestamp=? ORDER BY sensor_id',
                                                  (self.dataset,room_id,latest))] if latest else []
            h=db.execute('SELECT timestamp,headcount,occupancy_ratio FROM headcount WHERE dataset=? AND room_id=? AND timestamp<=? ORDER BY timestamp DESC LIMIT 1',
                         (self.dataset,room_id,at_time)).fetchone()
            bookings=[dict(r) for r in db.execute("SELECT start_time,end_time,attendee_count_actual,meeting_type,status FROM bookings WHERE dataset=? AND room_id=? AND start_time<=? AND end_time>? AND status='held' LIMIT 5",(self.dataset,room_id,at_time,at_time))]
            maintenance=[dict(r) for r in db.execute('SELECT timestamp,action,notes FROM maintenance WHERE dataset=? AND (room_id=? OR ac_zone_id=(SELECT ac_zone_id FROM rooms WHERE room_id=?)) AND timestamp<=? ORDER BY timestamp DESC LIMIT 3',
                                                  (self.dataset,room_id,room_id,at_time))]
        if not row and not sensors and not h:
            return {'dataset':self.dataset,'room_id':room_id,'found':False,'reason':'No observations at or before requested time'}
        def age(stamp):
            if not stamp:return None
            return int((iso(at_time)-iso(stamp)).total_seconds()/60)
        feature=safe_row(row)
        if feature:
            feature.pop('dataset',None)
        return {'dataset':self.dataset,'room_id':room_id,'room':safe_row(room),'at_time':at_time,
                'feature_snapshot':feature,'feature_age_minutes':age(row['timestamp']) if row else None,
                'sensor_snapshot_timestamp':latest,'sensor_age_minutes':age(latest),
                'sensors':sensors,'headcount':safe_row(h),'current_meetings':bookings,
                'maintenance_history':maintenance,'synthetic':True,
                'warning':'Historical snapshot only. Treat readings older than 60 minutes as stale.'}

    def _historical_samples(self,sensor_id,target_time):
        sensor_id=ident(sensor_id);target=self._time(target_time,allow_future=True)
        minute=target.hour*60+target.minute
        floor=max(0,minute-30);ceil=min(1439,minute+30)
        # Only normal records and strictly earlier than target; valid for fault comparisons as well.
        with connect(self.db_path,readonly=True) as db:
            rows=list(db.execute('''SELECT timestamp,value,unit,sensor_type FROM sensor_readings
                WHERE dataset='normal' AND sensor_id=? AND timestamp<?
                  AND timestamp>=? AND weekday=? AND minute_of_day BETWEEN ? AND ?
                  AND (quality_flag='ok' OR quality_flag IS NULL) AND value IS NOT NULL
                  AND substr(timestamp,1,10) < ?
                ORDER BY timestamp DESC LIMIT 420''',
                (sensor_id,target_time,(target-timedelta(days=1095)).isoformat(),target.weekday(),floor,ceil,target.date().isoformat())))
        return rows

    def get_expected_reading(self,sensor_id,target_time):
        rr=self._historical_samples(sensor_id,target_time)
        if len(rr)<5:
            return {'sensor_id':sensor_id,'target_time':target_time,'status':'insufficient_history',
                    'n':len(rr),'reason':'Fewer than five comparable prior normal observations'}
        vals=[r['value'] for r in rr]
        vs=sorted(vals)
        def quantile(p):return vs[int(round(p*(len(vs)-1)))]
        return {'sensor_id':sensor_id,'target_time':target_time,'status':'ok','source_dataset':'normal',
                'method':'Historical same-weekday ±30-minute comparison; no trained model',
                'n':len(vals),'expected_mean':round(statistics.mean(vals),3),
                'expected_median':round(statistics.median(vals),3),
                'standard_deviation':round(statistics.stdev(vals),3) if len(vals)>1 else 0,
                'p10_empirical':round(quantile(.10),3),'p90_empirical':round(quantile(.90),3),
                'unit':rr[0]['unit'],'sensor_type':rr[0]['sensor_type'],
                'caution':'Empirical spread of historical readings is NOT a calibrated prediction interval.'}

    def compare_to_baseline(self,sensor_id,at_time):
        sensor_id=ident(sensor_id);self._time(at_time)
        with connect(self.db_path,readonly=True) as db:
            row=db.execute('SELECT sensor_id,room_id,value,unit,sensor_type,quality_flag FROM sensor_readings WHERE dataset=? AND sensor_id=? AND timestamp=?',
                           (self.dataset,sensor_id,at_time)).fetchone()
        if not row:return {'sensor_id':sensor_id,'at_time':at_time,'status':'reading_missing'}
        baseline=self.get_expected_reading(sensor_id,at_time)
        if baseline['status']!='ok':return {'status':'insufficient_history','observation':dict(row),'baseline':baseline}
        kind=row['sensor_type']
        if kind not in MIN_DELTA or row['value'] is None:
            return {'status':'unsupported_sensor_type','observation':dict(row),'reason':'Binary sensors need event/context rules.'}
        difference=row['value']-baseline['expected_median']
        threshold=max(MIN_DELTA[kind],2.5*baseline['standard_deviation'])
        flagged=abs(difference)>threshold
        return {'status':'ok','dataset':self.dataset,'at_time':at_time,'observation':dict(row),
                'baseline':baseline,'residual':round(difference,3),'threshold':round(threshold,3),
                'flagged_for_investigation':flagged,'confirmed_fault':False,
                'method':'Exploratory historical deviation rule, not calibrated fault diagnosis'}

    def get_floor_energy(self,start,end):
        self._period(start,end,366)
        with connect(self.db_path,readonly=True) as db:
            meter=db.execute("SELECT sensor_id FROM sensor_readings WHERE dataset=? AND sensor_type='power' LIMIT 1",(self.dataset,)).fetchone()
            if not meter:return {'status':'no_power_meter'}
            rows=db.execute('''SELECT COUNT(*) AS n,SUM(value) AS total_power,AVG(value) AS mean_power FROM sensor_readings
                WHERE dataset=? AND sensor_id=? AND timestamp>=? AND timestamp<=? AND value IS NOT NULL''',
                (self.dataset,meter['sensor_id'],start,end)).fetchone()
        return {'dataset':self.dataset,'meter_sensor_id':meter['sensor_id'],'count':rows['n'],
                'mean_power_kw':round(rows['mean_power'],3) if rows['mean_power'] is not None else None,
                'estimated_energy_kwh':round(rows['total_power']*5/60,3) if rows['total_power'] is not None else None,
                'assumed_interval_minutes':5,
                'caution':'Assumes complete five-minute interval-average power values; verify missing intervals. Do not double-count this floor meter across rooms.'}
