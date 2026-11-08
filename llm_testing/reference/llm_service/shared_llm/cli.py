"""python -m shared_llm.cli --help"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
from .db import connect
from .ingest import ingest_directory
from .tools import RepositoryTools
from .ollama import OllamaClient
from .agent import run_agent
from .evaluation import make_cases,score,read_jsonl,write_jsonl

DEFAULT_DB='storage/digital_twin.sqlite'

def dump(obj):print(json.dumps(obj,indent=2,ensure_ascii=False))

def add_context(parser, *, model=False):
    parser.add_argument('--db',default=DEFAULT_DB)
    parser.add_argument('--dataset',choices=['normal','fault'],default='normal')
    parser.add_argument('--as-of',required=True,help='ISO +08:00 historical cutoff (e.g. 2025-02-07T15:00:00+08:00)')
    parser.add_argument('--retrieval',choices=['raw','summary','contextual'],default=None if model else 'contextual')
    if model:
        parser.add_argument('--model',default=None,help='Ollama model (or set in experiment config)')
        parser.add_argument('--prompt',choices=['baseline','concise','fewshot'],default=None)
        parser.add_argument('--experiment',help='JSON file: model,prompt,retrieval,temperature')
        parser.add_argument('--ollama',default=os.environ.get('OLLAMA_HOST','http://127.0.0.1:11434'))
        parser.add_argument('--temperature',type=float,default=None)

def make_client_and_tools(args,as_of=None,dataset=None):
    conf={}
    if getattr(args,'experiment',None):
        with open(args.experiment,encoding='utf8') as f:conf=json.load(f)
    prompt=args.prompt or conf.get('prompt','baseline')
    retrieval=getattr(args,'retrieval',None) or conf.get('retrieval','contextual')
    model=args.model or conf.get('model','qwen3:4b')
    temperature=args.temperature if args.temperature is not None else conf.get('temperature',0)
    tools=RepositoryTools(args.db,dataset or args.dataset,as_of or args.as_of,retrieval)
    client=OllamaClient(args.ollama,model=model,temperature=temperature)
    return client,tools,prompt

def build_parser():
    p=argparse.ArgumentParser(description='Shared Digital Twin LLM baseline: NO model training, NO embeddings')
    sub=p.add_subparsers(dest='command',required=True)
    ing=sub.add_parser('ingest',help='Stream normal and/or fault CSV folders into SQLite')
    ing.add_argument('--db',default=DEFAULT_DB)
    ing.add_argument('--normal',help='Folder containing one or multiple years of normal data')
    ing.add_argument('--fault',help='Folder containing the separate 2026 fault dataset')
    ing.add_argument('--max-rows-per-file',type=int,help='Preview only; do not use for real research')

    ls=sub.add_parser('status',help='Show imported row counts')
    ls.add_argument('--db',default=DEFAULT_DB)
    tool=sub.add_parser('tool',help='Test one retrieval tool without Ollama')
    add_context(tool)
    tool.add_argument('--name',required=True)
    tool.add_argument('--args',default='{}',help='JSON object of tool arguments')

    ask=sub.add_parser('ask',help='Ask the LLM using real tool calls')
    add_context(ask,model=True)
    ask.add_argument('--question',required=True)
    ask.add_argument('--out',help='Save the full answer and tool trace as JSON')

    mk=sub.add_parser('make-cases',help='Create BLIND evaluation cases and separate hidden answer key')
    mk.add_argument('--fault-dir',required=True)
    mk.add_argument('--public-out',default='evaluation/cases_public.jsonl')
    mk.add_argument('--key-out',default='evaluation/answer_key_PRIVATE.jsonl')
    mk.add_argument('--positives',type=int,default=18);mk.add_argument('--negatives',type=int,default=18)
    mk.add_argument('--seed',type=int,default=42)

    run=sub.add_parser('run-cases',help='Run blind cases with baseline or Ollama')
    run.add_argument('--db',default=DEFAULT_DB);run.add_argument('--cases',required=True)
    run.add_argument('--out',required=True);run.add_argument('--method',choices=['baseline','llm'],default='baseline')
    run.add_argument('--model',default=None);run.add_argument('--prompt',default=None)
    run.add_argument('--retrieval',choices=['raw','summary','contextual'],default=None)
    run.add_argument('--experiment');run.add_argument('--ollama',default='http://127.0.0.1:11434')
    run.add_argument('--temperature',type=float,default=None);run.add_argument('--limit',type=int,default=36)
    run.set_defaults(dataset='fault',as_of='2026-04-01T00:00:00+08:00')

    scorep=sub.add_parser('score',help='Score output predictions against private labels after inference')
    scorep.add_argument('--results',required=True);scorep.add_argument('--key',required=True)
    return p

def main(argv=None):
    args=build_parser().parse_args(argv)
    if args.command=='ingest':
        if not args.normal and not args.fault:raise SystemExit('Provide --normal and/or --fault')
        output=[]
        for dataset,folder in [('normal',args.normal),('fault',args.fault)]:
            if folder:output.extend(ingest_directory(args.db,folder,dataset,max_rows_per_file=args.max_rows_per_file))
        dump({'imported_files':len(output),'db':args.db,'note':'Hidden ground-truth labels are intentionally NOT imported'})
    elif args.command=='status':
        with connect(args.db,readonly=True) as db:
            results={table:[dict(row) for row in db.execute(f'SELECT dataset,COUNT(*) AS rows FROM {table} GROUP BY dataset')]
                     for table in ('sensor_readings','room_features','headcount','calendar','bookings')}
        dump(results)
    elif args.command=='tool':
        tools=RepositoryTools(args.db,args.dataset,args.as_of,args.retrieval)
        dump(tools.execute(args.name,json.loads(args.args)))
    elif args.command=='ask':
        client,tools,prompt=make_client_and_tools(args)
        result=run_agent(args.question,tools,client,prompt_variant=prompt)
        dump(result)
        if args.out:
            Path(args.out).parent.mkdir(parents=True,exist_ok=True)
            Path(args.out).write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')
    elif args.command=='make-cases':
        if args.positives<1 or args.negatives<1:raise SystemExit('Case counts must be positive')
        dump(make_cases(args.fault_dir,args.public_out,args.key_out,args.positives,args.negatives,args.seed))
    elif args.command=='run-cases':
        cases=list(read_jsonl(args.cases))[:args.limit]
        if args.limit<1:raise SystemExit('--limit must be >=1')
        predictions=[]
        for c in cases:
            t=RepositoryTools(args.db,'fault',c['at_time'],'contextual')
            if args.method=='baseline':
                val=t.compare_to_baseline(c['sensor_id'],c['at_time'])
                pred=val.get('flagged_for_investigation') if val.get('status')=='ok' else None
                record={'case_id':c['case_id'],'predicted_alert':pred,'method':'baseline','evidence':val}
            else:
                client,lt,prompt=make_client_and_tools(args,as_of=c['at_time'],dataset='fault')
                try:
                    response=run_agent(c['question'],lt,client,prompt_variant=prompt)
                    pred=response['result']['needs_investigation']
                    record={'case_id':c['case_id'],'predicted_alert':pred,'method':'llm','response':response}
                except (RuntimeError,ValueError) as exc:
                    record={'case_id':c['case_id'],'predicted_alert':None,'error':str(exc)}
            predictions.append(record)
            print(c['case_id'],predictions[-1]['predicted_alert'])
        write_jsonl(args.out,predictions)
        dump({'cases_processed':len(predictions),'out':args.out,'note':'Now score using hidden answer key; models were not given labels'})
    elif args.command=='score':dump(score(args.results,args.key))

if __name__=='__main__':main()
