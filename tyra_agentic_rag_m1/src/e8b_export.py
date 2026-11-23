"""Export E8-B into two evaluator-compatible label-free prediction streams."""
from __future__ import annotations
import argparse,json
from pathlib import Path


def export_channels(input_path,out_dir=None):
    input_path=Path(input_path)
    if not input_path.is_file():raise FileNotFoundError(input_path)
    out_dir=Path(out_dir) if out_dir else input_path.parent
    out_dir.mkdir(parents=True,exist_ok=True)
    screen=out_dir/(input_path.stem+'_screening.jsonl')
    verified=out_dir/(input_path.stem+'_verified.jsonl')
    if screen.resolve()==input_path.resolve() or verified.resolve()==input_path.resolve():
        raise ValueError('Cannot overwrite input predictions')
    a=[];b=[];seen=set()
    for i,line in enumerate(input_path.read_text(encoding='utf-8').splitlines(),1):
        if not line.strip():continue
        r=json.loads(line)
        if r.get('task')!='detect' or r.get('method')!='e8b':
            raise ValueError(f'Record {i} is not an E8-B anomaly output')
        k=(r.get('sensor_id'),r.get('origin'))
        if k in seen: raise ValueError(f'Duplicate prediction: {k}')
        seen.add(k)
        original=r.get('screening') or r.get('answer')
        if not isinstance(original,dict):raise ValueError('Missing screening channel')
        x=dict(r);x['answer']=dict(original);x['method']='e8b_screening'
        y=dict(r);y['method']='e8b_verified'
        ver=r.get('verification') or {}
        y['answer']={**dict(original),
                     'status':r.get('verified_status','unknown'),
                     'confidence':0.0,
                     'anomaly_type':'unspecified',
                     'evidence_timestamps':[],
                     'explanation':str(ver.get('explanation',''))}
        a.append(json.dumps(x,ensure_ascii=False,default=str)+'\n')
        b.append(json.dumps(y,ensure_ascii=False,default=str)+'\n')
    if not a:raise ValueError('No E8-B predictions found')
    for path,items in ((screen,a),(verified,b)):
        path.write_text(''.join(items),encoding='utf-8')
    return screen,verified,len(a)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',required=True)
    p.add_argument('--out-dir',default=None)
    args=p.parse_args()
    a,b,n=export_channels(args.input,args.out_dir)
    print(f'Wrote {n} records per channel:')
    print(' SCREENING:',a)
    print(' VERIFIED:',b)
    print("Evaluate with --suspect alert; never count unknown as normal.")

if __name__=='__main__':main()
