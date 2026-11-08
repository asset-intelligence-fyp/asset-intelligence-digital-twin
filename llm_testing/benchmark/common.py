from __future__ import annotations
import csv, io, json, hashlib, zipfile, os
from pathlib import Path
from datetime import datetime
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'outputs'
INPUT=os.environ.get('INPUT_ZIP',str(ROOT.parent/'malaysian_office_v4_llm_inputs_ONLY.zip'))
KEYS=os.environ.get('KEYS_ZIP',str(ROOT.parent/'malaysian_office_v4_evaluation_KEYS.zip'))
MODELS=['qwen3:1.7b','qwen3:4b','llama3.2:3b','gemma3:4b']
FORBIDDEN=('ground_truth','_HIDDEN','_KEYS','scenario_HIDDEN')
def read_csv(zpath,name):
    with zipfile.ZipFile(zpath) as z:
        matched=[n for n in z.namelist() if n.endswith('/'+name)]
        if len(matched)>1 and name in {'sensor_history.csv','training_features.csv','weather_5min.csv','headcount.csv','hvac_state.csv'}:
            matched=[n for n in matched if '/generated/anomaly_eval_2026_q1/' in n]
        if len(matched)!=1:raise ValueError(f'Expected exactly one {name} in {zpath}; found {matched}')
        with z.open(matched[0]) as fd:
            yield from csv.DictReader(io.TextIOWrapper(fd,encoding='utf-8-sig'))
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,ensure_ascii=False).encode()).hexdigest()
def write_jsonl(path,records):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():raise FileExistsError(f'Refusing to overwrite existing output {path}')
    with path.open('w',encoding='utf8') as f:
        for x in records:f.write(json.dumps(x,ensure_ascii=False,default=str)+'\n')
def load_jsonl(path):
    with open(path,encoding='utf8') as f:
        for s in f:
            if s.strip():yield json.loads(s)
def fnum(x):
    try:return float(x)
    except (ValueError,TypeError):return None
def stamp(t):return datetime.fromisoformat(t.replace('Z','+00:00'))
def check_evidence(data):
    packed=json.dumps(data).lower()
    for token in ['ground_truth','_hidden','fault_active','event_id','scenario_hidden','actual_future_']:
        if token in packed:raise ValueError('Hidden/evaluation field leaked into evidence: '+token)
