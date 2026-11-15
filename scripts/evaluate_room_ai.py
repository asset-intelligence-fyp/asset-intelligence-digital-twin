"""Evaluate frozen room-window cases. Labels are never sent to the model.

This is an evaluation runner/scorer, not evidence that any model meets the brief.
"""
import argparse
import csv
import json
import math
import hashlib
import platform
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def metrics(truth, predictions):
    if len(truth)!=len(predictions):raise ValueError('Every labelled case requires a prediction or explicit abstention')
    counts = dict(tp=0, tn=0, fp=0, fn=0, abstentions=0)
    for label, prediction in zip(truth, predictions):
        if prediction is None:
            counts['abstentions'] += 1
        else:
            counts[('tp' if label else 'fp') if prediction else ('fn' if label else 'tn')] += 1
    tp, tn, fp, fn = (counts[k] for k in ('tp', 'tn', 'fp', 'fn'))
    n = len(truth); correct = tp + tn; answered = n - counts['abstentions']
    divide = lambda a,b: a/b if b else None
    recall = divide(tp, sum(truth))  # positive abstentions count as missed detections
    specificity = divide(tn, n-sum(truth))
    p = correct/n if n else 0; z = 1.96; denom = 1+z*z/n if n else 1
    center = (p+z*z/(2*n))/denom if n else None
    half = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom if n else None
    return {**counts, 'total':n, 'positive_cases':sum(truth), 'negative_cases':n-sum(truth),
            'accuracy_all_cases':divide(correct,n), 'accuracy_answered_only':divide(correct,answered),
            'coverage':divide(answered,n), 'precision':divide(tp,tp+fp), 'recall_all_positive_cases':recall,
            'specificity_all_negative_cases':specificity,
            'balanced_accuracy':(recall+specificity)/2 if recall is not None and specificity is not None else None,
            'f1':2*tp/(2*tp+fp+sum(truth)-tp) if 2*tp+fp+sum(truth)-tp else None,
            'accuracy_wilson_95_interval':[max(0,center-half),min(1,center+half)] if n else None}

def load_cases(path):
    with path.open(newline='', encoding='utf-8') as f: cases=list(csv.DictReader(f))
    if not cases: raise ValueError('No labelled cases supplied; accuracy is not measurable.')
    ids=set(); groups=set()
    for c in cases:
        if not c.get('case_id') or c['case_id'] in ids: raise ValueError('Case IDs must be unique')
        if c.get('split')!='test': raise ValueError('Only predeclared held-out test cases may be scored')
        if c.get('y_true') not in ('0','1'): raise ValueError('Labels must be 0 or 1')
        if c.get('label_source') not in ('synthetic_injection','reviewed_maintenance'): raise ValueError('Declare label_source explicitly')
        if not c.get('event_group') or c['event_group'] in groups: raise ValueError('Use one preselected window per independent event/normal group')
        ids.add(c['case_id']);groups.add(c['event_group'])
    if len({c['label_source'] for c in cases})>1: raise ValueError('Score synthetic and maintenance cases in separate runs')
    return cases

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--predictions',type=Path,help='Existing JSONL records: case_id and full response object')
    ap.add_argument('--run',action='store_true',help='Call local Qwen on each request_file; can take minutes')
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--history-db',default='')
    args=ap.parse_args(argv)
    if bool(args.predictions)==args.run:ap.error('Choose --run OR --predictions')
    cases=load_cases(args.manifest); predictions={}
    if args.predictions:
        for line in args.predictions.read_text().splitlines():
            item=json.loads(line)
            if item['case_id'] in predictions:raise ValueError('Duplicate prediction')
            predictions[item['case_id']]=item
        if set(predictions)-{c['case_id'] for c in cases}:raise ValueError('Predictions contain unknown case IDs')
    else:
        from llm_service.validated_room import analyse_validated
        from llm_service.shared_llm.ollama import OllamaClient
        for c in cases:
            try:
                request=json.loads((args.manifest.parent/c['request_file']).read_text())
                if set(request)-{'question','room_id','room_name','source','as_of','points','history'}:
                    raise ValueError('Request file contains unapproved fields; keep labels separate')
                if request.get('source')!='http':raise ValueError('Use frozen simulator HTTP evidence, not browser-random snapshots')
                response=analyse_validated(request,{'model':'qwen3:1.7b','prompt':'concise','validation_mode':'hybrid_semantic','history_db':args.history_db},lambda m:OllamaClient(model=m,timeout=150,temperature=0))
                predictions[c['case_id']]={'case_id':c['case_id'],'response':response}
            except Exception as e:
                predictions[c['case_id']]={'case_id':c['case_id'],'error':str(e)}
            print('Completed',c['case_id'],flush=True)
    truth=[int(c['y_true']) for c in cases]; model=[];triage=[]
    for c in cases:
        r=predictions.get(c['case_id'],{}).get('response',{})
        value=r.get('decision_assessment',{}).get('llm_alert_scorable')
        model.append(value if type(value) is bool else None)
        status=r.get('status')
        triage.append(True if status in ('alert','review_required') else False if status=='no_alert' else None)
    raw=metrics(truth,model); operational=metrics(truth,triage)
    valid_classes=bool(sum(truth) and sum(truth)<len(truth))
    maintenance=cases[0]['label_source']=='reviewed_maintenance'
    report={'evaluation_version':1,'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'prediction_origin':'local_inference' if args.run else 'supplied_responses','python':platform.python_version(),'platform':platform.platform(),'label_source':cases[0]['label_source'],'model':'qwen3:1.7b','model_decision':raw,'operational_triage':operational,
            'minimum_accuracy':.85,'numeric_target_reached':bool(valid_classes and raw['coverage']==1 and raw['accuracy_all_cases']>=.85),
            'brief_maintenance_basis_available':maintenance,
            'notice':'Synthetic injection is a development test, not the brief maintenance-event acceptance test. Freeze cases, onsets, windows, prompt/model settings and historical reference before running. Do not tune on this test set. Review-required is an escalation, not a confirmed fault. Wilson interval assumes independent cases.',
            'missing_prediction_ids':[c['case_id'] for c in cases if c['case_id'] not in predictions]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    args.output.with_suffix('.predictions.jsonl').write_text(''.join(json.dumps(p)+'\n' for p in predictions.values()))
    print(json.dumps(report,indent=2))
    return 0

if __name__=='__main__':sys.exit(main())
