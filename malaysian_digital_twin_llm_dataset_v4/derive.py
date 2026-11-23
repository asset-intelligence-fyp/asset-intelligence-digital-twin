#!/usr/bin/env python3
"""Summarize raw 5-minute, 19-sensor files for 13-week zero-shot LLM backtesting.

Produces ONLY reference inputs/targets, never an AI-generated forecast. Future
actual targets are written to a separate file and must stay hidden from the LLM.
"""
import argparse,csv,math,calendar,collections,statistics,json
from datetime import date,timedelta
from pathlib import Path
from generate import SENSOR,CLIMATE

SID=[s[0] for s in SENSOR];TYPE={s[0]:s[2] for s in SENSOR};ROOM={s[0]:s[1] for s in SENSOR}
DAILY_HEAD=['date','sensor_id','room_id','sensor_type','valid_samples','missing_samples','mean','p10','p50','p90','min','max','warning_samples','status','rainfall_mm_total_if_rain','occupied_hours_if_pir','power_kwh_if_power','is_holiday','is_workday','mean_open_headcount','local_rain_wet_fraction','weather_source']
WEEK_HEAD=['week_start','sensor_id','room_id','sensor_type','days','mean_daily_value','mean_daily_p90','warning_days','status','rainfall_mm_total_if_rain','power_kwh_if_power','weather_source']
BACK_INPUT=['as_of_date','forecast_end_exclusive','horizon_days','sensor_id','room_id','sensor_type','last_90d_mean','last_90d_mean_p90','last_90d_warning_day_rate','last_90d_trend','prior_90d_mean','past_90d_avg_headcount','past_90d_local_wet_day_rate','future_known_public_holiday_days','future_known_office_workdays','future_climatology_avg_rainfall_mm_day','future_climatology_avg_temp_min_c','future_climatology_avg_temp_max_c','condition_labeling_method']
BACK_TARGET=['as_of_date','forecast_end_exclusive','sensor_id','actual_future_90d_mean','actual_future_90d_mean_p90','actual_future_90d_warning_day_rate','actual_future_90d_warning_days','actual_future_90d_condition','actual_future_90d_trend','actual_future_90d_rainfall_mm','ground_truth_source']


def quant(values,p):
 if not values:return ''
 idx=(len(values)-1)*p;a=int(idx);f=idx-a
 return values[a]*(1-f)+values[min(len(values)-1,a+1)]*f

def daily_status(sid,warning_samples,vals):
 if TYPE[sid]=='water_leakage' and any(float(x)>=1 for x in vals):return 'critical'
 if warning_samples>=36:return 'warning'
 if warning_samples>=12:return 'watch'
 return 'normal'

def status90(warn_frac,critical=False):
 if critical:return 'critical'
 return 'warning' if warn_frac>=.12 else 'watch' if warn_frac>=.035 else 'normal'

def trend_fn(a,b,kind):
 if not a or not b:return 'uncertain'
 w0=sum(r['status'] in ('watch','warning','critical') for r in a)/len(a)
 w1=sum(r['status'] in ('watch','warning','critical') for r in b)/len(b)
 if abs(w1-w0)>=.06:return 'deteriorating' if w1>w0 else 'improving'
 if kind in ('occupancy','water_leakage','rainfall_intensity'):return 'stable'
 m0=statistics.mean(r['mean'] for r in a if r['mean']!='')
 m1=statistics.mean(r['mean'] for r in b if r['mean']!='')
 tol={'temperature':.65,'humidity':3.0,'co2':75,'light':45,'power':.35}.get(kind,1)
 if abs(m1-m0)>tol:
  if kind in ('temperature','humidity','co2','power'):
   return 'deteriorating' if m1>m0 else 'improving'
  return 'changing'
 return 'stable'

