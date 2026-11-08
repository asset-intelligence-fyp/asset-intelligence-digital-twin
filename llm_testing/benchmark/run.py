"""Controlled inference: same evidence + prompt for all models; no answer-key access."""
from __future__ import annotations
import argparse,json,os,time,urllib.request,urllib.error,hashlib,sys
from pathlib import Path
from .common import *

def request(endpoint,body=None,timeout=240):
    base=os.environ.get('OLLAMA_URL','http://localhost:11434').rstrip('/')
    req=urllib.request.Request(base+endpoint,data=(json.dumps(body).encode() if body is not None else None),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=timeout) as r:return json.load(r)

def model_info(model):
    tags=request('/api/tags')['models'];found=next((x for x in tags if x['name']==model or x['model']==model),None)
    if not found:raise RuntimeError(f'{model} is not installed. Run ollama pull {model}')
    info=request('/api/show',{'model':model})
    return {'tag':model,'digest':found.get('digest'),'details':found.get('details',{}),'model_info':info.get('model_info',{})}

def parse(raw):
    if not raw:return None
    try:return json.loads(raw)
    except json.JSONDecodeError:
        start,end=raw.find('{'),raw.rfind('}')
        if start>=0 and end>start:
            try:return json.loads(raw[start:end+1])
            except ValueError:pass
    return None

def validate(pred,task):
    if not isinstance(pred,dict):return False
    if task=='anomaly':return type(pred.get('anomaly')) is bool and isinstance(pred.get('explanation'),str)
    if task=='forecast':return pred.get('overall_condition') in ('normal','watch','warning','unknown') and pred.get('overall_trend') in ('stable','improving','deteriorating','uncertain') and (pred.get('predicted_mean') is None or isinstance(pred.get('predicted_mean'),(int,float)))
    return False

def run(task='anomaly',models=MODELS,prepared=None,prompt='P2_historical_pattern',limit=0,run_id='comparison',temperature=0,timeout=240):
    if task not in ['anomaly','forecast']:raise ValueError(task)
    base=Path(prepared or OUT/'prepared');fname='anomaly_inputs.jsonl' if task=='anomaly' else 'forecast_inputs.jsonl'
    path=base/fname
    cases=list(load_jsonl(path))
    if limit:cases=cases[:limit]
    promptpath=ROOT/'prompts'/f'{prompt}.txt'
    text=promptpath.read_text(encoding='utf8')
    if prompt=='P0_website_original':raise ValueError('Original website prompt is for compatibility only, not standard model selection')
    if task=='anomaly' and prompt=='P4_prediction':raise ValueError('Prediction prompt on anomaly cases')
    if task=='forecast' and prompt!='P4_prediction':raise ValueError('Use P4_prediction for forecast cases')
    phash=hashlib.sha256(text.encode()).hexdigest()
    output=OUT/f'{task}_{run_id}.jsonl'
    if output.exists():raise FileExistsError(f'Run exists: {output}; pick a new --run-id')
    infos={m:model_info(m) for m in models}
    def records():
        for case in cases:
            check_evidence(case)
            evidence=json.dumps(case,ensure_ascii=False,separators=(',',':'))
            for model in models:
                rec={'task':task,'case_id':case['case_id'],'model':model,'as_of':case.get('as_of',case.get('as_of_date')),
                    'prompt':prompt,'prompt_hash':phash,'evidence_sha256':hashlib.sha256(evidence.encode()).hexdigest(),
                    'temperature':temperature,'model_info':infos[model],'raw':None,'parsed':None,'valid':False,'error':None}
                messages=[{'role':'system','content':text},{'role':'user','content':'Analyse the attached historical time series and context. Decide independently. Output JSON only. Evidence:\n'+evidence}]
                start=time.perf_counter()
                try:
                    body={'model':model,'messages':messages,'stream':False,'format':'json','options':{'temperature':temperature}}
                    result=request('/api/chat',body,timeout=timeout)
                    rec['raw']=result.get('message',{}).get('content','')
                    rec['parsed']=parse(rec['raw']);rec['valid']=validate(rec['parsed'],task)
                    rec['prompt_eval_count']=result.get('prompt_eval_count');rec['eval_count']=result.get('eval_count')
                    rec['total_duration_ns']=result.get('total_duration')
                except Exception as exc:rec['error']=f'{type(exc).__name__}: {exc}'
                rec['latency_s']=round(time.perf_counter()-start,3)
                yield rec
                print(task,case['case_id'],model,'valid' if rec['valid'] else 'INVALID',f"{rec['latency_s']}s",flush=True)
    write_jsonl(output,records())
    print('Saved raw predictions:',output)
    return output
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--task',choices=['anomaly','forecast'],default='anomaly');p.add_argument('--models',nargs='+',default=MODELS);p.add_argument('--prepared');p.add_argument('--prompt');p.add_argument('--limit',type=int,default=0);p.add_argument('--run-id',default='comparison');p.add_argument('--temperature',type=float,default=0);p.add_argument('--timeout',type=int,default=240);a=p.parse_args();run(a.task,a.models,a.prepared,a.prompt or ('P2_historical_pattern' if a.task=='anomaly' else 'P4_prediction'),a.limit,a.run_id,a.temperature,a.timeout)
