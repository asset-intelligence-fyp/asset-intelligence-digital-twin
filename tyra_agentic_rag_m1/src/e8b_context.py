"""Strict optional, causal building-context index for E8-B.

Only records in generated/anomaly_eval_2026_q1_llm_inputs and published
sensor_registry metadata are considered. Ground-truth keys are never loaded.
Ambiguous joins are omitted, not guessed.
"""
from __future__ import annotations
import argparse,csv,json,sqlite3
from datetime import datetime,timezone,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

VALUE_FIELDS={
 'headcount':('headcount','occupants','occupant_count'),
 'occupancy_ratio':('occupancy_ratio',),
 'ac_on':('ac_on','hvac_on','ac_status'),
 'setpoint_c':('setpoint_c','hvac_setpoint_c'),
 'ventilation_level':('ventilation_level','ventilation_mode'),
 'regional_temp_c':('regional_temp_c','temp_c','outdoor_temp_c','air_temperature_c'),
 'regional_humidity_pct':('regional_humidity_pct','outdoor_humidity_pct','humidity_pct'),
 'regional_rain_mm_h':('regional_rain_mm_h','rain_mm_h','precip_mm_h'),
 'solar_w_m2':('solar_w_m2','solar_irradiance_w_m2'),
 'local_rain_mm_h':('local_rain_mm_h',),
 'rain_wet':('rain_wet',),
 'local_rain_3h_mm':('local_rain_3h_mm',),
}
SENSITIVE=('label','fault','anomaly','ground_truth','event_id','actual_status')
REQUIRED_KEY={'occupancy':('room_id',),
              'hvac':('ac_zone_id','room_id'),
              'weather':('weather_station_id','station_id','region_id')}
MAX_AGE={'occupancy':15,'hvac':15,'weather':35}

def iso(value):
    dt=datetime.fromisoformat(str(value).strip().replace('Z','+00:00'))
    if dt.tzinfo is None:
        dt=dt.replace(tzinfo=ZoneInfo('Asia/Kuching'))
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00','Z')

def extract_values(row):
    lower={k.lower():k for k in row}
    out={}
    for target,aliases in VALUE_FIELDS.items():
        for alias in aliases:
            name=lower.get(alias)
            if name is None or str(row[name]).strip()=='':continue
            v=str(row[name]).strip()
            if v.lower() in ('true','on','yes'): out[target]=True
            elif v.lower() in ('false','off','no'):out[target]=False
            else:
                try:out[target]=float(v)
                except ValueError:
                    if target=='ventilation_level' and len(v)<40:out[target]=v
                    else:continue
            break
    return out

def _ensure_clean_headers(headers, source):
    if not headers or any(any(token in h.lower() for token in SENSITIVE) for h in headers):
        raise ValueError(f'Forbidden or missing column detected in {source}')

