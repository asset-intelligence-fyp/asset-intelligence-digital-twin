#!/usr/bin/env python3
"""Stream exact row/time/sensor consistency checks for all 7 years and fault holdout."""
import argparse,csv,json,collections
from datetime import datetime,timedelta
from pathlib import Path
from generate import SENSOR

def validate(folder,with_labels=False):
 folder=Path(folder)
 m=json.loads((folder/'run_manifest.json').read_text())
 sens_ids=[s[0] for s in SENSOR]; n=m['timestamps'];total=0;prev=None;sidpos=0;groups=0;missing=0
 lab=None;lf=None
 if with_labels:
  lf=(folder/'ground_truth_labels.csv').open(newline='',encoding='utf8');lab=csv.reader(lf);next(lab)
 with (folder/'sensor_history.csv').open(newline='',encoding='utf8') as f:
  rd=csv.reader(f);header=next(rd)
  assert header==['timestamp','sensor_id','room_id','sensor_type','value','unit','source','sequence','quality_flag']
  for row in rd:
   assert len(row)==9,(folder,total,row)
   ts,sid,rid,typ,value,unit,source,seq,quality=row
   if sidpos==0:
    if prev is not None:assert datetime.fromisoformat(ts)-datetime.fromisoformat(prev)==timedelta(minutes=5)
    prev=ts;groups+=1
   else:assert ts==prev,(folder,total,ts,prev)
   assert sid==sens_ids[sidpos],(folder,total,sid,sens_ids[sidpos])
   assert quality in ('ok','missing','noisy','drift')
   if value=='':missing+=1;assert quality=='missing'
   if with_labels:
    lr=next(lab);assert lr[0]==ts and lr[1]==sid and lr[2]==rid,(row,lr)
   sidpos=(sidpos+1)%19;total+=1
 if lf:
  assert next(lab,None) is None
  lf.close()
 assert total==n*19==m['rows']['sensor_history'] and groups==n and sidpos==0,(folder,total,groups,n)
 if with_labels:
  with (folder/'ground_truth_events.csv').open(newline='',encoding='utf8') as f:
   events=list(csv.DictReader(f))
  scenarios=collections.Counter(r['scenario'] for r in events)
  assert len(events)==m['fault_events']==200,(len(events),m['fault_events'])
  assert len(scenarios)==10 and set(scenarios.values())=={20},scenarios
  return {'timestamps':n,'sensor_readings':total,'missing':missing,'fault_events':len(events),'scenarios':dict(scenarios)}
 return {'timestamps':n,'sensor_readings':total,'missing':missing}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',default='generated/normal_by_year');p.add_argument('--fault-folder',default='generated/anomaly_eval_2026_q1');p.add_argument('--out',default='generated/structural_validation.json');args=p.parse_args()
 result={}
 for y in range(2019,2026):
  result[str(y)]=validate(Path(args.root)/str(y))
  print('Validated',y,result[str(y)],flush=True)
 result['fault_eval']=validate(args.fault_folder,True);print('Validated 2026 faults',result['fault_eval'],flush=True)
 Path(args.out).write_text(json.dumps(result,indent=2))
 print('ALL STRUCTURAL VALIDATIONS PASSED')