def run(root,output):
 root=Path(root);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 daily_by_sid=collections.defaultdict(list)
 calendar_all={};head_by_date=collections.defaultdict(list);wet_by_date=collections.defaultdict(list)
 # This is a contextual summary; only observed historical data, not future covariates.
 for y in range(2019,2026):
  folder=root/str(y)
  with (folder/'calendar.csv').open(newline='',encoding='utf-8') as f:
   for row in csv.DictReader(f):calendar_all[row['date']]=row
  with (folder/'training_features_open_office.csv').open(newline='',encoding='utf-8') as f:
   for row in csv.DictReader(f):
    d=row['timestamp'][:10]
    if row['headcount']!='':head_by_date[d].append(int(row['headcount']))
    if row['rain_wet']!='':wet_by_date[d].append(int(row['rain_wet']))
  with (folder/'sensor_history.csv').open(newline='',encoding='utf-8') as f:
   current=None;buffers=collections.defaultdict(list);missing=collections.Counter();warnings=collections.Counter();wsource=json.loads((folder/'run_manifest.json').read_text())['weather_provenance']
   def write_day(d):
    cal=calendar_all[d];work=cal['is_workday']=='1'
    meanocc=round(statistics.fmean(head_by_date[d]),2) if head_by_date[d] else 0
    rainfrac=round(statistics.fmean(wet_by_date[d]),3) if wet_by_date[d] else 0
    for sid in SID:
     xs=sorted(buffers[sid]);typ=TYPE[sid]
     if not xs:raise ValueError(f'No readings at all {d} {sid}')
     status=daily_status(sid,warnings[sid],xs)
     daily_by_sid[sid].append({'date':d,'sid':sid,'rid':ROOM[sid],'typ':typ,
       'valid':len(xs),'missing':missing[sid],'mean':round(statistics.fmean(xs),3),
       'p10':round(quant(xs,.1),3),'p50':round(quant(xs,.5),3),'p90':round(quant(xs,.9),3),
       'min':min(xs),'max':max(xs),'warn':warnings[sid],'status':status,
       'rainmm':round(sum(xs)/12,3) if typ=='rainfall_intensity' else '',
       'occupiedh':round(sum(xs)/12,3) if typ=='occupancy' else '',
       'kwh':round(sum(xs)/12,3) if typ=='power' else '',
       'holiday':int(cal['is_holiday']),'workday':int(work),'headcount':meanocc,'wet':rainfrac,'weather':wsource})
   for row in csv.DictReader(f):
    d=row['timestamp'][:10];sid=row['sensor_id'];typ=row['sensor_type']
    if current is None:current=d
    if d!=current:
     write_day(current);buffers=collections.defaultdict(list);missing=collections.Counter();warnings=collections.Counter();current=d
    if row['value']=='':missing[sid]+=1;continue
    v=float(row['value']);buffers[sid].append(v)
    hr=int(row['timestamp'][11:13]);working=calendar_all[d]['is_workday']=='1'
    # Reference thresholds are illustrative. Warnings ≠ confirmed faults.
    occupied_window=working and 8<=hr<19
    abnormal=(typ=='temperature' and occupied_window and (v>27 or v<21.5)) or \
     (typ=='humidity' and occupied_window and v>75) or \
     (typ=='co2' and occupied_window and v>1100) or \
     (typ=='power' and (hr<7 or hr>=19 or not working) and v>2.35) or \
     (typ=='water_leakage' and v>0.5)
    if abnormal:warnings[sid]+=1
   if current:write_day(current)
  print(f'Derived daily summaries {y}',flush=True)
 del head_by_date,wet_by_date
 with (output/'daily_sensor_conditions.csv').open('w',newline='',encoding='utf8') as f:
  w=csv.writer(f);w.writerow(DAILY_HEAD)
  for sid in SID:
   for r in daily_by_sid[sid]:w.writerow([r[k] for k in ('date','sid','rid','typ','valid','missing','mean','p10','p50','p90','min','max','warn','status','rainmm','occupiedh','kwh','holiday','workday','headcount','wet','weather')])
 with (output/'weekly_sensor_conditions.csv').open('w',newline='',encoding='utf8') as f:
  w=csv.writer(f);w.writerow(WEEK_HEAD)
  for sid in SID:
   groups=collections.defaultdict(list)
   for r in daily_by_sid[sid]:
    d=date.fromisoformat(r['date']);k=(d-timedelta(days=d.weekday())).isoformat();groups[k].append(r)
   for k,xs in sorted(groups.items()):
    wd=sum(r['status'] in ('watch','warning','critical') for r in xs)
    rsum=sum(float(r['rainmm']) for r in xs if r['rainmm']!='') if TYPE[sid]=='rainfall_intensity' else ''
    esum=sum(float(r['kwh']) for r in xs if r['kwh']!='') if TYPE[sid]=='power' else ''
    w.writerow([k,sid,ROOM[sid],TYPE[sid],len(xs),round(statistics.fmean(r['mean'] for r in xs),3),round(statistics.fmean(r['p90'] for r in xs),3),wd,status90(wd/len(xs)),rsum,esum,xs[0]['weather']])
 # Rolling-origin 90-day ground truth for last 2 calendar years; NEVER give targets to the LLM.
 with (output/'forecast_90day_inputs.csv').open('w',newline='',encoding='utf8') as fi,(output/'forecast_90day_targets_HIDDEN.csv').open('w',newline='',encoding='utf8') as ft:
  wi=csv.writer(fi);wt=csv.writer(ft);wi.writerow(BACK_INPUT);wt.writerow(BACK_TARGET)
  for y in (2024,2025):
   for month in range(1,13):
    origin=date(y,month,1);prev=(origin-timedelta(days=90)).isoformat()
    prev2=(origin-timedelta(days=180)).isoformat();future_end=origin+timedelta(days=90)
    if future_end>date(2026,1,1):continue
    future_days=[origin+timedelta(days=k) for k in range(90)]
    workdays=sum(calendar_all[d.isoformat()]['is_workday']=='1' for d in future_days)
    holiday_days=sum(calendar_all[d.isoformat()]['is_holiday']=='1' for d in future_days)
    rainclim=sum(CLIMATE[d.month][2]/calendar.monthrange(d.year,d.month)[1] for d in future_days)/90
    climtmin=sum(CLIMATE[d.month][0] for d in future_days)/90
    climtmax=sum(CLIMATE[d.month][1] for d in future_days)/90
    for sid in SID:
     allr=daily_by_sid[sid]
     p=[r for r in allr if prev<=r['date']<str(origin)]
     pp=[r for r in allr if prev2<=r['date']<prev]
     fut=[r for r in allr if str(origin)<=r['date']<str(future_end)]
     if len(p)!=90 or len(pp)!=90 or len(fut)!=90:continue
     mean=lambda x:round(statistics.fmean(r['mean'] for r in x),3)
     rate=lambda x:round(sum(r['status']!='normal' for r in x)/len(x),4)
     cond=status90(rate(fut),any(r['status']=='critical' for r in fut))
     wi.writerow([origin,future_end,90,sid,ROOM[sid],TYPE[sid],mean(p),round(statistics.fmean(r['p90'] for r in p),3),rate(p),trend_fn(pp,p,TYPE[sid]),mean(pp),
          round(statistics.fmean(r['headcount'] for r in p),3),round(statistics.fmean(r['wet'] for r in p),3),holiday_days,workdays,
          round(rainclim,3),round(climtmin,3),round(climtmax,3),'illustrative_context_sensitive_thresholds'])
     wt.writerow([origin,future_end,sid,mean(fut),round(statistics.fmean(r['p90'] for r in fut),3),rate(fut),
         sum(r['status']!='normal' for r in fut),cond,trend_fn(p,fut,TYPE[sid]),
         round(sum(r['rainmm'] for r in fut if r['rainmm']!=''),3) if TYPE[sid]=='rainfall_intensity' else '', 'synthetic_held_out_truth'])
 info={'years':'2019-2025 inclusive','days':len(daily_by_sid[SID[0]]),'sensors':19,'daily_rows':sum(len(x) for x in daily_by_sid.values()),
       'note':'Prediction targets are hidden answer keys; no model was trained and no actual 90-day forecasts were produced.'}
 (output/'derive_manifest.json').write_text(json.dumps(info,indent=2))
 print('Done daily',info['daily_rows'],'weekly',sum(1 for _ in open(output/'weekly_sensor_conditions.csv'))-1,flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',default='generated/normal_by_year');p.add_argument('--out',default='generated/llm_reference');args=p.parse_args();run(args.root,args.out)
