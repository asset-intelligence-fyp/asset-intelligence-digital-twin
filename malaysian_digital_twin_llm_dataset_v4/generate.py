#!/usr/bin/env python3
"""Seven-year Malaysia/Sarawak synthetic office dataset for zero-shot LLM research.

Data are SYNTHETIC, using Kuching (Sarawak) WMO climatology by default.
Optional per-year NASA POWER hourly JSON files replace regional weather inputs.
Room sensor and rooftop rain measurements remain simulated in both cases.
Python standard library only. Dates use Asia/Kuching, UTC+08:00.
"""
from __future__ import annotations
import argparse,csv,json,math,random,calendar,collections
from datetime import datetime,date,timedelta,timezone
from pathlib import Path
from contextlib import ExitStack

TZ=timezone(timedelta(hours=8)); UTC=timezone.utc
# Source: WMO World Weather Information Service / MetMalaysia, Kuching 1971-2000 normals.
# These normals are historical climatological reference statistics, not year-specific observations.
CLIMATE={
 1:(22.9,29.8,684.1,22),2:(23.0,30.2,473.3,17),3:(23.2,31.3,338.6,16),
 4:(23.4,32.3,272.9,17),5:(23.6,32.7,241.8,15),6:(23.3,32.7,220.3,14),
 7:(23.0,32.4,185.6,13),8:(23.0,32.4,229.6,14),9:(22.9,32.0,262.3,16),
 10:(22.9,31.9,338.6,19),11:(22.9,31.6,371.5,22),12:(22.9,30.6,498.1,22)
}
# Keep all original 18 sensor IDs; the nineteenth is an exterior quantitative rain gauge.
SENSOR=[
 ('TEMP-L03-OPEN-01','L03-OPEN-01','temperature','°C'),('RH-L03-OPEN-01','L03-OPEN-01','humidity','%RH'),
 ('CO2-L03-OPEN-01','L03-OPEN-01','co2','ppm'),('PIR-L03-OPEN-01','L03-OPEN-01','occupancy','binary'),
 ('LUX-L03-OPEN-01','L03-OPEN-01','light','lux'),('TEMP-L03-MEET-01','L03-MEET-01','temperature','°C'),
 ('RH-L03-MEET-01','L03-MEET-01','humidity','%RH'),('CO2-L03-MEET-01','L03-MEET-01','co2','ppm'),
 ('PIR-L03-MEET-01','L03-MEET-01','occupancy','binary'),('LUX-L03-MEET-01','L03-MEET-01','light','lux'),
 ('PIR-L03-CLEAN-01','L03-CLEAN-01','occupancy','binary'),('LUX-L03-CLEAN-01','L03-CLEAN-01','light','lux'),
 ('LEAK-L03-CLEAN-01','L03-CLEAN-01','water_leakage','binary'),('RH-L03-WC-01','L03-WC-01','humidity','%RH'),
 ('PIR-L03-WC-01','L03-WC-01','occupancy','binary'),('LUX-L03-WC-01','L03-WC-01','light','lux'),
 ('LEAK-L03-WC-01','L03-WC-01','water_leakage','binary'),('PWR-L03-PWR-POINT-01','L03-PWR-POINT-01','power','kW'),
 ('RAIN-EXT-01','EXT-01','rainfall_intensity','mm/h'),
]
ROMS=[
 ('L03-OPEN-01','Open Office','open_office',195,2.9,48,48,'west','AC-L03-Z1'),
 ('L03-MEET-01','Meeting Room','meeting',32,2.8,12,12,'east','AC-L03-Z2'),
 ('L03-CLEAN-01','Cleaning Store','cleaning',13,2.7,3,0,'none',''),
 ('L03-WC-01','Washroom','toilet',25,2.7,6,0,'none',''),
 ('L03-PWR-POINT-01','Floor Electricity Meter','meter_zone',0,0,0,0,'none',''),
 ('EXT-01','Exterior Roof Weather Point','external',0,0,0,0,'none','')]
