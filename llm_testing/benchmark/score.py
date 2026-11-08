"""Separate evaluation process; only this module reads hidden ground truth."""
from __future__ import annotations
import argparse,collections,csv,json,math,statistics
from pathlib import Path
from .common import *

def binary_metrics(rows):
    total=len(rows);tp=tn=fp=fn=abstain=0
    for truth,pred in rows:
        if pred is None:abstain+=1
        elif truth and pred:tp+=1
        elif truth and not pred:fn+=1
        elif not truth and pred:fp+=1
        else:tn+=1
    valid=total-abstain
    div=lambda n,d:n/d if d else None
    # All-cases accuracy penalizes unknown predictions; covered accuracy does not.
    return {'n':total,'tp':tp,'tn':tn,'fp':fp,'fn':fn,'abstained':abstain,
            'accuracy_all':div(tp+tn,total),'accuracy_covered':div(tp+tn,valid),'coverage':div(valid,total),
            'precision':div(tp,tp+fp),'recall':div(tp,tp+fn+sum(1 for y,p in rows if y and p is None)),
            'specificity':div(tn,tn+fp+sum(1 for y,p in rows if not y and p is None)),
            'f1':div(2*tp,2*tp+fp+fn+sum(1 for y,p in rows if y and p is None)),
            'success_gt85':((tp+tn)/total>0.85) if total else False}

def score_anomaly(predictions,private_truth):
    truth={r['case_id']:r for r in load_jsonl(private_truth)}
    grouped=collections.defaultdict(list)
    for r in load_jsonl(predictions):grouped[r['model']].append(r)
    result=[]
    for model,recs in grouped.items():
        ids=[r['case_id'] for r in recs]
        if len(ids)!=len(set(ids)):raise ValueError('Duplicate model/case predictions')
        if set(ids)!=set(truth):raise ValueError(f'{model}: predictions do not cover the full prepared test; missing {len(set(truth)-set(ids))}. Use --allow-partial for smoke test reporting only.')
        pairs=[(truth[r['case_id']]['anomaly'],r['parsed'].get('anomaly') if r.get('valid') else None) for r in recs]
        metrics=binary_metrics(pairs);metrics.update({'model':model,'task':'anomaly','valid_response_rate':sum(r['valid'] for r in recs)/len(recs), 'mean_latency_s':statistics.mean(r['latency_s'] for r in recs)})
        metrics['by_fault_type']={}
        for fault in sorted(set(truth[r['case_id']]['fault_type'] for r in recs)):
            frows=[pair for pair,r in zip(pairs,recs) if truth[r['case_id']]['fault_type']==fault]
            metrics['by_fault_type'][fault]=binary_metrics(frows)
        result.append(metrics)
    return result

def macro_f1(pairs,labels):
    vals=[]
    for label in labels:
        tp=sum(t==label and p==label for t,p in pairs)
        fp=sum(t!=label and p==label for t,p in pairs)
        fn=sum(t==label and p!=label for t,p in pairs)
        vals.append((2*tp/(2*tp+fp+fn)) if 2*tp+fp+fn else 0)
    return sum(vals)/len(vals) if vals else None

def score_forecast(predictions,keys_zip=KEYS):
    historical={(r['sensor_id'],r['as_of_date']):r for r in read_csv(keys_zip,'forecast_90day_targets_HIDDEN.csv')}
    scenarios={r['case_id']:r for r in read_csv(keys_zip,'forecast_cases_truth_summary_HIDDEN.csv')}
    grouped=collections.defaultdict(list)
    for r in load_jsonl(predictions):grouped[r['model']].append(r)
    results=[]
    for model,recs in grouped.items():
        numeric=collections.defaultdict(list);condition=[];trend=[];scen_condition=[];scen_trend=[]
        for r in recs:
            p=r.get('parsed') if r.get('valid') else None
            if p is None:continue
            if r['case_id'].startswith('H_'):
                # Case ID uses H_<sensor_id>_<origin ISO date>.
                suffix=r['case_id'][2:];sid,origin=suffix.rsplit('_',1)
                target=historical.get((sid,origin))
                if target is None:continue
                pred=fnum(p.get('predicted_mean'));actual=fnum(target['actual_future_90d_mean'])
                if pred is not None and actual is not None:
                    numeric[sid].append((pred,actual))
                condition.append((target['actual_future_90d_condition'],p.get('overall_condition')))
                trend.append((target['actual_future_90d_trend'],p.get('overall_trend')))
            else:
                target=scenarios.get(r['case_id'])
                if target:
                    scen_condition.append((target['future_condition'],p.get('overall_condition')))
                    scen_trend.append((target['future_trend'],p.get('overall_trend')))
        summary={'model':model,'task':'forecast_90d','n':len(recs),'valid_response_rate':sum(r.get('valid',False) for r in recs)/len(recs),
            'condition_macro_f1_historical':macro_f1(condition,['normal','watch','warning']),
            'trend_macro_f1_historical':macro_f1(trend,['stable','improving','deteriorating']),
            'condition_macro_f1_scenarios':macro_f1(scen_condition,['normal','watch','warning']),
            'trend_macro_f1_scenarios':macro_f1(scen_trend,['stable','improving','deteriorating']),
            'mean_latency_s':statistics.mean(r['latency_s'] for r in recs)}
        summary['numeric_per_sensor']={}
        for sid,pairs in numeric.items():
            diffs=[p-a for p,a in pairs]
            summary['numeric_per_sensor'][sid]={'n':len(pairs),'mae':statistics.mean(abs(d) for d in diffs),
                'rmse':math.sqrt(statistics.mean(d*d for d in diffs)),
                'wape':sum(abs(d) for d in diffs)/sum(abs(a) for _,a in pairs) if sum(abs(a) for _,a in pairs) else None}
        results.append(summary)
    return results

def main():
 p=argparse.ArgumentParser();p.add_argument('--predictions',required=True);p.add_argument('--task',choices=['anomaly','forecast'],default='anomaly');p.add_argument('--truth',default=str(OUT/'prepared'/'anomaly_truth_PRIVATE.jsonl'));p.add_argument('--keys',default=KEYS);p.add_argument('--out');p.add_argument('--allow-partial',action='store_true');a=p.parse_args()
 if a.task=='anomaly' and a.allow_partial:
  truth={r['case_id']:r for r in load_jsonl(a.truth)};grouped=collections.defaultdict(list)
  for r in load_jsonl(a.predictions):grouped[r['model']].append(r)
  metrics=[]
  for model,recs in grouped.items():
   pairs=[(truth[r['case_id']]['anomaly'],r['parsed'].get('anomaly') if r.get('valid') else None) for r in recs];metrics.append(dict(model=model,**binary_metrics(pairs),WARNING='SMOKE TEST: nonrepresentative partial cases'))
 else:metrics=score_anomaly(a.predictions,a.truth) if a.task=='anomaly' else score_forecast(a.predictions,a.keys)
 out=Path(a.out or OUT/('anomaly_metrics.json' if a.task=='anomaly' else 'forecast_metrics.json'))
 out.write_text(json.dumps(metrics,indent=2),encoding='utf8')
 with open(out.with_suffix('.csv'),'w',newline='',encoding='utf8') as f:
  flat=[{k:v for k,v in row.items() if not isinstance(v,(dict,list))} for row in metrics]
  wr=csv.DictWriter(f,fieldnames=sorted(set().union(*(x.keys() for x in flat))));wr.writeheader();wr.writerows(flat)
 print(out)
if __name__=='__main__':main()
