#!/usr/bin/env python3
"""Label-free, resumable E8-B manifest runner; no ground truth files opened.

Works with E7 frozen manifests that have cases with sensor/start/limit/stride.
A completed case is verified against expected timestamp sequence before reuse.
"""
from __future__ import annotations
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
from datetime import datetime,timezone,timedelta


def time_utc(x):
    dt=datetime.fromisoformat(str(x).replace('Z','+00:00'))
    if dt.tzinfo is None:
        raise ValueError(f'Manifest start must be timezone aware: {x}')
    return dt.astimezone(timezone.utc)

def cases_from_manifest(path):
    data=json.loads(Path(path).read_text(encoding='utf-8'))
    cases=data.get('cases')
    if not isinstance(cases,list) or not cases:raise ValueError('Manifest has no cases list')
    result=[]
    for n,c in enumerate(cases,1):
        def get(*keys):
            for k in keys:
                if c.get(k) is not None:return c[k]
            return None
        case_id=get('case_id','id','case','name') or f'CASE-{n:04d}'
        sensor=get('sensor_id','sensor')
        start=get('start','start_local','start_time','start_time_local','start_iso',
                  'start_timestamp','first_origin_local','origin_start','origin')
        limit=get('limit','count','n_readings','reading_count') or 12
        stride=get('stride','step') or 1
        if not sensor or not start:
            raise ValueError(f'Manifest case {n} lacks sensor/start. Available keys: {list(c)}')
        if not str(case_id).replace('-','').replace('_','').isalnum():
            raise ValueError(f'Unsafe manifest case ID: {case_id}')
        if int(limit)<1 or int(stride)<1:raise ValueError('Invalid case length or stride')
        result.append({'id':str(case_id),'sensor_id':str(sensor),
                       'start':str(start),'limit':int(limit),'stride':int(stride)})
    if len(set(x['id'] for x in result))!=len(result):raise ValueError('Duplicate case IDs')
    return data,result

def load_case(path,case):
    pred=[json.loads(s) for s in Path(path).read_text(encoding='utf-8').splitlines() if s.strip()]
    if len(pred)!=case['limit']:
        raise ValueError(f'{path}: expected {case["limit"]} records, got {len(pred)}')
    start=time_utc(case['start'])
    keys=set()
    for i,r in enumerate(pred):
        if not r.get('valid') or r.get('method')!='e8b' or r.get('task')!='detect':
            raise ValueError(f'{path}: record {i} invalid or not E8-B')
        if r.get('sensor_id')!=case['sensor_id']:
            raise ValueError(f'{path}: unexpected sensor')
        t=time_utc(r.get('origin'))
        expected=start+timedelta(minutes=5*case['stride']*i)
        if t!=expected:raise ValueError(f'{path}: misaligned timestamp {t} != {expected}')
        if t in keys:raise ValueError(f'{path}: duplicate timestamp')
        keys.add(t)
    return pred

def run(args):
    path=Path(args.manifest).resolve()
    meta,cases=cases_from_manifest(path)
    selected=cases[:args.case_limit] if args.case_limit else cases
    print(f'E8-B manifest: {len(selected)} cases, {sum(c["limit"] for c in selected)} readings')
    print('Manifest SHA256:',hashlib.sha256(path.read_bytes()).hexdigest())
    print('Case-list reference:',meta.get('cases_sha256','not provided'))
    screen=Path(args.screening_file).resolve() if args.screening_file else None
    if screen is not None and not screen.is_file():raise FileNotFoundError(screen)
    ctx=Path(args.context_db).resolve() if args.context_db else None
    if ctx is not None and not ctx.is_file():raise FileNotFoundError(ctx)
    if args.dry_run:
        for c in selected:print(c['id'],c['sensor_id'],c['start'])
        return
    directory=Path(args.out_dir).resolve()
    combined=Path(args.combined).resolve()
    directory.mkdir(parents=True,exist_ok=True)
    combined.parent.mkdir(parents=True,exist_ok=True)
    if combined.exists():raise FileExistsError(f'Combined output already exists: {combined}')
    all_predictions=[]
    for i,c in enumerate(selected,1):
        outfile=directory/f'{c["id"]}.jsonl'
        if outfile.exists():
            if not args.resume:raise FileExistsError(f'Existing case {outfile}; use --resume')
            print(f'[{i}/{len(selected)}] Reusing {c["id"]}')
        else:
            cmd=[sys.executable,'-m','src.cli','batch','--task','detect',
                 '--method','e8b','--sensor',c['sensor_id'],'--start',c['start'],
                 '--stride',str(c['stride']),'--limit',str(c['limit']),
                 '--max-rounds',str(args.max_rounds),'--out',str(outfile)]
            if screen is not None:cmd.extend(['--e8a-screening-file',str(screen)])
            if ctx is not None:cmd.extend(['--e8b-context-db',str(ctx)])
            print(f'[{i}/{len(selected)}] Running {c["id"]} ({c["sensor_id"]})',flush=True)
            subprocess.run(cmd,check=True)
        all_predictions.extend(load_case(outfile,c))
    tmp=combined.with_name(combined.name+'.tmp')
    with tmp.open('w',encoding='utf-8') as f:
        for r in all_predictions:f.write(json.dumps(r,ensure_ascii=False,default=str)+'\n')
    tmp.replace(combined)
    print('Saved',len(all_predictions),'validated predictions:',combined)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--manifest',required=True)
    p.add_argument('--screening-file',default=None,
                   help='Clean label-free E7 cached screening JSONL for paired analysis')
    p.add_argument('--context-db',default=None)
    p.add_argument('--max-rounds',type=int,default=2)
    p.add_argument('--case-limit',type=int,default=None)
    p.add_argument('--out-dir',required=True)
    p.add_argument('--combined',required=True)
    p.add_argument('--resume',action='store_true')
    p.add_argument('--dry-run',action='store_true')
    args=p.parse_args()
    if args.case_limit is not None and args.case_limit<1:p.error('--case-limit must be positive')
    if args.max_rounds<0:p.error('--max-rounds must be >=0')
    run(args)
if __name__=='__main__':main()
