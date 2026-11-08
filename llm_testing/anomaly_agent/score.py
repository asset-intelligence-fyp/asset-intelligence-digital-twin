"""Evaluate ONLY after inference; NEVER import this module into the LLM tools."""
from __future__ import annotations
import argparse,json
from pathlib import Path

def read(path):
    with open(path,encoding='utf8') as f: return {r['case_id']:r for line in f if (r:=json.loads(line))}

def score(preds,truth):
    p=read(preds);t=read(truth);tp=tn=fp=fn=invalid=0
    for cid,r in p.items():
        if cid not in t:raise ValueError(f'Unknown case {cid}')
        actual=t[cid]['anomaly'];pred=r.get('predicted_alert')
        if type(pred) is not bool:invalid+=1;continue
        if pred and actual:tp+=1
        elif pred:fp+=1
        elif actual:fn+=1
        else:tn+=1
    n=len(p);valid=tp+tn+fp+fn
    precision=tp/(tp+fp) if tp+fp else 0
    recall=tp/(tp+fn) if tp+fn else 0
    return {'n':n,'valid':valid,'invalid':invalid,'coverage':valid/n if n else None,
     'tp':tp,'tn':tn,'fp':fp,'fn':fn,'accuracy_covered':(tp+tn)/valid if valid else None,
     'accuracy_all_correct_over_total':(tp+tn)/n if n else None,
     'precision':precision,'recall':recall,'f1':2*precision*recall/(precision+recall) if precision+recall else 0,
     'note':'Small balanced pilot, not representative final performance. Missing/invalid do not become normal.'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--predictions',required=True);p.add_argument('--truth',required=True);p.add_argument('--out');a=p.parse_args()
    metrics=score(a.predictions,a.truth);print(json.dumps(metrics,indent=2))
    if a.out:Path(a.out).write_text(json.dumps(metrics,indent=2),encoding='utf8')
