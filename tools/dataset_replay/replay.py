"""Exact, bounded-memory replay of people_driven_v3.0 sensor_history.csv.

Reads ONLY sensor_history.csv and run_manifest.json; never publishes fault labels,
employee/badge rows, maintenance descriptions, or future feature values.
"""
from __future__ import annotations
import argparse,csv,io,json,math,sys,time,uuid,zipfile,http.client
from contextlib import contextmanager
from datetime import datetime,timezone
from itertools import groupby
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
SPLITS=('normal_weather_2023_2025','fault_weather_2026_q1')
FIELDS=('timestamp','sensor_id','room_id','sensor_type','value','unit','quality_flag','sequence')

def stamp(value):
    result=datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.tzinfo is None:raise ValueError('Timestamp requires a timezone offset')
    return result

class Dataset:
    def __init__(self,path,split):
        self.path=Path(path).expanduser().resolve();self.split=split
        if split not in SPLITS:raise ValueError('Unknown dataset split')
        if not self.path.exists():raise ValueError('Dataset not found: '+str(self.path))
        if self.path.is_file() and not zipfile.is_zipfile(self.path):raise ValueError('Expected the original dataset ZIP or extracted directory')
        if self.path.is_file():
            with zipfile.ZipFile(self.path) as z:
                candidates=[n[:-len('run_manifest.json')] for n in z.namelist() if n.endswith('/'+split+'/run_manifest.json') or n==split+'/run_manifest.json']
            if len(candidates)!=1:raise ValueError('Cannot uniquely locate dataset split in ZIP')
            self.prefix=candidates[0]
        else:
            candidates=[p for p in (self.path/self.split,self.path/'generated'/self.split,self.path) if (p/'run_manifest.json').is_file() and (p/'sensor_history.csv').is_file()]
            if not candidates:raise ValueError('Cannot locate extracted dataset split')
            self.folder=candidates[0]
        with self.open('run_manifest.json') as f:self.manifest=json.load(f)
        if self.manifest.get('generator')!='people_driven_v3.0' or self.manifest.get('sensor_count')!=18 or self.manifest.get('synthetic') is not True:
            raise ValueError('Unsupported manifest: expected synthetic people_driven_v3.0 with 18 sensors')
        if bool(self.manifest.get('faults'))!=(split==SPLITS[1]):raise ValueError('Selected split disagrees with manifest fault partition')

    @contextmanager
    def open(self,name):
        if name not in ('sensor_history.csv','run_manifest.json'):raise ValueError('Only observation and manifest files may be read')
        if self.path.is_file():
            with zipfile.ZipFile(self.path) as z,z.open(self.prefix+name) as raw,io.TextIOWrapper(raw,encoding='utf-8-sig',newline='') as f:yield f
        else:
            with (self.folder/name).open(encoding='utf-8-sig',newline='') as f:yield f

    def batches(self,registry,start=None,end=None):
        mapping={p['code']:p for p in registry};last=None
        with self.open('sensor_history.csv') as f:
            reader=csv.DictReader(f)
            if not set(FIELDS).issubset(reader.fieldnames or []):raise ValueError('Incomplete sensor_history.csv schema')
            for key,rows in groupby(reader,lambda r:(r['timestamp'],r['sequence'])):
                moment=stamp(key[0])
                if last is not None and moment<=last:raise ValueError('Duplicate/out-of-order source batch')
                last=moment
                if start and moment<start:continue
                if end and moment>=end:break
                converted=[];seen=set();original_created=None
                for i,row in enumerate(rows):
                    if i>=18:raise ValueError('More than 18 readings in source batch')
                    point=mapping.get(row['sensor_id'])
                    if not point or row['sensor_id'] in seen:raise ValueError('Unknown/duplicate source sensor: '+row['sensor_id'])
                    if (row['room_id'],row['sensor_type'],row['unit'])!=(point['simulatorRoomId'],point['sensorType'],point['unit']):raise ValueError('Dataset/registry identity, type or unit mismatch')
                    quality=row['quality_flag']
                    if quality not in ('ok','noisy','drift','missing'):raise ValueError('Unknown source quality')
                    value=None if quality=='missing' and row['value']=='' else float(row['value'])
                    if value is not None and not math.isfinite(value):raise ValueError('Nonfinite source value')
                    if (value is None)!=(quality=='missing'):raise ValueError('Missing flag/value mismatch')
                    if point['unit']=='binary' and value is not None and value not in (0,1):raise ValueError('Non-binary source value')
                    seen.add(row['sensor_id']);original_created=row.get('generated_at_utc')
                    converted.append({'sensor_id':row['sensor_id'],'room_id':row['room_id'],'sensor_type':row['sensor_type'],'value':value,'unit':row['unit'],'timestamp':row['timestamp'],'quality_flag':'missing' if value is None else 'ok'})
                if len(converted)!=18 or seen!=set(mapping):raise ValueError('Incomplete 18-point source batch')
                yield {'source_sequence':int(key[1]),'dataset_timestamp':key[0],'dataset_created_at_utc':original_created,'readings':converted}

