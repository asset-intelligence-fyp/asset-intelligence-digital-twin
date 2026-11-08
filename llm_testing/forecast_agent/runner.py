"""Original shared_llm-style tool calling for 90-day forecast evaluation.
No answers are accessible to this process; it only reads prepared forecast input cases.
"""
from __future__ import annotations
import argparse, hashlib, json, os, time, urllib.request, urllib.error
from pathlib import Path
from benchmark.common import OUT, MODELS, load_jsonl, write_jsonl, check_evidence
from .tools import ForecastTools

PROMPT="""You are a Malaysian office Digital Twin forecasting agent. The only available evidence is retrieved sensor history and forecast-origin-known schedule/climatology. Your task: predict conditions for the NEXT 90 DAYS (13 weeks), not merely describe current normality. Use tools to inspect actual historical trends, seasonality, rain, office occupancy and energy where available. Do not assume correlations are causal. Analyze gradual cooling deterioration, ventilation deterioration, moisture intrusion, staffing effects and normal rainy-season changes. Do not confuse headcount with humidity or rainfall. Historical `status`, if present, refers ONLY to historical observations, not the future target. You MUST call retrieval tools before your final answer. All tools provide data only, not future ground truth. Do not request tools that do not exist. If evidence is insufficient, give uncertainty and explicit assumptions. Numeric predicted_mean should use the unit of the selected sensor; for scenario cases with several sensor types and no single target unit, use null. Give overall_condition: normal/watch/warning/unknown; overall_trend: stable/improving/deteriorating/uncertain. Provide concise evidence-based explanation. Never invent a measured future result."""
SCHEMA={'type':'object','properties':{
 'predicted_mean':{'type':['number','null']},
 'overall_condition':{'type':'string','enum':['normal','watch','warning','unknown']},
 'overall_trend':{'type':'string','enum':['stable','improving','deteriorating','uncertain']},
 'explanation':{'type':'string'},
 'evidence':{'type':'array','items':{'type':'string'}},
 'assumptions':{'type':'array','items':{'type':'string'}},
 'uncertainty':{'type':'string'},
 'weekly_outlook':{'type':'array','items':{'type':'object','properties':{
  'week':{'type':'integer'},'trend':{'type':'string','enum':['stable','improving','deteriorating','uncertain']},
  'condition':{'type':'string','enum':['normal','watch','warning','unknown']}},
  'required':['week','trend','condition'],'additionalProperties':False}}
 },'required':['predicted_mean','overall_condition','overall_trend','explanation','evidence','assumptions','uncertainty','weekly_outlook'],
 'additionalProperties':False}

def chat(model,messages,tools=None,schema=None,timeout=240,thinking=False):
 body={'model':model,'messages':messages,'stream':False,
       'options':{'temperature':0,'num_predict':2048}}
 # Not all model families support Ollama thinking. Restrict explicit think to Qwen3.
 if model.startswith('qwen3:'):body['think']=bool(thinking)
 if tools is not None:body['tools']=tools
 if schema is not None:body['format']=schema
 req=urllib.request.Request(os.getenv('OLLAMA_URL','http://localhost:11434').rstrip('/')+'/api/chat',
          data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=timeout) as resp:return json.load(resp)
 except urllib.error.HTTPError as exc:
  raise RuntimeError(f'Ollama HTTP {exc.code}: {exc.read().decode("utf8",errors="replace")[:800]}') from exc

def validate(p):
 return isinstance(p,dict) and p.get('overall_condition') in ('normal','watch','warning','unknown') and p.get('overall_trend') in ('stable','improving','deteriorating','uncertain') and (p.get('predicted_mean') is None or type(p.get('predicted_mean')) in (int,float)) and isinstance(p.get('explanation'),str) and isinstance(p.get('evidence'),list) and isinstance(p.get('weekly_outlook'),list) and len(p['weekly_outlook'])==13 and [w.get('week') for w in p['weekly_outlook']]==list(range(1,14))

