"""Fit aggregate stochastic models from NORMAL data only; no observation rows retained."""
from __future__ import annotations
import csv,io,json,math,zipfile,argparse,hashlib
from contextlib import contextmanager
from collections import defaultdict
from datetime import datetime,timedelta
from itertools import groupby
from pathlib import Path
from tools.dataset_replay.replay import Dataset,ROOT,stamp
SPLIT='normal_weather_2023_2025'
FEATURES=['intercept','outdoor_temp_centered','outdoor_rh_centered','solar_kw_m2','occupancy_ratio','ac_on','sin_hour','cos_hour']
WEATHER=['outdoor_temp_c','outdoor_humidity_pct','solar_radiation_w_m2','rainfall_mm_per_h']

class Source(Dataset):
 @contextmanager
 def auxiliary(self,name):
  if name not in ('calendar.csv','weather.csv','rooms.csv','headcount.csv','hvac_state.csv'):raise ValueError('Auxiliary source not allowed')
  if self.path.is_file():
   with zipfile.ZipFile(self.path) as z,z.open(self.prefix+name) as raw,io.TextIOWrapper(raw,encoding='utf-8-sig',newline='') as f:yield csv.DictReader(f)
  else:
   with (self.folder/name).open(encoding='utf-8-sig',newline='') as f:yield csv.DictReader(f)

def features(weather,ratio,ac,hour):
 return [1,(weather['outdoor_temp_c']-28)/10,(weather['outdoor_humidity_pct']-75)/20,weather['solar_radiation_w_m2']/1000,ratio,ac,math.sin(hour*math.pi/12),math.cos(hour*math.pi/12)]

def solve(matrix,vector):
 a=[list(row)+[float(v)] for row,v in zip(matrix,vector)];n=len(a)
 for i in range(n):
  pivot=max(range(i,n),key=lambda k:abs(a[k][i]));a[i],a[pivot]=a[pivot],a[i]
  if abs(a[i][i])<1e-12:raise ValueError('Singular calibration matrix')
  d=a[i][i];a[i]=[v/d for v in a[i]]
  for j in range(n):
   if j!=i:
    f=a[j][i];a[j]=[v-f*w for v,w in zip(a[j],a[i])]
 return [row[-1] for row in a]

class Stats:
 def __init__(self):self.n=0;self.s=0.;self.s2=0.;self.lo=math.inf;self.hi=-math.inf
 def add(self,v):self.n+=1;self.s+=v;self.s2+=v*v;self.lo=min(self.lo,v);self.hi=max(self.hi,v)
 def export(self):
  m=self.s/max(1,self.n)
  return dict(n=self.n,mean=m,sd=math.sqrt(max(0,self.s2/max(1,self.n)-m*m)),minimum=self.lo if self.n else None,maximum=self.hi if self.n else None)

class Regression:
 def __init__(self):self.a=[[0.]*8 for _ in range(8)];self.b=[0.]*8;self.y2=0.;self.stats=Stats()
 def add(self,x,y):
  self.stats.add(y);self.y2+=y*y
  for i in range(8):
   self.b[i]+=x[i]*y
   for j in range(8):self.a[i][j]+=x[i]*x[j]
 def export(self):
  a=[row[:] for row in self.a]
  for i in range(8):a[i][i]+=.001 if i==0 else 2.
  beta=solve(a,self.b);sse=max(0,self.y2-2*sum(c*b for c,b in zip(beta,self.b))+sum(beta[i]*self.a[i][j]*beta[j] for i in range(8) for j in range(8)))
  return dict(coefficients=beta,residual_sd=math.sqrt(sse/max(1,self.stats.n)),observations=self.stats.export())

def dot(a,b):return sum(v*w for v,w in zip(a,b))
def daytype(day,cal):return 'holiday' if cal.get('is_public_holiday')=='1' else ('workday' if cal.get('is_workday')=='1' else 'weekend')
def environment(source):
 with source.auxiliary('calendar.csv') as r:calendar={x['date']:x for x in r}
 with source.auxiliary('rooms.csv') as r:rooms={x['room_id']:x for x in r}
 with source.auxiliary('weather.csv') as r:weather={x['timestamp']:{k:float(x[k]) for k in WEATHER} for x in r}
 return calendar,rooms,weather

def observations(source,registry,rooms,weather):
 with source.auxiliary('headcount.csv') as hr,source.auxiliary('hvac_state.csv') as ar:
  heads=groupby(hr,lambda x:x['timestamp']);acs=groupby(ar,lambda x:x['timestamp'])
  for batch in source.batches(registry):
   t=batch['dataset_timestamp'];moment=stamp(t);ht,hgroup=next(heads);at,agroup=next(acs)
   if ht!=t or at!=t:raise ValueError('Headcount/HVAC timestamps do not align with sensor batch')
   h={r['room_id']:int(r['headcount']) for r in hgroup};a={r['ac_zone_id']:int(r['ac_on']) for r in agroup}
   hour=moment.replace(minute=0,second=0,microsecond=0);w=weather[hour.isoformat()];next_w=weather.get((hour+timedelta(hours=1)).isoformat(),w);f=moment.minute/60
   w={k:w[k]*(1-f)+next_w[k]*f for k in WEATHER}
   yield batch,moment,h,a,w