class Publisher:
    def __init__(self,url,timeout=5,retries=3):
        self.url=urlsplit(url);self.timeout=timeout;self.retries=retries;self.connection=None
        if self.url.scheme not in ('http','https') or not self.url.hostname:raise ValueError('Expected HTTP(S) ingestion URL')
    def close(self):
        if self.connection:self.connection.close();self.connection=None
    def send(self,payload):
        body=json.dumps(payload,separators=(',',':'),allow_nan=False).encode()
        for attempt in range(self.retries+1):
            try:
                if not self.connection:
                    cls=http.client.HTTPSConnection if self.url.scheme=='https' else http.client.HTTPConnection
                    self.connection=cls(self.url.hostname,self.url.port,timeout=self.timeout)
                self.connection.request('POST',self.url.path or '/',body,{'Content-Type':'application/json'})
                response=self.connection.getresponse();data=json.loads(response.read())
                if 400<=response.status<500:raise ValueError(f'Ingestion rejected batch: HTTP {response.status}: {data}')
                if response.status!=201 or data.get('accepted')!=18:raise OSError(f'Ingestion failed: HTTP {response.status}')
                return data
            except ValueError:self.close();raise
            except (OSError,http.client.HTTPException):
                self.close()
                if attempt==self.retries:raise
                time.sleep(min(2,.2*2**attempt))

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dataset',required=True,type=Path);ap.add_argument('--split',choices=SPLITS,default=SPLITS[1])
    ap.add_argument('--start',help='Inclusive original dataset time, with timezone');ap.add_argument('--end',help='Exclusive dataset time')
    ap.add_argument('--interval-seconds',type=float,default=2,help='Wall-clock release cadence; original samples remain five minutes apart')
    ap.add_argument('--ticks',type=int,default=0,help='0 = replay to EOF; no loop or random replacement')
    ap.add_argument('--http-url',default='http://localhost:3001/api/sensor-readings')
    ap.add_argument('--clock-domain',choices=('same_host','unsynchronized_remote'),default='same_host')
    ap.add_argument('--inspect',action='store_true',help='Print manifest; publish nothing')
    args=ap.parse_args(argv)
    if not math.isfinite(args.interval_seconds) or args.interval_seconds<=0 or args.ticks<0:ap.error('Positive finite interval and nonnegative tick count required')
    publisher=None
    try:
        dataset=Dataset(args.dataset,args.split)
        if args.inspect:print(json.dumps(dataset.manifest,indent=2));return 0
        start=stamp(args.start) if args.start else None;end=stamp(args.end) if args.end else None
        if start and end and end<=start:raise ValueError('End must follow start')
        registry=json.loads((ROOT/'shared/sensorRegistry.json').read_text())
        publisher=Publisher(args.http_url);run_id=uuid.uuid4().hex;n=0
        for batch in dataset.batches(registry,start,end):
            began=time.monotonic();n+=1
            message={**batch,'producer':'people_driven_v3.0_dataset_replay','synthetic':True,'replay_id':run_id,'batch_id':f'{run_id}:{n}','dataset':args.split,'sequence':n,'clock_domain':args.clock_domain,'generated_at_utc':datetime.now(timezone.utc).isoformat(timespec='milliseconds'),'dataset_sampling_minutes':dataset.manifest['minutes'],'release_interval_seconds':args.interval_seconds}
            publisher.send(message)
            print(f'{args.split} batch={n} source_sequence={batch["source_sequence"]} dataset_time={batch["dataset_timestamp"]} readings=18',flush=True)
            if args.ticks and n>=args.ticks:break
            # Never burst to catch up after a slow request. Bounded in-flight work.
            time.sleep(max(0,args.interval_seconds-(time.monotonic()-began)))
        if not n:raise ValueError('No samples in the requested interval')
        print(f'Replay complete: {n} batches. Dataset values/timestamps preserved; no synthetic loop.',flush=True)
        return 0
    except (OSError,ValueError,KeyError,csv.Error,zipfile.BadZipFile) as e:ap.error(str(e))
    finally:
        if publisher:publisher.close()

if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:print('Replay stopped.');sys.exit(0)
