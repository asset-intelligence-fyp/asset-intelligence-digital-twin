"""Original shared_llm agent + Dataset v4 case-bound read-only tools; keep truth outside inference."""
from __future__ import annotations
import argparse,json,random,traceback
from pathlib import Path
from reference.llm_service.shared_llm.agent import run_agent
from reference.llm_service.shared_llm.ollama import OllamaClient
from .v4_tools import V4CaseTools

ROOT=Path(__file__).resolve().parent.parent

def read_jsonl(path):
    with open(path,encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--cases',default=str(ROOT/'outputs/prepared/anomaly_inputs.jsonl'))
    p.add_argument('--model',default='qwen3:1.7b');p.add_argument('--limit',type=int,default=6)
    p.add_argument('--out',default=str(ROOT/'outputs/anomaly_agent_pilot.jsonl'))
    p.add_argument('--prompt',choices=['baseline','concise','fewshot'],default='concise')
    p.add_argument('--seed',type=int,default=42)
    args=p.parse_args()
    cases=read_jsonl(args.cases)
    positive=[c for c in cases if c['case_id'].startswith('A')]
    negative=[c for c in cases if c['case_id'].startswith('N')]
    if not positive or not negative:raise SystemExit('Pilot needs both positive and normal control case IDs')
    rng=random.Random(args.seed)
    half=max(1,args.limit//2)
    chosen=rng.sample(positive,min(half,len(positive)))+rng.sample(negative,min(args.limit-half,len(negative)))
    rng.shuffle(chosen)
    output=Path(args.out);output.parent.mkdir(parents=True,exist_ok=True)
    client=OllamaClient(model=args.model,timeout=240,temperature=0)
    with output.open('w',encoding='utf8') as out:
        for c in chosen:
            t=V4CaseTools(c)
            sid=c['sensor']['sensor_id'];unit=c['sensor']['unit'];room=c['sensor']['room_id']
            question=(f'At {c["as_of"]}, assess whether sensor {sid} ({c["sensor"]["sensor_type"]}, {unit}) '
               f'in room {room} shows unusual behavior. Use tools for current readings, historical normal comparisons, '
               f'and operating context. Independently decide whether this needs investigation; historical normal status '
               'does not establish current normality. Cite measured values and timestamps. Do not assume a fault type.')
            result={'case_id':c['case_id'],'model':args.model}
            try:
                r=run_agent(question,t,client,prompt_variant=args.prompt,max_rounds=5,max_calls=10)
                result.update({'predicted_alert':r['result']['needs_investigation'],'valid':True,'response':r,'tool_call_count':r['tool_call_count']})
                print(f'{c["case_id"]} valid decision={result["predicted_alert"]} tools={r["tool_call_count"]} {r["elapsed_seconds"]}s',flush=True)
            except Exception as exc:
                result.update({'predicted_alert':None,'valid':False,'error':f'{type(exc).__name__}: {exc}', 'tool_trace':t.used})
                print(f'{c["case_id"]} INVALID {result["error"]}',flush=True)
            out.write(json.dumps(result,ensure_ascii=False)+'\n');out.flush()
    print('Saved',output)
if __name__=='__main__':main()
