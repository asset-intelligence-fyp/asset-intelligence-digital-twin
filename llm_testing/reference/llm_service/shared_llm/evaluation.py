"""Create blind test cases from fault CSVs and score outputs; NEVER import labels into retrieval DB."""
from __future__ import annotations
import csv
import json
import random
from collections import Counter
from datetime import datetime,timedelta
from pathlib import Path

def write_jsonl(path,records):
    out=Path(path);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('w',encoding='utf8') as f:
        for r in records:f.write(json.dumps(r,ensure_ascii=False)+'\n')

def read_jsonl(path):
    with open(path,encoding='utf8') as f:
        for line in f:
            if line.strip():yield json.loads(line)

def make_cases(fault_dir,public_path,key_path,positives=18,negatives=18,seed=42):
    folder=Path(fault_dir)
    if Path(public_path).resolve()==Path(key_path).resolve():raise ValueError('Public and answer-key paths must differ')
    rng=random.Random(seed)
    with (folder/'ground_truth_events.csv').open(newline='',encoding='utf8') as f:
        events=list(csv.DictReader(f))
    if not events:raise ValueError('No events found')
    rng.shuffle(events)
    chosen=events[:positives]
    positives_list=[]
    for evt in chosen:
        first=datetime.fromisoformat(evt['start']); end=datetime.fromisoformat(evt['end'])
        midpoint=first+timedelta(minutes=(int((end-first).total_seconds()/60)//10)*5)
        midpoint=midpoint.replace(second=0,microsecond=0)
        positives_list.append({'sensor_id':evt['sensor_id'],'room_id':evt['room_id'],
                              'at_time':midpoint.isoformat(),'label':1,'event_id':evt['event_id'],
                              'scenario':evt['scenario']})
    # Reservoir sample negative labels WITHOUT loading 466k rows into memory.
    controls=[]; seen=0
    with (folder/'ground_truth_labels.csv').open(newline='',encoding='utf8') as f:
        for row in csv.DictReader(f):
            if row.get('fault_active')!='0':continue
            seen+=1
            record={'sensor_id':row['sensor_id'],'room_id':row['room_id'],
                    'at_time':row['timestamp'],'label':0,'event_id':'','scenario':'normal'}
            if len(controls)<negatives:controls.append(record)
            else:
                index=rng.randrange(seen)
                if index<negatives:controls[index]=record
    chosen=positives_list+controls
    rng.shuffle(chosen)
    public=[];key=[]
    for j,rec in enumerate(chosen):
        case_id=f'C{j+1:04d}'
        public.append({'case_id':case_id,'dataset':'fault','sensor_id':rec['sensor_id'],
                       'room_id':rec['room_id'],'at_time':rec['at_time'],
                       'question':f"At {rec['at_time']}, is sensor {rec['sensor_id']} in room {rec['room_id']} behaving unusually? Retrieve evidence and explain."})
        key.append({'case_id':case_id,'fault_active':rec['label'],
                    'scenario':rec['scenario'],'event_id':rec['event_id']})
    write_jsonl(public_path,public);write_jsonl(key_path,key)
    return {'public_cases':len(public),'positives':len(positives_list),'negatives':len(controls),
            'public_path':str(public_path),'key_path':str(key_path),
            'warning':'Never attach answer_key to the LLM or include it in the retrieval database.'}

def score(public_results_path,key_path):
    answers={r['case_id']:r for r in read_jsonl(key_path)}
    guesses={r['case_id']:r for r in read_jsonl(public_results_path)}
    metrics=Counter()
    for case_id,item in answers.items():
        predicted=guesses.get(case_id)
        if predicted is None or predicted.get('predicted_alert') is None:
            metrics['abstained_or_missing']+=1;continue
        flag=predicted['predicted_alert']
        if type(flag) is not bool:raise ValueError(f'Nonboolean prediction: {case_id}')
        actual=bool(int(item['fault_active']))
        metrics['TP' if flag and actual else 'FP' if flag else 'FN' if actual else 'TN']+=1
    tp,fp,fn,tn=(metrics[k] for k in ('TP','FP','FN','TN'))
    precision=tp/(tp+fp) if tp+fp else 0
    recall=tp/(tp+fn) if tp+fn else 0
    return {'counts':dict(metrics),'scored':tp+fp+fn+tn,'total_cases':len(answers),
            'precision':round(precision,4),'recall':round(recall,4),
            'f1':round(2*precision*recall/(precision+recall),4) if precision+recall else 0,
            'limitations':'Event count and synthetic generator limit generalisation; this is not real-world fault diagnosis.'}