SPEC={s[0]:(s[1],s[2],s[3]) for s in SENSOR}
SENSOR_HEAD=['timestamp','sensor_id','room_id','sensor_type','value','unit','source','sequence','quality_flag']
CONTEXT_HEAD=['timestamp','room_id','headcount','occupancy_ratio','temperature_c','humidity_pct','co2_ppm','pir_occupied','light_lux','floor_power_kw','power_scope','ac_on','ac_setpoint_c','ventilation_level','meeting_booked','rain_wet','local_rain_mm_h','regional_rain_mm_h','outdoor_temp_c','outdoor_humidity_pct','solar_w_m2','rain_3h_mm','holiday','working_day','hour','day_of_week','weather_source','data_source']
WEATHER_HEAD=['timestamp','regional_temp_c','regional_humidity_pct','regional_rain_mm_h','solar_w_m2','local_rain_mm_h','rain_wet','local_rain_3h_mm','weather_source','rain_sensor_source']
HEADCOUNT_HEAD=['timestamp','room_id','headcount','occupancy_ratio','source']
HVAC_HEAD=['timestamp','ac_zone_id','ac_on','setpoint_c','ventilation_level','source']
BADGE_HEAD=['event_id','timestamp','employee_id','direction','door_id','source']
BOOKING_HEAD=['booking_id','room_id','start_time','end_time','organizer_id','attendee_count_planned','attendee_count_actual','status','meeting_type']
ATTENDEE_HEAD=['booking_id','employee_id']
EVENT_HEAD=['event_id','start_time','end_time','scenario','affected_sensor_ids','severity','description','source']
LABEL_HEAD=['timestamp','sensor_id','room_id','fault_active','event_id','scenario','severity','description']
PERSON_HEAD=['employee_id','team','seat_id','home_room_id','start_date','wfh_prob_mon','wfh_prob_tue','wfh_prob_wed','wfh_prob_thu','wfh_prob_fri','leave_sick_rate','arrival_mean_min','departure_mean_min','source']


def clip(x,lo,hi):return min(hi,max(lo,x))
def round2(x):return round(x,2)
def stamp(day,mins):return (datetime(day.year,day.month,day.day,tzinfo=TZ)+timedelta(minutes=mins)).isoformat(timespec='seconds')
def rseed(seed,day,extra=0):return random.Random(seed+day.toordinal()*10007+extra)

def holidays_from_csv(path):
 d={}
 with open(path,encoding='utf-8-sig',newline='') as f:
  for r in csv.DictReader(f):d[date.fromisoformat(r['date'])]=r['holiday_name']
 return d

def persons(seed):
 rng=random.Random(seed+100);rows=[]
 teams=['Facilities','Engineering','Finance','Administration','Sales','Operations']
 for i in range(1,49):
  if i<=26:st='2019-01-01'
  elif i<=30:st='2022-01-01'
  elif i<=36:st='2023-01-01'
  elif i<=42:st='2024-01-01'
  else:st='2025-01-01'
  base=[0.34,0.15,0.11,0.16,0.41]
  if i%5==0:base=[0.08]*5
  if i%7==0:base=[.52,.3,.28,.3,.56]
  rows.append({'id':f'E{i:04}','team':rng.choice(teams),'seat':f'S-{i:02d}',
               'start':date.fromisoformat(st),'wfh':base,'leave':0.037})
 return rows

def get_nasa_year(folder,year):
 """Optional NASA POWER hourly JSON for year, UTC keys YYYYMMDDHH."""
 p=Path(folder)/f'nasa_power_{year}.json'
 if not p.exists():return None
 raw=json.loads(p.read_text(encoding='utf8'))
 param=raw['properties']['parameter']
 mapping=['T2M','RH2M','ALLSKY_SFC_SW_DWN','PRECTOTCORR']
 for k in mapping:
  if k not in param:raise ValueError(f'NASA JSON {p}: missing {k}')
 solar_units=raw.get('parameters',{}).get('ALLSKY_SFC_SW_DWN',{}).get('units','').lower()
 # NASA hourly irradiance is often kW-hr/m2; 1 kWh/m2 over one hour = 1000 W/m2.
 solar_scale=1000.0 if 'kw' in solar_units else 1.0
 weather={}
 for key in param['T2M']:
  try:
   v=(float(param['T2M'][key]),float(param['RH2M'][key]),float(param['ALLSKY_SFC_SW_DWN'][key])*solar_scale,float(param['PRECTOTCORR'][key]))
  except KeyError:continue
  if any(x<=-900 for x in v):continue
  # NASA UTC hour to Kuching local clock hour; only historic representative grid values.
  utc=datetime.strptime(key,'%Y%m%d%H').replace(tzinfo=UTC)
  weather[utc.astimezone(TZ).isoformat(timespec='seconds')]=v
 return weather