def build_context_index(dataset, out):
    dataset=Path(dataset).expanduser().resolve()
    out=Path(out).expanduser().resolve()
    if out.exists():raise FileExistsError(f'Context index already exists: {out}')
    meta=dataset/'generated/llm_reference_visible/sensor_registry.csv'
    source=dataset/'generated/anomaly_eval_2026_q1_llm_inputs'
    if not meta.is_file():raise FileNotFoundError(meta)
    if not source.is_dir():raise FileNotFoundError(source)
    out.parent.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(out)
    report={'sources':{},'sensor_count':0,'assumption':'naive context timestamps interpreted as Asia/Kuching',
            'labels_used':False}
    try:
        con.executescript('''CREATE TABLE sensors(sensor_id TEXT PRIMARY KEY,room_id TEXT,ac_zone_id TEXT,weather_station_id TEXT,region_id TEXT);
         CREATE TABLE ctx(kind TEXT,ts TEXT,join_col TEXT,join_value TEXT,values_json TEXT);
         CREATE INDEX ix_ctx ON ctx(kind,join_col,join_value,ts);''')
        with meta.open(newline='',encoding='utf-8-sig') as f:
            r=csv.DictReader(f);_ensure_clean_headers(r.fieldnames,meta)
            if not {'sensor_id','room_id'}.issubset(set(r.fieldnames)):
                raise ValueError('sensor_registry.csv must include sensor_id and room_id')
            for row in r:
                if not row.get('sensor_id'):continue
                con.execute('INSERT OR REPLACE INTO sensors VALUES(?,?,?,?,?)',
                            (row['sensor_id'],row.get('room_id',''),row.get('ac_zone_id',''),
                             row.get('weather_station_id',row.get('station_id','')),
                             row.get('region_id','')))
                report['sensor_count']+=1
        for kind,filename in [('occupancy','headcount.csv'),('hvac','hvac_state.csv'),('weather','weather_5min.csv')]:
            path=source/filename
            if not path.is_file():
                report['sources'][kind]={'status':'missing'};continue
            with path.open(newline='',encoding='utf-8-sig') as f:
                r=csv.DictReader(f); headers=r.fieldnames or []
                _ensure_clean_headers(headers,path)
                if 'timestamp' not in headers:
                    report['sources'][kind]={'status':'skipped_missing_timestamp'};continue
                keycol=next((x for x in REQUIRED_KEY[kind] if x in headers),None)
                if not any(any(a in headers for a in aliases) for aliases in VALUE_FIELDS.values()):
                    report['sources'][kind]={'status':'skipped_no_approved_value_fields'};continue
                inserted=0;invalid=0
                for row in r:
                    values=extract_values(row)
                    if not values:continue
                    try: t=iso(row['timestamp'])
                    except (TypeError,ValueError):invalid+=1;continue
                    if kind=='occupancy' and keycol is None:
                        continue
                    keyval=(row.get(keycol) or '').strip() if keycol else '__global__'
                    if not keyval:continue
                    con.execute('INSERT INTO ctx VALUES(?,?,?,?,?)',
                                (kind,t,keycol or 'global',keyval,json.dumps(values)))
                    inserted+=1
                    if inserted%10000==0:con.commit()
                con.commit()
                report['sources'][kind]={'status':'indexed' if inserted else 'skipped_no_join_or_values',
                                         'key':keycol or 'global','rows':inserted,'unparseable_times':invalid}
        con.commit()
    except Exception:
        con.close();out.unlink(missing_ok=True);raise
    con.close()
    report_path=out.with_suffix('.audit.json')
    report_path.write_text(json.dumps(report,indent=2))
    return report

class E8BContextStore:
    def __init__(self,path):
        self.path=Path(path)
        if not self.path.exists():raise FileNotFoundError(self.path)
        self.con=sqlite3.connect(f'file:{self.path}?mode=ro', uri=True)

    def at(self,sensor_id,origin):
        ts=iso(origin)
        sensor=self.con.execute('SELECT room_id,ac_zone_id,weather_station_id,region_id FROM sensors WHERE sensor_id=?',
                                (sensor_id,)).fetchone()
        if not sensor:
            return {'status':'unavailable','reason':'sensor_id missing from registry'}
        loc=dict(zip(('room_id','ac_zone_id','weather_station_id','region_id'),sensor))
        info={'status':'available','as_of_utc':ts,'sensor_id':sensor_id,'observed_context':{},'unavailable':{}}
        for kind in ('occupancy','hvac','weather'):
            row=self.con.execute('SELECT join_col, join_value FROM ctx WHERE kind=? LIMIT 1',(kind,)).fetchone()
            if not row:
                info['unavailable'][kind]='not_indexed';continue
            key_col=row[0]
            if key_col=='global':key_value='__global__'
            else:key_value=loc.get('weather_station_id') if key_col=='station_id' else loc.get(key_col)
            if not key_value:
                info['unavailable'][kind]=f'no_verified_sensor_{key_col}_mapping';continue
            results=self.con.execute('''SELECT ts,values_json FROM ctx WHERE kind=? AND join_col=? AND join_value=? AND ts<=?
             ORDER BY ts DESC LIMIT 2''',(kind,key_col,key_value,ts)).fetchall()
            if not results:
                info['unavailable'][kind]='no_causal_matching_record';continue
            top_ts=results[0][0]
            if len(results)>1 and results[1][0]==top_ts:
                info['unavailable'][kind]='ambiguous_duplicate_context_at_timestamp';continue
            age=(datetime.fromisoformat(ts.replace('Z','+00:00'))-
                 datetime.fromisoformat(top_ts.replace('Z','+00:00'))).total_seconds()/60
            if age<0 or age>MAX_AGE[kind]:
                info['unavailable'][kind]=f'stale_record_age_{round(age,1)}_minutes';continue
            info['observed_context'][kind]={'timestamp_utc':top_ts,'age_minutes':round(age,2),
                                            'mapping':{key_col:key_value},
                                            'values':json.loads(results[0][1])}
        if not info['observed_context']:info['status']='unavailable'
        return info
    def close(self):self.con.close()

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('operation',choices=['build'])
    p.add_argument('--dataset',required=True)
    p.add_argument('--out',required=True)
    a=p.parse_args()
    print(json.dumps(build_context_index(a.dataset,a.out),indent=2))
