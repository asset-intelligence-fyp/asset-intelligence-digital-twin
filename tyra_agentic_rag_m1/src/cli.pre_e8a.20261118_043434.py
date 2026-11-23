"""All entry points: python -m src.cli --help"""
from __future__ import annotations
import argparse
import json
import time
from datetime import timedelta
from pathlib import Path
from .config import SETTINGS, root_path
from .db import ingest, sensors, valid_timestamp, stamp, db_connect
from .demo import make_demo
from .retrieval import TemporalRetriever
from .workflow import run_method
from .local_llm import OllamaJSON
from .evaluation import evaluate_detection, evaluate_forecast
from .splits import make_splits


def main():
    parser=argparse.ArgumentParser(description="Local LLM Agentic RAG for 5-minute building sensors")
    sub=parser.add_subparsers(dest='command',required=True)
    demo=sub.add_parser('demo',help='Generate an example synthetic dataset (for testing only)')
    demo.add_argument('--days',type=int,default=21)
    imp=sub.add_parser('ingest',help='Import readings only; labels are never ingested')
    imp.add_argument('--csv',required=True)
    imp.add_argument('--format',choices=['long','wide'],default='long')
    imp.add_argument('--timestamp-col',default='timestamp')
    imp.add_argument('--sensor-col',default='sensor_id')
    imp.add_argument('--value-col',default='value')
    imp.add_argument('--zone-col')
    imp.add_argument('--wide-sensors',nargs='*',help='Sensor columns for wide-format CSV; otherwise all non-timestamp/zone fields')
    sub.add_parser('inspect',help='List sensors and available timestamps')
    split=sub.add_parser('splits',help='Write chronological split boundaries')
    split.add_argument('--out',default='data/splits.json')
    batch=sub.add_parser('batch',help='Run one experiment (requires local Ollama)')
    batch.add_argument('--task',choices=['detect','forecast'],required=True)
    batch.add_argument('--method',choices=['baseline','traditional','agentic','agentic_verify','e7','e71'],required=True)
    batch.add_argument('--sensor',required=True)
    batch.add_argument('--start',help='First prediction time; if omitted, uses 7 days after first observation')
    batch.add_argument('--end',help='Final origin inclusive; optional')
    batch.add_argument('--stride',type=int,default=12,help='Sampling stride: 1 = every 5 min, 12 = hourly')
    batch.add_argument('--limit',type=int,default=4,help='Maximum origins (small defaults for an 8 GB Mac)')
    batch.add_argument('--horizon',type=int,default=12,help='Forecast steps; <=36 recommended')
    batch.add_argument('--max-rounds',type=int,default=2)
    batch.add_argument('--e71-no-context',action='store_true',help='E7.1 ablation: exclude context')
    batch.add_argument('--e71-context-db',default=None,help='E7.1 external context index path')
    batch.add_argument('--e71-screening-file',default=None,help='Reuse cached E7/E7.1 inference screening; paired ablation')
    batch.add_argument('--out',help='Path to predictions JSONL')
    batch.add_argument('--partition',choices=['development','validation','test'],
                       help='Restrict origins to the named partition in data/splits.json')
    ev=sub.add_parser('evaluate',help='Independent evaluation of saved inference records')
    ev.add_argument('--task',choices=['detect','forecast'],required=True)
    ev.add_argument('--results',required=True)
    ev.add_argument('--events',help='Ground truth event CSV: REQUIRED for detection')
    ev.add_argument('--alert-suspect',choices=['yes','no'],default='yes')
    args=parser.parse_args()
    if args.command=='demo':
        raw,ground=make_demo(args.days)
        print(json.dumps({'readings_csv':raw,'events_csv':ground},indent=2))
    elif args.command=='ingest':
        print(json.dumps(ingest(args.csv,args.format,args.timestamp_col,args.sensor_col,
                                args.value_col,args.zone_col,wide_sensors=args.wide_sensors),indent=2))
    elif args.command=='inspect':
        print(json.dumps(sensors(),indent=2))
    elif args.command=='splits':
        print(json.dumps(make_splits(args.out),indent=2))
    elif args.command=='batch':
        run_batch(args)
    elif args.command=='evaluate':
        if args.task=='detect':
            if not args.events:parser.error('--events is required for detection evaluation')
            results=evaluate_detection(root_path(args.results),root_path(args.events),
                                       args.alert_suspect=='yes')
        else:
            results=evaluate_forecast(root_path(args.results))
        print(json.dumps(results,indent=2,default=str))