def local_nasa(regional, day, minute, hourly):
 ts=stamp(day,minute)
 k=(minute//60)*60; key0=stamp(day,k);key1=stamp(day,k+60)
 if key0 not in hourly or key1 not in hourly:
  raise ValueError(f'NASA hourly file missing UTC-converted local weather at {ts}; include the prior/next UTC boundary days')
 a,b=hourly[key0],hourly[key1];w=(minute-k)/60
 # Interpolate temperature, RH, solar only; rain is a reported hourly rate, not 5-minute observations.
 return (a[0]+w*(b[0]-a[0]),a[1]+w*(b[1]-a[1]),max(0,a[2]+w*(b[2]-a[2])),max(0,a[3]))

def modeled_weather(day, rng):
 """Generate WMO-based regional climatology with correlated local rain.

 Return list of 288 (T,RH,SOLAR,regional_rain_mm_h,local_mm_h).
 Long-term normals are a *seasonal prior*, not historical actuals.
 """
 mind,maxd,monthly,rain_days=CLIMATE[day.month]
 days=calendar.monthrange(day.year,day.month)[1]
 wet=rng.random()<(rain_days/days)
 dtotal=rng.gammavariate(1.3,monthly/rain_days/1.3) if wet else 0
 # Local convective rain may differ spatially from the regional grid estimate.
 pulses=[0.0]*288
 if wet:
  for _ in range(rng.choice([1,1,2,2,3])):
   start=rng.randint(0,260);length=rng.randint(8,48)
   for j in range(start,min(288,start+length)):
    phase=(j-start+.5)/length
    pulses[j]+=.15+.85*math.sin(math.pi*phase)**2
  factor=dtotal/sum(pulses) if sum(pulses) else 0
  pulses=[v*factor*12 for v in pulses] # mm/h, 5-min-integrated rainfall ~= dtotal
 localfactor=rng.uniform(.62,1.42) if rng.random()<.9 else rng.uniform(.2,.45)
 # Some localized storms not represented by the area-scale estimate.
 if not wet and rng.random()<.045:
  st=rng.randint(90,238);intensity=rng.uniform(1.5,12)
  for j in range(st,min(288,st+rng.randint(4,20))):pulses[j]=intensity
  localfactor=1.0
 shift=rng.choice([-3,-2,-1,0,0,0,1,2,3])
 local=[pulses[(i-shift)%288]*localfactor for i in range(288)]
 residual=rng.gauss(0,.75);wind=rng.uniform(-.3,.3)
 values=[]
 for i in range(288):
  h=i/12
  # Diurnal minimum ~06:00, maximum ~15:00.
  delta=(1+math.sin(2*math.pi*(h-9)/24))/2
  t=mind+(maxd-mind)*delta+residual+wind*math.sin(h*.7)
  reg=pulses[i];loc=local[i]
  t-=.38*math.log1p(loc)   # convective cooling
  solar=max(0,math.sin(math.pi*(h-6.1)/12.2))*(830 if loc<.1 else 180)
  rh=clip(91-25*delta+3.8*math.log1p(loc)+rng.gauss(0,.38),52,99)
  values.append((clip(t,21,38),rh,solar,reg,loc))
 return values

def seasonal_wfh(y):
 # Illustrative WFH assumptions for 2020/21 pandemic-like disruption, not actual legal orders.
 return {2019:0.95,2020:2.7,2021:2.5,2022:1.2,2023:1.0,2024:1.0,2025:1.0,2026:1.0}.get(y,1)

def create_faults(start,end,count,seed):
 rng=random.Random(seed+36001);events=[];days=(end-start).days
 # Each event is an independent anomaly; labels are hidden test answers.
 types=[
 ('cooling_underperformance',['TEMP-L03-OPEN-01','RH-L03-OPEN-01','PWR-L03-PWR-POINT-01'],'AC may fail to cool under occupancy'),
 ('ventilation_reduction',['CO2-L03-MEET-01','RH-L03-MEET-01'],'Inadequate ventilation when occupied'),
 ('co2_sensor_drift',['CO2-L03-OPEN-01'],'CO2 probe drift independent of occupancy'),
 ('humidity_infiltration',['RH-L03-OPEN-01','RH-L03-MEET-01'],'Moisture entry and elevated indoor RH following rain'),
 ('water_leak',['LEAK-L03-WC-01','RH-L03-WC-01'],'Water presence and local moisture increase'),
 ('rain_gauge_stuck_dry',['RAIN-EXT-01'],'Rooftop gauge may miss actual precipitation'),
 ('power_afterhours',['PWR-L03-PWR-POINT-01'],'Unscheduled high load after hours'),
 ('light_underperform',['LUX-L03-MEET-01'],'Meeting lighting below expected levels'),
 ('pir_stuck_on',['PIR-L03-CLEAN-01'],'PIR reports occupancy when cleaning area is vacant'),
 ('temperature_probe_drift',['TEMP-L03-MEET-01'],'Probe drifts while other measurements remain coherent')]
 used=collections.defaultdict(list)
 for name,ids,desc in types:
  placed=0;attempts=0
  while placed<count:
   attempts+=1
   if attempts>5000:raise RuntimeError('Could not schedule enough non-overlapping faults')
   offset=rng.randrange(days);d=start+timedelta(days=offset)
   if name not in ('rain_gauge_stuck_dry','water_leak') and d.weekday()>=5:continue
   duration=rng.choice([30,60,90,120,180,240])
   hr=(rng.randint(9,14) if name in ('cooling_underperformance','ventilation_reduction','humidity_infiltration','light_underperform') else
       rng.randint(19,21) if name=='power_afterhours' else rng.randint(0,3) if name=='pir_stuck_on' else rng.randint(7,20))
   start_min=offset*1440+hr*60+rng.choice([0,15,30]);end_min=start_min+duration
   if name in ('rain_gauge_stuck_dry','humidity_infiltration'):
    # Schedule local-rain sensor faults when the simulated site is ACTUALLY wet.
    # This check applies to the climatology-mode test set, not NASA reruns.
    day_weather=modeled_weather(d,rseed(seed,d,77))
    wet_slots=[j for j in range(288) if day_weather[j][4]>1.0 and (name=='rain_gauge_stuck_dry' or 8<=j/12<17)]
    if not wet_slots:continue
    j=rng.choice(wet_slots)
    start_min=offset*1440+j*5;end_min=start_min+duration
   if end_min>=days*1440:continue
   if any(not (end_min+60 <= x or start_min>=y+60) for sid in ids for x,y in used[sid]):continue
   for sid in ids:used[sid].append((start_min,end_min))
   placed+=1;eid=f'F{name[:3].upper()}{placed:03}'
   events.append({'id':eid,'start':start_min,'end':end_min,'scenario':name,'affected':ids,
    'severity':rng.choice([1,2,2,3]),'description':desc})
 return sorted(events,key=lambda e:e['start'])

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--start',default='2019-01-01');ap.add_argument('--end',default='2020-01-01')
 ap.add_argument('--out',required=True);ap.add_argument('--seed',type=int,default=211027)
 ap.add_argument('--holidays',default='data/holidays_sarawak_2019_2025.csv')
 ap.add_argument('--nasa-json-dir',help='Folder of NASA POWER nasa_power_YEAR.json; requires requested year plus neighboring UTC boundary hours')
 ap.add_argument('--faults',action='store_true');ap.add_argument('--events-per-type',type=int,default=20)
 ap.add_argument('--initial-state');ap.add_argument('--sequence-offset',type=int,default=0)
 args=ap.parse_args()
 start=date.fromisoformat(args.start);end=date.fromisoformat(args.end)
 if start>=end:raise ValueError('start must precede end')
 out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
 days=(end-start).days;holidays=holidays_from_csv(args.holidays)
 cohort=persons(args.seed)
 if not args.faults:
  with (out/'rooms.csv').open('w',newline='',encoding='utf8') as f:
   w=csv.writer(f);w.writerow(['room_id','room_name','room_type','area_m2','height_m','max_capacity','seat_count','orientation','ac_zone_id']);w.writerows(ROMS)
  with (out/'employees.csv').open('w',newline='',encoding='utf8') as f:
   w=csv.writer(f);w.writerow(PERSON_HEAD)
   for p in cohort:w.writerow([p['id'],p['team'],p['seat'],'L03-OPEN-01',p['start'].isoformat(),*p['wfh'],p['leave'],525,1065,'synthetic'])
 state={'temp_open':25.5,'temp_meet':25.6,'rh_open':65.0,'rh_meet':66.0,'rh_wc':72.0,
        'co2_open':430.0,'co2_meet':430.0,'wet3h':0.0}
 if args.initial_state:
  state.update(json.loads(Path(args.initial_state).read_text()))
 events=create_faults(start,end,args.events_per_type,args.seed) if args.faults else []
 if args.faults:
  with (out/'ground_truth_events.csv').open('w',newline='',encoding='utf8') as f:
   w=csv.writer(f);w.writerow(EVENT_HEAD)
   for e in events:
    st=datetime.combine(start,datetime.min.time(),tzinfo=TZ)+timedelta(minutes=e['start'])
    en=datetime.combine(start,datetime.min.time(),tzinfo=TZ)+timedelta(minutes=e['end'])
    w.writerow([e['id'],st.isoformat(timespec='seconds'),en.isoformat(timespec='seconds'),e['scenario'],';'.join(e['affected']),e['severity'],e['description'],'synthetic_injected'])
 activebins=collections.defaultdict(list)
 for e in events:
  for sid in e['affected']:activebins[sid].append(e)
 nasa_data={}
 if args.nasa_json_dir:
  for yr in range(start.year-1,end.year+1):
   p=Path(args.nasa_json_dir)/f'nasa_power_{yr}.json'
   if p.exists():nasa_data.update(get_nasa_year(args.nasa_json_dir,yr))
  if not nasa_data:raise ValueError('No valid NASA hourly files in folder')
 source='NASA_POWER_REGIONAL_ESTIMATE' if nasa_data else 'WMO_NORMALS_CALIBRATED_SYNTHETIC'
 counts=collections.Counter();seq=0;prev_hvac={};badgeid=0;bookingid=0;hvacid=0
 with ExitStack() as es:
  writers={}
  
  def mk(n,head):
   f=es.enter_context((out/f'{n}.csv').open('w',newline='',encoding='utf8',buffering=1024*1024));w=csv.writer(f);w.writerow(head);writers[n]=w
  for name,head in [('calendar',['date','weekday','is_holiday','holiday_name','is_workday','attendance_factor','occupancy_policy']),
       ('badge_events',BADGE_HEAD),('room_bookings',BOOKING_HEAD),('meeting_attendees',ATTENDEE_HEAD),
       ('hvac_events',['event_id','timestamp','ac_zone_id','ac_on','setpoint_c','ventilation_level','source']),
       ('headcount',HEADCOUNT_HEAD),('hvac_state',HVAC_HEAD),('weather_5min',WEATHER_HEAD),
       ('sensor_history',SENSOR_HEAD),('training_features',CONTEXT_HEAD),('training_features_open_office',CONTEXT_HEAD)]:mk(name,head)
  if args.faults:mk('ground_truth_labels',LABEL_HEAD)
  def emit(name,row):writers[name].writerow(row);counts[name]+=1
  for dd in range(days):
   day=start+timedelta(days=dd);dow=day.weekday();workday=dow<5 and day not in holidays
   dr=rseed(args.seed,day);staff=[];sched={};badge_batch=[]
   policy_multiplier=seasonal_wfh(day.year)
   if workday:
    for p in cohort:
     if day<p['start']:continue
     wfh=clip(p['wfh'][dow]*policy_multiplier,0,.9)
     if dr.random()<wfh or dr.random()<p['leave']:continue
     a=int(clip(dr.gauss(525,23),455,610));b=int(clip(dr.gauss(1065,35),970,1240))
     if dr.random()<.08:b=int(clip(b+dr.uniform(45,110),970,1320))
     la=int(clip(dr.gauss(745,18),690,800));lb=la+dr.randint(30,65)
     sched[p['id']]=(a,b,la,lb)
     for mins,direction in [(a,'in'),(la,'out'),(lb,'in'),(b,'out')]:
      badgeid+=1;badge_batch.append([f'B{day.year}{badgeid:08}',stamp(day,mins),p['id'],direction,'L03-MAIN-DOOR','synthetic'])
   for row in sorted(badge_batch,key=lambda r:(r[1],r[2])):emit('badge_events',row)
   factor=round(len(sched)/max(1,sum(p['start']<=day for p in cohort)),3) if workday else 0
   emit('calendar',[day.isoformat(),dow,int(day in holidays),holidays.get(day,''),int(workday),factor,'synthetic_wfh_period' if day.year in (2020,2021) else 'assumed_hybrid_office'])
   bookings=[];booked=set()
   if workday:
    for begin in (550,640,800,895):
     if dr.random()>.69:continue
     duration=dr.choice([30,45,60,75]);endmin=begin+duration
     eligible=[eid for eid,(a,b,la,lb) in sched.items() if a<=begin and b>endmin and not (la<endmin and lb>begin) and eid not in booked]
     dr.shuffle(eligible);planned=dr.randint(3,10);cancelled=dr.random()<.06
     actual=[] if cancelled else eligible[:planned]
     status='cancelled' if cancelled else ('no_show' if not actual else 'held')
     bookingid+=1;bid=f'BK{day.year}{bookingid:07}'
     emit('room_bookings',[bid,'L03-MEET-01',stamp(day,begin),stamp(day,endmin),actual[0] if actual else '',planned,len(actual),status,dr.choice(['client','team_sync','planning'])])
     for eid in actual:emit('meeting_attendees',[bid,eid]);booked.add(eid)
     if actual:bookings.append((begin,endmin,set(actual)))
   # WMO climatology simulation, with storm pulses and daily weather variation.
   regional=modeled_weather(day,rseed(args.seed,day,77)) if not nasa_data else None
   moisture_rng=rseed(args.seed,day,90)
   if dd%120==0:print(f'{day} processed day {dd}/{days}',flush=True)
   # cleaning crew on roughly every second weekday, after work; no employee badge ID required
   cleaner=workday and dr.random()<.70
   cleaning_start=dr.randint(1065,1125) if cleaner else 1441
   cleaning_end=cleaning_start+dr.randint(50,90) if cleaner else 1441
   wr=rseed(args.seed,day,1000)
   for i in range(288):
    minute=i*5;hour=minute/60;seq+=1;t=stamp(day,minute)
    if nasa_data:
     ot,orh,solar,rr=local_nasa(None,day,minute,nasa_data)
     loc=rr*(.75+.33*math.sin(day.toordinal()+hour*.5))
     if rr<.1 and moisture_rng.random()<.002:loc=moisture_rng.uniform(1.5,7.0)
     loc=max(0,loc)
    else:ot,orh,solar,rr,loc=regional[i]
    # Explicitly synthetic onsite rain gauge even if NASA regional weather is used.
    rainwet=int(loc>.10)
    state['wet3h']=.972*state['wet3h']+loc*(5/60)
    present=[eid for eid,(a,b,la,lb) in sched.items() if a<=minute<b and not la<=minute<lb]
    meet=set()
    for a,b,ids in bookings:
     if a<=minute<b:meet=ids.intersection(present);break
    visitors={eid for eid in present if eid not in meet and wr.random()<.014}
    open_n=len(present)-len(meet)-len(visitors);meet_n=len(meet);wc_n=len(visitors)
    clean_n=int(cleaner and cleaning_start<=minute<cleaning_end)
    assert open_n>=0 and open_n+meet_n+wc_n==len(present)
    counts_rooms={'L03-OPEN-01':open_n,'L03-MEET-01':meet_n,'L03-WC-01':wc_n,'L03-CLEAN-01':clean_n}
    for rid,n in counts_rooms.items():
     maxcap=next(r[5] for r in ROMS if r[0]==rid)
     emit('headcount',[t,rid,n,round(n/maxcap,4) if maxcap else 0,'synthetic_badge_meeting'])
    ac_open=int(workday and 7.5<=hour<18.5)
    ac_meet=int(workday and 8.0<=hour<18.0)
    set_open=24.0;set_meet=24.1
    vents=['normal' if ac_open else 'low','high' if (ac_meet and meet_n>0) else 'normal' if ac_meet else 'low']
    for zid,ac,sp,vent in [('AC-L03-Z1',ac_open,set_open,vents[0]),('AC-L03-Z2',ac_meet,set_meet,vents[1])]:
     emit('hvac_state',[t,zid,ac,sp,vent,'synthetic_schedule'])
     if prev_hvac.get(zid)!=(ac,sp,vent):
      hvacid+=1;emit('hvac_events',[f'H{day.year}{hvacid:08}',t,zid,ac,sp,vent,'synthetic_schedule']);prev_hvac[zid]=(ac,sp,vent)
    # Offline injected faults are applied to the underlying physical/virtual state first.
    stepmin=dd*1440+minute
    current={}
    if events:
     for sid,lst in activebins.items():
      for e in lst:
       if e['start']<=stepmin<e['end']:
        current[sid]=e;break
    physical_faults={e['id']:e for e in current.values()}
    names={e['scenario'] for e in physical_faults.values()}
    # Rain gauge anomaly affects measurement, not the actual simulated outdoor rain.
    moist_extra=(3.0 if 'humidity_infiltration' in names else 0.0)
    ac_failure=('cooling_underperformance' in names)
    vent_reduced=('ventilation_reduction' in names)
    for suffix,n,ac,sp,area,vol,orient in [('open',open_n,ac_open,set_open,195,565.5,1),('meet',meet_n,ac_meet,set_meet,32,89.6,.25)]:
     effective_ac=ac and not (ac_failure and suffix=='open')
     solar_gain=orient*(solar/800)*(0.9 if 12<hour<17 else .25)
     base_target=26.8+.42*(ot-27)+.025*n+.55*solar_gain
     on_target=sp+.27+.024*n+.045*(ot-30)+.35*solar_gain
     target=on_target if effective_ac else base_target
     alpha=.074 if effective_ac else .029
     state[f'temp_{suffix}']=clip(state[f'temp_{suffix}']+alpha*(target-state[f'temp_{suffix}'])+wr.gauss(0,.019),21,36)
     # Higher outdoor humidity / rain affects indoor RH, attenuated and delayed by AC dehumidification.
     target_rh=(57.7 if ac else 65.8)+(.16 if ac else .30)*(orh-75)+(.055 if ac else .14)*n
     target_rh+=(.16 if ac else .40)*state['wet3h']+(.70 if ac else 1.6)*rainwet
     if suffix=='open' and moist_extra:target_rh+=moist_extra*2
     if suffix=='meet' and moist_extra:target_rh+=moist_extra*1.1
     state[f'rh_{suffix}']=clip(state[f'rh_{suffix}']+.064*(target_rh-state[f'rh_{suffix}'])+wr.gauss(0,.11),43,94)
     # Simplified CO2 mass balance; outdoor background 425ppm.
     ach=(2.0 if suffix=='open' and ac else 1.0 if suffix=='open' else 3.3 if ac else 0.75)
     if suffix=='meet' and vent_reduced:ach=.35
     target_co2=425+n*.018*1e6/(ach*vol)
     state[f'co2_{suffix}']=clip(target_co2+(state[f'co2_{suffix}']-target_co2)*math.exp(-ach*5/60)+wr.gauss(0,1.4),380,3000)
    state['rh_wc']=clip(state['rh_wc']+.075*(min(91,68+.2*(orh-75)+.9*wc_n+1.3*rainwet)-state['rh_wc'])+wr.gauss(0,.12),55,96)
    sunfac=solar/800
    lux_open=clip(80*sunfac+int(open_n>0)*(340+85*sunfac)+wr.gauss(0,3),0,630)
    lux_meet=clip(20*sunfac+int(meet_n>0)*(330+30*sunfac)+wr.gauss(0,2),0,510)
    lux_wc=clip(int(wc_n>0)*125+wr.gauss(1,2),0,260)
    lux_clean=clip(int(clean_n>0)*160+wr.gauss(1,1.4),0,200)
    pwr=clip(.62+ac_open*(1.4+.13*max(ot-29,0))+ac_meet*(.65+.08*max(ot-29,0))+.06*(open_n+meet_n)+.0006*(lux_open+lux_meet)+.2*clean_n+wr.gauss(0,.05),.05,12)
    vals={'TEMP-L03-OPEN-01':state['temp_open'],'RH-L03-OPEN-01':state['rh_open'],
      'CO2-L03-OPEN-01':state['co2_open'],'PIR-L03-OPEN-01':int(open_n>0),'LUX-L03-OPEN-01':lux_open,
      'TEMP-L03-MEET-01':state['temp_meet'],'RH-L03-MEET-01':state['rh_meet'],
      'CO2-L03-MEET-01':state['co2_meet'],'PIR-L03-MEET-01':int(meet_n>0),'LUX-L03-MEET-01':lux_meet,
      'PIR-L03-CLEAN-01':int(clean_n>0),'LUX-L03-CLEAN-01':lux_clean,'LEAK-L03-CLEAN-01':0,
      'RH-L03-WC-01':state['rh_wc'],'PIR-L03-WC-01':int(wc_n>0),'LUX-L03-WC-01':lux_wc,
      'LEAK-L03-WC-01':0,'PWR-L03-PWR-POINT-01':pwr,'RAIN-EXT-01':loc}
    # Correlated physical anomalies: same event affects readings in several channels.
    for e in physical_faults.values():
     scenario=e['scenario'];phase=clip((stepmin-e['start'])/max(1,e['end']-e['start']),0,1)
     if scenario=='cooling_underperformance':vals['PWR-L03-PWR-POINT-01']+=.35*e['severity']
     elif scenario=='ventilation_reduction':vals['RH-L03-MEET-01']+=1.7*e['severity']
     elif scenario=='co2_sensor_drift':vals['CO2-L03-OPEN-01']+=200*e['severity']*phase
     elif scenario=='humidity_infiltration':vals['RH-L03-OPEN-01']+=2.3*e['severity'];vals['RH-L03-MEET-01']+=1.1*e['severity']
     elif scenario=='water_leak':vals['LEAK-L03-WC-01']=1;vals['RH-L03-WC-01']+=4*e['severity']
     elif scenario=='rain_gauge_stuck_dry':vals['RAIN-EXT-01']=0
     elif scenario=='power_afterhours':vals['PWR-L03-PWR-POINT-01']+=1.2*e['severity']
     elif scenario=='light_underperform':vals['LUX-L03-MEET-01']*=.18
     elif scenario=='pir_stuck_on':vals['PIR-L03-CLEAN-01']=1
     elif scenario=='temperature_probe_drift':vals['TEMP-L03-MEET-01']+=e['severity']*phase
    observed={}
    for sid,rid,typ,unit in SENSOR:
     v=vals[sid];e=current.get(sid);flag='ok'
     # Rare missing/noisy values are measurement imperfections, not hidden ground truth faults.
     if wr.random()<.00013:v='';flag='missing'
     elif wr.random()<.00021 and typ not in ('water_leakage','occupancy'):
      v+=wr.choice([-1,1]) * {'temperature':.45,'humidity':1.3,'co2':58,'light':26,'power':.25,'rainfall_intensity':.8}.get(typ,0);flag='noisy'
     elif e and e['scenario'] in ('co2_sensor_drift','temperature_probe_drift','rain_gauge_stuck_dry'):flag='drift'
     if v!='':
      if typ in ('water_leakage','occupancy'):v=int(v)
      elif typ=='co2':v=round(clip(v,360,4000))
      elif typ=='humidity':v=round2(clip(v,0,100))
      elif typ=='temperature':v=round2(clip(v,10,45))
      elif typ=='light':v=round(clip(v,0,3000))
      else:v=round2(max(0,v))
     observed[sid]=v
     emit('sensor_history',[t,sid,rid,typ,v,unit,'synthetic',seq+args.sequence_offset,flag])
     if args.faults:emit('ground_truth_labels',[t,sid,rid,int(bool(e)),e['id'] if e else '',e['scenario'] if e else '',e['severity'] if e else '',e['description'] if e else ''])
    # IMPORTANT: this local gauge reports intensity, regional weather is a separate source.
    reported_wet=int(observed['RAIN-EXT-01'] != '' and float(observed['RAIN-EXT-01'])>.1)
    emit('weather_5min',[t,round2(ot),round2(orh),round2(rr),round2(solar),observed['RAIN-EXT-01'],reported_wet,round2(state['wet3h']),source,'synthetic_local_gauge'])
    for rid,suf,n,ac,sp,vent in [('L03-OPEN-01','OPEN',open_n,ac_open,set_open,vents[0]),('L03-MEET-01','MEET',meet_n,ac_meet,set_meet,vents[1])]:
     ctx=[t,rid,n,round(n/(48 if suf=='OPEN' else 12),3),observed[f'TEMP-L03-{suf}-01'],observed[f'RH-L03-{suf}-01'],
      observed[f'CO2-L03-{suf}-01'],observed[f'PIR-L03-{suf}-01'],observed[f'LUX-L03-{suf}-01'],observed['PWR-L03-PWR-POINT-01'],'floor_level_meter',
      ac,sp,vent,int(suf=='MEET' and meet_n>0),reported_wet,observed['RAIN-EXT-01'],round2(rr),round2(ot),round2(orh),round2(solar),round2(state['wet3h']),int(day in holidays),int(workday),round(hour,3),dow,source,'synthetic_building']
     emit('training_features',ctx)
     if suf=='OPEN':emit('training_features_open_office',ctx)
  manifest={'generator':'sarawak_people_rain_v4.0','start_inclusive':str(start),'end_exclusive':str(end),'sampling_minutes':5,'timezone':'Asia/Kuching (+08:00)',
   'sensor_count':len(SENSOR),'timestamps':seq,'expected_sensor_readings':seq*len(SENSOR),'rows':dict(counts),
   'weather_provenance':source,'local_rain_provenance':'synthetic_gauge_correlated_with_regional_rain','building_data_source':'synthetic',
   'fault_events':len(events),'seed':args.seed,'warnings':['No building sensor values are actual measurements.','NASA weather is regional reanalysis estimate if used, not rooftop observations.',
   'Office geometry, WFH history and operating schedules are assumptions.','Truth labels are for evaluation only.']}
  (out/'run_manifest.json').write_text(json.dumps(manifest,indent=2))
  (out/'final_state.json').write_text(json.dumps(state,indent=2))
  print('DONE',out,seq,'timestamps',seq*len(SENSOR),'sensor readings', 'faults',len(events),flush=True)

if __name__=='__main__':main()
