#!/usr/bin/env python3
"""Run a frozen label-free E7 manifest through the existing src.cli batch command.

This runner NEVER reads ground-truth labels or the private selection audit.
It validates each case's predicted timestamps and refuses duplicate cases or
inference errors before atomically creating a combined result JSONL file.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

STEP=timedelta(minutes=5)

def parse(s):
    dt=datetime.fromisoformat(s.replace('Z','+00:00'))
    if dt.tzinfo is None: raise ValueError(f'Naive timestamp: {s}')
    return dt.astimezone(timezone.utc)

def digest(data):
    return hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def validate_case(case):
    for key in ('case_id','sensor_id','start','limit','stride'):
        if key not in case:raise ValueError(f'Manifest case missing {key}')
    if int(case['limit']) < 1 or int(case['stride']) < 1:
        raise ValueError(f'Invalid limit/stride for {case["case_id"]}')
    parse(case['start'])

def read_records(path,case,known=None,method="e7"):
    records=[json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    if len(records)!=int(case['limit']):
        raise ValueError(f'{path}: expected {case["limit"]} records, got {len(records)}')
    expected=parse(case['start'])
    for i,r in enumerate(records):
        origin=parse(r['origin'])
        if origin != expected + i*int(case['stride'])*STEP or r.get('sensor_id')!=case['sensor_id']:
            raise ValueError(f'Wrong timestamps/sensor in {path} row {i+1}')
        if r.get('method')!=method or r.get('valid') is not True:
            raise ValueError(f'Invalid E7 prediction in {path}, row {i+1}: {r.get("error")}')
        if known is not None:
            k=(r['sensor_id'],origin)
            if k in known:raise ValueError(f'Duplicate prediction: {k}')
            known.add(k)
    return records

def run(args):
    m=json.loads(args.manifest.read_text(encoding='utf-8'))
    cases=m.get('cases') or []
    if not cases or m.get('cases_sha256')!=digest(cases):
        raise ValueError('Empty or modified manifest (checksum mismatch)')
    if len({x['case_id'] for x in cases})!=len(cases):
        raise ValueError('Duplicate case IDs')
    for case in cases:validate_case(case)
    total=sum(int(c['limit']) for c in cases)
    print(f'Frozen manifest for {args.method}: {len(cases)} cases, {total} 5-minute predictions')
    print('Case list SHA256:',m['cases_sha256'])
    if args.dry_run:
        for c in cases[:5]:
            print('DRY RUN',c['case_id'],c['sensor_id'],c['start'],f"limit={c['limit']}")
        if len(cases)>5:print(f'... {len(cases)-5} more cases')
        return
    if not Path('src/cli.py').is_file():
        raise FileNotFoundError('Run this script from your tyra_agentic_rag_m1 project root')
    out_dir=args.out_dir or Path(f'results/{args.method}_final_cases')
    combined=args.combined or Path(f'results/{args.method}_final_all.jsonl')
    out_dir.mkdir(parents=True,exist_ok=True)
    if combined.exists():
        raise FileExistsError(f'Combined file already exists; frozen test results cannot be overwritten: {combined}')
    seen=set(); results=[]
    for idx,case in enumerate(cases,1):
        outfile=out_dir / f"{case['case_id']}.jsonl"
        if outfile.exists():
            if not args.resume:
                raise FileExistsError(f'{outfile} exists; pass --resume to validate and reuse')
            records=read_records(outfile,case,seen,args.method)
            print(f'[{idx}/{len(cases)}] REUSED {case["case_id"]}')
        else:
            cmd=[sys.executable,'-m','src.cli','batch','--task','detect','--method',args.method,
                 '--sensor',case['sensor_id'],'--start',case['start'],
                 '--stride',str(case['stride']),'--limit',str(case['limit']),
                 '--max-rounds',str(args.max_rounds),'--out',str(outfile)]
            print(f'[{idx}/{len(cases)}] Running {case["case_id"]} ({case["sensor_id"]})',flush=True)
            subprocess.run(cmd,check=True)
            records=read_records(outfile,case,seen,args.method)
        results.extend(records)
    combined.parent.mkdir(parents=True,exist_ok=True)
    temp=combined.with_suffix(combined.suffix+'.tmp')
    with temp.open('w',encoding='utf-8') as f:
        for rec in results:f.write(json.dumps(rec,ensure_ascii=False)+'\n')
    temp.replace(combined)
    print(f'Combined {len(results)} validated predictions: {combined}')
    print('Inference completed without reading ground truth.')

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',type=Path,default=Path('evaluation/E7_frozen_manifest.json'))
    ap.add_argument('--out-dir',type=Path,default=None)
    ap.add_argument('--combined',type=Path,default=None)
    ap.add_argument('--method',choices=['e7','baseline','traditional'],default='e7')
    ap.add_argument('--max-rounds',type=int,default=2)
    ap.add_argument('--dry-run',action='store_true')
    ap.add_argument('--resume',action='store_true',help='Validate and reuse previously complete case files')
    args=ap.parse_args()
    if args.max_rounds<0:ap.error('--max-rounds cannot be negative')
    run(args)
if __name__=='__main__':main()