def calibrate(path):
 source=Source(path,SPLIT);registry=json.loads((ROOT/'shared/sensorRegistry.json').read_text());calendar,rooms,weather=environment(source)
 models={p['code']:Regression() for p in registry if p['unit']!='binary'};occupancy=defaultdict(Stats);occupied=defaultdict(Stats);ac_profiles=defaultdict(Stats)
 weather_stats=defaultdict(lambda:{k:Stats() for k in WEATHER});transitions=defaultdict(lambda:[[0,0],[0,0]]);previous_wet=None
 for t,w in weather.items():
  moment=stamp(t)
  if moment.year>=2025:continue
  wet=int(w['rainfall_mm_per_h']>=.2);key=f'{moment.month}:{moment.hour}:{wet}'
  for k in WEATHER:weather_stats[key][k].add(w[k])
  if previous_wet is not None:transitions[str(moment.month)][previous_wet][wet]+=1
  previous_wet=wet
 samples=0
 for batch,moment,heads,acs,w in observations(source,registry,rooms,weather):
  if moment.year>=2025:break
  cal=calendar[moment.date().isoformat()];kind=daytype(moment,cal);hour=moment.hour+moment.minute/60
  for room,meta in rooms.items():
   if int(meta['max_capacity'])>0:
    key=f'{room}:{kind}:{moment.hour}';count=heads[room];occupancy[key].add(count);occupied[key].add(int(count>0));ac_profiles[key].add(acs.get(meta['ac_zone_id'],0))
  if (batch['source_sequence']-1)%3:continue
  samples+=1
  for row in batch['readings']:
   if row['sensor_id'] not in models:continue
   room=row['room_id'];meta=rooms[room]
   if meta['room_type']=='meter_zone':ratio=sum(heads.values())/sum(int(r['max_capacity']) for r in rooms.values());ac=sum(acs.values())/max(1,len(acs))
   else:ratio=heads[room]/max(1,int(meta['max_capacity']));ac=acs.get(meta['ac_zone_id'],0)
   models[row['sensor_id']].add(features(w,ratio,ac,hour),row['value'])
 fitted={k:v.export() for k,v in models.items()};errors=defaultdict(Stats);residual_pairs=defaultdict(lambda:[0.,0.,0.]);last={}
 # Independent chronological 2025 holdout for equilibrium-model diagnostics, not AI accuracy.
 for batch,moment,heads,acs,w in observations(source,registry,rooms,weather):
  if (batch['source_sequence']-1)%3:continue
  hour=moment.hour+moment.minute/60
  for row in batch['readings']:
   if row['sensor_id'] not in fitted:continue
   room=row['room_id'];meta=rooms[room]
   if meta['room_type']=='meter_zone':ratio=sum(heads.values())/sum(int(r['max_capacity']) for r in rooms.values());ac=sum(acs.values())/max(1,len(acs))
   else:ratio=heads[room]/max(1,int(meta['max_capacity']));ac=acs.get(meta['ac_zone_id'],0)
   error=row['value']-dot(fitted[row['sensor_id']]['coefficients'],features(w,ratio,ac,hour))
   if moment.year<2025:
    prior=last.get(row['sensor_id'])
    if prior is not None:
     pair=residual_pairs[row['sensor_id']];pair[0]+=prior*error;pair[1]+=prior*prior;pair[2]+=1
    last[row['sensor_id']]=error
   else:errors[row['sensor_id']].add(error)
 for code,model in fitted.items():
  cross,var,n=residual_pairs[code];rho=max(0,min(.97,(max(0,cross/max(1e-9,var)))**(1/3)))
  model['rho_per_5_minutes']=rho;model['residual_pairs']=int(n)
  e=errors[code];model['holdout_2025']={'n':e.n,'rmse':math.sqrt(e.s2/max(1,e.n)),'bias':e.s/max(1,e.n)}
 out={'version':'hybrid_v1','calibration_split':SPLIT,'fit_period':'2023-01-01/2024-12-31','validation_period':'2025-01-01/2025-12-31','fit_batches_stride_15min':samples,'features':FEATURES,'models':fitted,'rooms':rooms,'occupancy':{k:{**{f:v.export()[f] for f in ('n','mean','sd')},'probability_occupied':occupied[k].export()['mean'],'ac_probability':ac_profiles[k].export()['mean']} for k,v in occupancy.items()},'weather':{k:{v:{f:s.export()[f] for f in ('n','mean','sd')} for v,s in d.items()} for k,d in weather_stats.items()},'wet_transitions':dict(transitions),'dataset_holidays':{d:r['holiday_name'] for d,r in calendar.items() if r['is_public_holiday']=='1'},'limitations':['Calibrated from synthetic source, not physical building validation.','Ridge equilibrium regressions are associative; stochastic state dynamics, safety bounds and overrides are explicit simulation assumptions.','No sensor observation sequences or fault labels are stored in this profile.']}
 out=round_tree(out)
 out['profile_id']=hashlib.sha256(json.dumps(out,sort_keys=True).encode()).hexdigest()[:16]
 return out

def round_tree(value):
 if isinstance(value,float):return round(value,6)
 if isinstance(value,dict):return {k:round_tree(v) for k,v in value.items()}
 if isinstance(value,list):return [round_tree(v) for v in value]
 return value

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dataset',required=True);p.add_argument('--output',default='tools/hybrid_simulator/profile.json');args=p.parse_args();out=calibrate(args.dataset);target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(out,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(target);print(json.dumps({'profile_id':out['profile_id'],'models':len(out['models']),'fit_batches':out['fit_batches_stride_15min']}))
if __name__=='__main__':main()