def run_batch(args):
    if not 1<=args.horizon<=36:raise ValueError('Set --horizon between 1 and 36 for M1 pilot')
    if args.method == 'e7' and args.task != 'detect':
        raise ValueError('E7 dual-stage implementation supports --task detect only')
    if args.method == 'e71' and args.task != 'detect':
        raise ValueError('E7.1 supports --task detect only')
    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')
    info=next((r for r in sensors() if r['sensor_id']==args.sensor),None)
    if not info:raise ValueError(f'Unknown sensor {args.sensor}; run inspect')
    first=valid_timestamp(info['first']); last=valid_timestamp(info['last'])
    partition_limits=None
    if args.partition:
        manifest=root_path('data/splits.json')
        if not manifest.is_file():
            raise FileNotFoundError('Run python -m src.cli splits first')
        part=json.loads(manifest.read_text())[args.partition]
        partition_limits=(valid_timestamp(part['start']),valid_timestamp(part['end']))
    start=valid_timestamp(args.start) if args.start else (partition_limits[0] if partition_limits else first+timedelta(days=7))
    end=valid_timestamp(args.end) if args.end else (partition_limits[1] if partition_limits else last)
    if partition_limits:
        if start < partition_limits[0] or end > partition_limits[1]:
            raise ValueError(f'Origins must remain within the {args.partition} partition')
    if args.task=='forecast':
        end=min(end,last-timedelta(minutes=5*args.horizon))
        if partition_limits:
            end=min(end,partition_limits[1]-timedelta(minutes=5*args.horizon))
    if not first<=start<=end:raise ValueError('Requested origins outside data range')
    out=root_path(args.out or f'results/{args.task}_{args.method}.jsonl')
    out.parent.mkdir(parents=True,exist_ok=True)
    e71_cached_screens = None
    if args.method == 'e71' and args.e71_screening_file:
        e71_cached_screens = {}
        with root_path(args.e71_screening_file).open(encoding='utf-8') as sf:
            for line in sf:
                if not line.strip():continue
                previous=json.loads(line)
                if previous.get('task') != 'detect' or previous.get('valid') is False:
                    raise ValueError('Cached screening file must contain valid detection inference records')
                if previous.get('model') and previous['model'] != SETTINGS.model:
                    raise ValueError('Cached screening model differs from configured OLLAMA_MODEL')
                if any(k in previous for k in ('label','fault_active','ground_truth')):
                    raise ValueError('Cached screening file must not contain ground-truth labels')
                screen=previous.get('screening') or previous.get('answer') or {}
                if screen.get('status') not in ('normal','suspect','anomaly','unknown'):
                    raise ValueError('Bad cached screening status')
                origin_dt=valid_timestamp(previous.get('origin'))
                if any(valid_timestamp(ts) > origin_dt for ts in screen.get('evidence_timestamps', [])):
                    raise ValueError('Cached screening includes a future evidence timestamp')
                key=(previous.get('sensor_id'),previous.get('origin'))
                if key in e71_cached_screens:
                    raise ValueError('Duplicate timestamp in screening file')
                e71_cached_screens[key]=screen
    llm=OllamaJSON()
    printed=0
    with out.open('w',encoding='utf-8') as f:
        t=start
        while t<=end and printed<args.limit:
            metrics_before=llm.totals.copy()
            start_clock=time.perf_counter()
            base={'task':args.task,'method':args.method,'model':llm.model,
                  'sensor_id':args.sensor,'origin':stamp(t),'horizon':args.horizon if args.task=='forecast' else None}
            try:
                retriever=TemporalRetriever(args.sensor,stamp(t),args.task,args.horizon)
                if args.method == 'e71':
                    from .e71 import run_e71_detection
                    result=run_e71_detection(retriever,llm,args.max_rounds,
                        context_db=args.e71_context_db, use_context=not args.e71_no_context,
                        screening_override=(e71_cached_screens[(args.sensor,stamp(t))]
                            if e71_cached_screens is not None else None))
                elif args.method == 'e7':
                    from .e7 import run_e7_detection
                    result=run_e7_detection(retriever,llm,args.max_rounds)
                else:
                    result=run_method(args.task,args.method,retriever,llm,args.horizon,args.max_rounds)
                base.update(result)
                base['valid']=True
                base['error']=None
            except (RuntimeError,ValueError,TypeError) as ex:
                base.update({'answer':{},'trace':[],'evidence_count':0,'valid':False,'error':str(ex)})
            base['latency_ms']=round((time.perf_counter()-start_clock)*1000,1)
            base['llm_calls']=llm.totals['calls']-metrics_before['calls']
            base['input_tokens']=llm.totals['input_tokens']-metrics_before['input_tokens']
            base['output_tokens']=llm.totals['output_tokens']-metrics_before['output_tokens']
            f.write(json.dumps(base)+'\n');f.flush()
            printed+=1
            print(f"{printed}/{args.limit} {base['origin']} {args.method}: "
                  + (str(base['answer'].get('status',base['answer'].get('values'))) if base['valid']
                     else 'FAILED: '+base['error'][:120]),flush=True)
            t+=timedelta(minutes=5*args.stride)
    print(f'Saved {printed} predictions to {out}')

if __name__=='__main__':
    main()