def run_case(packet,model,timeout=240,max_rounds=4,max_calls=8,thinking=False):
 tools=ForecastTools(packet)
 cid=packet['case_id'];origin=packet['as_of_date']
 messages=[{'role':'system','content':PROMPT},
           {'role':'user','content':f'Forecast case {cid}. Forecast origin {origin}. Use tools to retrieve evidence, then predict the next 90 days. Start by inspecting the sensor metadata and history.'}]
 rec={'task':'forecast','case_id':cid,'model':model,'as_of':origin,
      'prompt':'shared_agent_forecast_v1','prompt_hash':hashlib.sha256(PROMPT.encode()).hexdigest(),
      'thinking':thinking if model.startswith('qwen3:') else 'unsupported_or_not_requested',
      'tool_trace':[],'tool_call_count':0,'raw':None,'parsed':None,'valid':False,'error':None}
 started=time.perf_counter()
 try:
  for round_idx in range(max_rounds):
   response=chat(model,messages,tools=tools.specifications(),timeout=timeout,thinking=thinking)
   msg=response.get('message') or {};requested=msg.get('tool_calls') or []
   if not requested:break
   messages.append({'role':'assistant','content':msg.get('content') or '', 'tool_calls':requested})
   for call in requested:
    if rec['tool_call_count']>=max_calls:raise RuntimeError('Tool call budget exceeded')
    f=call.get('function') or {};name=f.get('name','');args=f.get('arguments') or {}
    if isinstance(args,str):args=json.loads(args)
    try:result=tools.execute(name,args)
    except (ValueError,TypeError,KeyError) as exc:
     result={'error':str(exc),'tool_name':name}
     tools.used.append({'tool':name,'arguments':args,'result':result,'status':'error'})
    tool_payload=json.dumps(result,ensure_ascii=False)
    if len(tool_payload)>24000:
     tool_payload=json.dumps({'error':'Tool result too long; request fewer days/weeks','chars':len(tool_payload)})
    messages.append({'role':'tool','tool_name':name,'content':tool_payload})
    rec['tool_call_count']+=1
  if rec['tool_call_count']==0:raise RuntimeError('Model skipped all retrieval tools. No evidence-based forecast.')
  messages.append({'role':'user','content':'Give the final schema-constrained JSON for a 13-week forecast. Include weeks 1 through 13. Do not request more tools.'})
  response=chat(model,messages,schema=SCHEMA,timeout=timeout,thinking=thinking)
  rec['raw']=(response.get('message') or {}).get('content','')
  rec['parsed']=json.loads(rec['raw']);rec['valid']=validate(rec['parsed'])
  if not rec['valid']:rec['error']='Schema/13-week validation failed'
  rec['prompt_eval_count']=response.get('prompt_eval_count');rec['eval_count']=response.get('eval_count')
 except Exception as exc:rec['error']=f'{type(exc).__name__}: {exc}'
 rec['tool_trace']=tools.used;rec['latency_s']=round(time.perf_counter()-started,3)
 return rec

def run(prepared=None,models=None,limit=3,run_id='forecast_agent_smoke',thinking=False,timeout=240,kind='all'):
 cases=list(load_jsonl(Path(prepared or OUT/'prepared')/'forecast_inputs.jsonl'))
 if kind=='scenario':cases=[x for x in cases if x.get('forecast_kind')=='scenario']
 if kind=='historical':cases=[x for x in cases if x.get('forecast_kind')!='scenario']
 if limit:cases=cases[:limit]
 for c in cases:check_evidence(c)
 path=OUT/f'forecast_{run_id}.jsonl'
 def records():
  for case in cases:
   for model in models or ['qwen3:1.7b']:
    rec=run_case(case,model,timeout=timeout,thinking=thinking)
    print('forecast',rec['case_id'],model,'valid' if rec['valid'] else 'INVALID',
      f"tools={rec['tool_call_count']}",f"{rec['latency_s']}s",rec.get('error') or '',flush=True)
    yield rec
 write_jsonl(path,records());print('Saved:',path)
 return path

if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--prepared');p.add_argument('--models',nargs='+',default=['qwen3:1.7b']);p.add_argument('--limit',type=int,default=3)
 p.add_argument('--run-id',default='forecast_agent_smoke');p.add_argument('--think',action='store_true');p.add_argument('--timeout',type=int,default=240)
 p.add_argument('--kind',choices=['all','historical','scenario'],default='all')
 a=p.parse_args();run(a.prepared,a.models,a.limit,a.run_id,a.think,a.timeout,a.kind)
