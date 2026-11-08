"""Stream generated CSVs into a local relational repository. Hidden labels NEVER imported."""
from __future__ import annotations
import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from .db import connect

CHUNK = 5000

def f(v):
    return float(v) if v not in ('', None) else None

def i(v):
    return int(float(v)) if v not in ('', None) else None

def rows(path: Path):
    with path.open(newline='', encoding='utf-8-sig') as h:
        yield from csv.DictReader(h)

def sensor(r):
    ts = datetime.fromisoformat(r['timestamp'])
    if ts.tzinfo is None:
        raise ValueError('Sensor timestamps must carry +08:00 (or another explicit offset)')
    return (r['timestamp'],r['sensor_id'],r['room_id'],r['sensor_type'],f(r.get('value')),
            r.get('unit'),r.get('source'),r.get('quality_flag','ok'),ts.weekday(),ts.hour*60+ts.minute)

def features(r):
    keys = ['temperature','co2','humidity','light','pir','power_kw']
    numbers = [f(r.get(k)) for k in keys]
    return (r['timestamp'],r['room_id'],*numbers,r.get('power_scope'),i(r.get('headcount')),
            f(r.get('occupancy_ratio')),f(r.get('outdoor_temp_c')),
            f(r.get('outdoor_humidity_pct')),f(r.get('rainfall_mm_per_h')),
            i(r.get('ac_on')),f(r.get('setpoint_c')),r.get('ventilation_level'),
            i(r.get('is_meeting_booked')),i(r.get('is_holiday')),
            f(r.get('expected_attendance_factor')),i(r.get('max_capacity')),r.get('split'))

def room(r):
    return (r['room_id'],r.get('room_name'),r.get('room_type'),f(r.get('area_m2')),
            f(r.get('ceiling_height_m')),i(r.get('max_capacity')),i(r.get('seat_count')),
            r.get('window_orientation'),i(r.get('has_window')),r.get('ac_zone_id'))

def calendar(r):
    return (r['date'],i(r.get('day_of_week')),i(r.get('is_workday')),
            i(r.get('is_public_holiday')),r.get('holiday_name'),f(r.get('expected_attendance_factor')))

def booking(r):
    return (r['booking_id'],r['room_id'],r['start_time'],r['end_time'],
            i(r.get('attendee_count_planned')),i(r.get('attendee_count_actual')),
            r.get('meeting_type'),r.get('status'))

def maintenance(r):
    return (r['log_id'],r['timestamp'],r.get('room_id'),r.get('ac_zone_id'),
            r.get('action'),(r.get('notes') or '')[:240])

def headcount(r):
    return (r['timestamp'],r['room_id'],i(r['headcount']),f(r.get('occupancy_ratio')))

# table, projection, converter, number of converted columns
MAP: dict[str,tuple[str,str,Callable,int]] = {
 'sensor_history.csv': ('sensor_readings','timestamp,sensor_id,room_id,sensor_type,value,unit,source,quality_flag,weekday,minute_of_day', sensor,10),
 'training_features.csv': ('room_features','timestamp,room_id,temperature,co2,humidity,light,pir,power_kw,power_scope,headcount,occupancy_ratio,outdoor_temp_c,outdoor_humidity_pct,rainfall_mm_per_h,ac_on,setpoint_c,ventilation_level,is_meeting_booked,is_holiday,expected_attendance_factor,max_capacity,split',features,22),
 'rooms.csv': ('rooms','room_id,room_name,room_type,area_m2,ceiling_height_m,max_capacity,seat_count,window_orientation,has_window,ac_zone_id',room,10),
 'calendar.csv': ('calendar','date,day_of_week,is_workday,is_public_holiday,holiday_name,expected_attendance_factor',calendar,6),
 'room_bookings.csv': ('bookings','booking_id,room_id,start_time,end_time,attendee_count_planned,attendee_count_actual,meeting_type,status',booking,8),
 'maintenance_log.csv': ('maintenance','log_id,timestamp,room_id,ac_zone_id,action,notes',maintenance,6),
 'headcount.csv': ('headcount','timestamp,room_id,headcount,occupancy_ratio',headcount,4),
}

def ingest_directory(db_path: str, root: str, dataset: str, *, progress: bool = True, max_rows_per_file: int | None = None):
    if dataset not in {'normal','fault'}:
        raise ValueError('dataset must be normal or fault')
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f'Dataset directory does not exist: {root}')
    files = [p for p in sorted(root.rglob('*.csv')) if p.name in MAP]
    if not files:
        raise FileNotFoundError(f'No supported CSVs found under {root}')
    if not any(p.name=='sensor_history.csv' for p in files):
        raise FileNotFoundError('No sensor_history.csv found. Point to normal_weather_2023_2025, normal_by_year, or fault_weather_2026_q1.')
    db=connect(db_path)
    completed=[]
    try:
        for file in files:
            table,columns,convert,size=MAP[file.name]
            if db.execute('SELECT 1 FROM imports WHERE dataset=? AND source_path=? AND table_name=?',
                          (dataset,str(file),table)).fetchone():
                if progress: print('SKIP (previously imported):',file)
                continue
            is_room = table == 'rooms'
            cols=columns.split(',')
            insert_columns = cols if is_room else ['dataset',*cols]
            placeholders = ','.join('?' for _ in insert_columns)
            command = f"INSERT OR IGNORE INTO {table} ({','.join(insert_columns)}) VALUES ({placeholders})"
            count=0
            chunk=[]
            try:
                for r in rows(file):
                    data=convert(r)
                    if len(data)!=size:
                        raise ValueError(f'Converter mismatch for {file}: {len(data)} versus {size}')
                    chunk.append(data if is_room else (dataset,*data))
                    if len(chunk)>=CHUNK:
                        db.executemany(command,chunk);count+=len(chunk);chunk=[]
                    if max_rows_per_file and count + len(chunk)>=max_rows_per_file:
                        break
                if chunk:
                    db.executemany(command,chunk);count+=len(chunk)
                db.execute('INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?)',
                           (dataset,str(file),table,count,datetime.now(timezone.utc).isoformat()))
                db.commit()
                completed.append({'file':str(file),'rows_processed':count,'table':table})
                if progress: print(f'IMPORTED {file.name}: {count:,} rows ({dataset})')
            except Exception:
                db.rollback()
                raise
        return completed
    finally:
        db.close()
