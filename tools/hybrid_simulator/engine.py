"""Stateful synthetic generator. Uses fitted aggregates, never replays observation rows."""
from __future__ import annotations
import json,math,random
from datetime import datetime,timedelta,timezone
from pathlib import Path
from tools.hybrid_simulator.calibrate import features,dot
from tools.dataset_replay.replay import ROOT,stamp
MYT=timezone(timedelta(hours=8))
HERE=Path(__file__).resolve().parent
PRODUCER='calibrated_hybrid_v1'
def clamp(x,a,b):return min(b,max(a,x))
BOUNDS={'temperature':(15,42),'humidity':(20,100),'co2':(420,5000),'light':(0,1500),'power':(0,30)}
# Explicit response assumptions constrain stochastic updates; not measured building constants.
RATE={'temperature':.15,'humidity':1.2,'co2':150,'light':600,'power':2}
RHO_CAP={'temperature':.97,'humidity':.97,'co2':.95,'light':.70,'power':.80}
class HybridSimulator:
 def __init__(self,profile=None,seed=1,start=None,step_seconds=5,calendar_file=None,fault_mode='normal'):
  self.profile=profile or json.loads((HERE/'profile.json').read_text());self.registry=json.loads((ROOT/'shared/sensorRegistry.json').read_text())
  if self.profile.get('version')!='hybrid_v1' or set(self.profile['models'])!={p['code'] for p in self.registry if p['unit']!='binary'}:raise ValueError('Unsupported/incomplete calibration profile')
  if not math.isfinite(step_seconds) or not 1<=step_seconds<=900:raise ValueError('Simulation step must be 1–900 seconds')
  self.rng=random.Random(seed);self.seed=seed;self.time=stamp(start).astimezone(MYT) if isinstance(start,str) else (start or datetime.now(MYT)).astimezone(MYT)
  self.start=self.time;self.dt=step_seconds;self.sequence=0;self.values={};self.heads={};self.meeting=False;self.weather_state={};self.wet=False;self.current_day=None;self.fault_mode=fault_mode
  if fault_mode not in ('normal','demo'):raise ValueError('Unknown fault mode')
  self.holidays=json.loads((HERE/'holidays.json').read_text());self.custom_calendar=json.loads(Path(calendar_file).read_text()) if calendar_file else {}
  for date,row in self.custom_calendar.items():
   datetime.fromisoformat(date)
   if not isinstance(row,dict) or not isinstance(row.get('closed'),bool) or not 0<=row.get('attendance_factor',1)<=1.5:raise ValueError('Invalid custom calendar entry')
 def calendar(self,t,override='auto'):
  date=t.date().isoformat();name=self.custom_calendar.get(date,{}).get('name') or self.holidays['holidays'].get(date) or self.profile['dataset_holidays'].get(date)
  closed=bool(name) or t.weekday()>=5;custom=self.custom_calendar.get(date)
  if custom:
   closed=custom['closed'];name=custom.get('name') or ('Company closure' if closed else None)
  if override=='holiday':closed=True;name='Manual holiday demonstration'
  if override=='workday':closed=False;name='Manual working-day demonstration'
  kind='holiday' if name and closed else 'weekend' if closed else 'workday'
  return dict(date=date,timezone='Asia/Kuching',day_type=kind,is_public_holiday=bool(name and override=='auto' and not custom),holiday_name=name,is_workday=not closed,attendance_factor=0 if closed else (custom or {}).get('attendance_factor',1),override=override,calendar_complete=bool(custom) or t.year in [2023,2024,2025,*self.holidays['covered_years']],school_holiday=None)
 def _weather(self,t,mode):
  hour=t.hour+t.minute/60+t.second/3600;daylight=max(0,math.sin((hour-6)*math.pi/12)) if 6<hour<18 else 0
  trans=self.profile['wet_transitions'].get(str(t.month),[[10,1],[1,10]]);row=trans[int(self.wet)];pchange=row[1-int(self.wet)]/max(1,sum(row));prob=1-(1-pchange)**(self.dt/3600)
  if self.rng.random()<prob:self.wet=not self.wet
  if mode=='rain':self.wet=True
  if mode in ('clear','cloudy'):self.wet=False
  wet=int(self.wet);key=f'{t.month}:{t.hour}:{wet}'
  stats=self.profile['weather'].get(key) or self.profile['weather'].get(f'{t.month}:{t.hour}:{1-wet}')
  if stats is None:raise ValueError('Calibration has no weather bin for current month/hour')
  cloud=clamp(.7 if self.wet else .25,0,1)
  if mode=='cloudy':cloud=.85
  if mode=='clear':cloud=.05
  if mode=='rain':cloud=.95
  means={k:v['mean'] for k,v in stats.items()}
  # Weather modes are explicit interventions, not a claim of learned causal effects.
  if mode!='auto':
   means['solar_radiation_w_m2']=900*daylight*(1-.85*cloud)
   means['outdoor_temp_c']+= (1-cloud)*2*daylight-1.5*cloud
   means['outdoor_humidity_pct']+=10*cloud-4*(1-cloud)
   means['rainfall_mm_per_h']=max(1,means['rainfall_mm_per_h']) if mode=='rain' else 0
  shared=self.rng.gauss(0,1);rho=math.exp(-self.dt/1800);s=math.sqrt(1-rho*rho)
  for k in means:
   sd=stats[k]['sd'];z=self.rng.gauss(0,1)
   if k=='outdoor_humidity_pct':z=-.65*shared+.76*z
   elif k=='outdoor_temp_c':z=shared
   before=self.weather_state.get(k,means[k]);value=means[k]+rho*(before-means[k])+s*sd*z
   if k=='solar_radiation_w_m2':value=0 if not daylight else clamp(value,0,1200)
   elif k=='rainfall_mm_per_h':value=clamp(value,.2,80) if self.wet else 0
   elif k=='outdoor_temp_c':value=clamp(value,18,40)
   else:value=clamp(value,35,100)
   self.weather_state[k]=value
  self.weather_state['solar_radiation_w_m2']=0 if not daylight else self.weather_state['solar_radiation_w_m2']
  w={k:round(v,2) for k,v in self.weather_state.items()}
  scene='night' if not daylight else 'rain' if w['rainfall_mm_per_h']>=.2 else 'cloudy' if w['solar_radiation_w_m2']<300*daylight else 'clear'
  return {**w,'source':'virtual_weather_station','synthetic':True,'mode':mode,'scene':scene,'timestamp':t.isoformat(),'station_id':'VIRTUAL-OUTDOOR-01','ifc_linked':False}
 def _occupancy(self,t,cal):
  if self.current_day!=t.date():
   self.current_day=t.date();self.day_factor=clamp(self.rng.gauss(1,.12),.65,1.3);self.day_shift=self.rng.uniform(-.35,.35)
  hour=(t.hour+t.minute/60+self.day_shift)%24;h=int(hour);f=hour-h;acs={};ratios={}
  for room,meta in self.profile['rooms'].items():
   cap=int(meta['max_capacity'])
   if not cap:continue
   a=self.profile['occupancy'].get(f'{room}:{cal["day_type"]}:{h}') or self.profile['occupancy'][f'{room}:workday:{h}']
   b=self.profile['occupancy'].get(f'{room}:{cal["day_type"]}:{(h+1)%24}',a)
   mean=(a['mean']*(1-f)+b['mean']*f)*self.day_factor*cal['attendance_factor'];p=clamp(a['probability_occupied']*(1-f)+b['probability_occupied']*f,0,1)
   if not cal['is_workday']:count=0
   elif meta['room_type']=='meeting':
    rate=1-math.exp(-self.dt/900)
    if self.meeting:
     if self.rng.random()<(1-p)*rate:self.meeting=False
    elif self.rng.random()<p*rate:self.meeting=True
    count=clamp(round(mean/max(.05,p)+self.rng.gauss(0,1)),1,cap) if self.meeting and mean>.05 else 0
   else:
    previous=self.heads.get(room,mean);alpha=1-math.exp(-self.dt/(900 if meta['room_type']=='open_office' else 240))
    count=clamp(previous+alpha*(mean-previous)+self.rng.gauss(0,max(.03,a['sd']*.08))*math.sqrt(self.dt/300),0,cap)
   self.heads[room]=count;ratios[room]=count/cap
   acs[room]=int(bool(meta['ac_zone_id']) and cal['is_workday'] and a['ac_probability']>.5)
  return ratios,acs
 def step(self,controls=None):
  controls=controls or {};weather_mode=controls.get('weather_mode','auto');calendar_mode=controls.get('calendar_mode','auto')
  if weather_mode not in ('auto','clear','cloudy','rain') or calendar_mode not in ('auto','workday','holiday'):raise ValueError('Invalid simulation control')
  t=self.time;cal=self.calendar(t,calendar_mode);w=self._weather(t,weather_mode);ratios,acs=self._occupancy(t,cal);rows=[];truth=[];elapsed=(t-self.start).total_seconds();self.sequence+=1
  for p in self.registry:
   room=p['simulatorRoomId'];kind=p['sensorType']
   if p['unit']=='binary':value=int(self.heads.get(room,0)>=.5) if kind=='occupancy' else 0
   else:
    model=self.profile['models'][p['code']]
    if kind=='power':ratio=sum(self.heads.values())/sum(int(r['max_capacity']) for r in self.profile['rooms'].values());ac=sum(acs.values())/max(1,sum(bool(r['ac_zone_id']) for r in self.profile['rooms'].values()))
    else:ratio=ratios.get(room,0);ac=acs.get(room,0)
    x=features(w,ratio,ac,t.hour+t.minute/60+t.second/3600);target=dot(model['coefficients'],x);low,high=BOUNDS[kind]
    if kind=='light' and self.heads.get(room,0)<.5:target=min(target,5+w['solar_radiation_w_m2']*.015*int(self.profile['rooms'][room]['has_window']))
    target=clamp(target,low,high);rho=min(RHO_CAP[kind],model['rho_per_5_minutes'])**(self.dt/300)
    sd=min(model['residual_sd'],model['observations']['sd']);previous=self.values.get(p['code'],target)
    candidate=previous+(1-rho)*(target-previous)+self.rng.gauss(0,sd)*math.sqrt(max(0,1-rho*rho))
    limit=RATE[kind]*self.dt/60;value=clamp(previous+clamp(candidate-previous,-limit,limit),low,high)
    self.values[p['code']]=value
   quality='ok'
   # Separate measurement fault injection: never contaminates latent normal dynamics.
   if self.fault_mode=='demo':
    fault=None
    if p['code']=='TEMP-L03-MEET-01' and 1500<=elapsed<3300:value+=min(6,(elapsed-1500)/300);fault='temperature_drift'
    if p['code']=='LEAK-L03-WC-01' and 3600<=elapsed<5400:value=1;fault='leak'
    if p['code']=='CO2-L03-MEET-01' and 5700<=elapsed<6300:value=None;quality='missing';fault='missing'
    if fault:truth.append({'sensor_id':p['code'],'fault':fault})
   rows.append(dict(sensor_id=p['code'],room_id=room,sensor_type=kind,unit=p['unit'],timestamp=t.isoformat(),value=round(value,2) if value is not None else None,quality_flag=quality))
  self.time+=timedelta(seconds=self.dt)
  context={'kind':'hybrid','profile_id':self.profile['profile_id'],'fit_period':self.profile['fit_period'],'seed':self.seed,'simulation_step_seconds':self.dt,'calendar':cal,'weather':w,'simulated_headcounts':{k:round(v) for k,v in self.heads.items()},'synthetic':True}
  return {'readings':rows,'dataset_timestamp':t.isoformat(),'simulation':context},truth
