"""As-of-bounded read-only retrieval tools for 90-day forecast evidence packets.
This layer never opens evaluation keys. Tool outputs carry observations, not answers.
"""
from __future__ import annotations
import statistics
from datetime import date, timedelta
from typing import Any


def tool(name, desc, props=None):
    return {'type':'function','function':{'name':name,'description':desc,
      'parameters':{'type':'object','properties':props or {},'required':[], 'additionalProperties':False}}}

TOOL_SPECS=[
 tool('get_sensor_metadata','Get sensor metadata, unit and forecast origin.'),
 tool('get_recent_daily_patterns','Get historical daily sensor readings, strictly before forecast origin.',{'days':{'type':'integer','description':'How many recent historical days, 7 to 180'}}),
 tool('get_weekly_patterns','Get historical weekly patterns, strictly before forecast origin.',{'weeks':{'type':'integer','description':'How many weeks, 4 to 52'}}),
 tool('get_historical_summary','Calculate descriptive summaries of past daily and weekly observations; no future outcomes.'),
 tool('get_operating_context','Get known past office operation context and known future schedule/climatology, never future observed values.'),
]
ALLOWED={t['function']['name']:t for t in TOOL_SPECS}
class ForecastTools:
 def __init__(self, packet):
  self.packet=packet
  self.origin=packet['as_of_date']
  self.used=[]
  if packet.get('forecast_kind')!='scenario':
   for x in packet.get('daily_history',[]):
    if not x['date']<self.origin:raise ValueError('Future daily observations in input')
   for x in packet.get('weekly_history',[]):
    if not date.fromisoformat(x['week_start'])+timedelta(days=7)<=date.fromisoformat(self.origin):
     raise ValueError('Overlapping future weekly observations in input')
  else:
   for x in packet.get('history_visible',[]):
    if not x['date']<self.origin:raise ValueError('Future scenario observations in input')
   for x in packet.get('future_calendar_climatology_only',[]):
    if any('actual' in k.lower() or 'target' in k.lower() for k in x):
     raise ValueError('Forbidden future target in known future data')
 def specifications(self):return TOOL_SPECS
 def execute(self,name,args):
  if name not in ALLOWED:raise ValueError('Unapproved tool')
  if not isinstance(args,dict):raise ValueError('Tool args must be object')
  if set(args)-set(ALLOWED[name]['function']['parameters']['properties']):raise ValueError('Invalid tool arguments')
  value=getattr(self,name)(**args)
  self.used.append({'tool':name,'arguments':args,'result':value})
  return value
 def get_sensor_metadata(self):
  p=self.packet
  return {'case_id':p['case_id'],'as_of_date':self.origin,'sensor':p.get('sensor'),
    'task':'forecast_90_day','horizon_days':90,'scenario':p.get('forecast_kind')=='scenario'}
 def get_recent_daily_patterns(self,days=90):
  if not isinstance(days,int) or not 7<=days<=180:raise ValueError('days must be 7..180')
  rows=self.packet.get('daily_history',self.packet.get('history_visible',[]))
  return {'as_of_date':self.origin,'records':rows[-days:],'available_records':len(rows),
          'sampling_note':'Historical records may be downsampled during dataset preparation'}
 def get_weekly_patterns(self,weeks=26):
  if not isinstance(weeks,int) or not 4<=weeks<=52:raise ValueError('weeks must be 4..52')
  rows=self.packet.get('weekly_history',[])
  if not rows:return {'records':[],'note':'No pre-aggregated weekly rows for scenario. Use daily scenario history instead.'}
  return {'as_of_date':self.origin,'records':rows[-weeks:]}
 def get_historical_summary(self):
  p=self.packet; rows=p.get('daily_history',[])
  if rows:
   values=[float(x['mean']) for x in rows if x.get('mean') not in ('',None)]
   if not values:return {'n':0}
   k=min(20,len(values));old=values[:k];new=values[-k:]
   return {'n_observed_daily_rows':len(values),'mean':round(statistics.mean(values),4),
       'median':round(statistics.median(values),4),'recent_mean':round(statistics.mean(new),4),
       'earlier_mean':round(statistics.mean(old),4),'recent_minus_earlier':round(statistics.mean(new)-statistics.mean(old),4),
       'note':'Descriptive historical trend only. No precomputed forecast/condition or anomaly flag.'}
  rows=p.get('history_visible',[])
  if not rows:return {'n':0}
  fields=['indoor_temp_daily_peak_c','indoor_humidity_mean_pct','co2_daily_peak_ppm','floor_energy_kwh','open_office_headcount_avg','local_rain_mm_total']
  data={}
  for f in fields:
   vals=[]
   for r in rows:
    try:vals.append(float(r[f]))
    except (TypeError,ValueError,KeyError):pass
   if vals:
    k=min(14,len(vals))
    data[f]={'n':len(vals),'mean':round(statistics.mean(vals),3),
             'first_14_mean':round(statistics.mean(vals[:k]),3),
             'last_14_mean':round(statistics.mean(vals[-k:]),3)}
  return {'n_days':len(rows),'historical_features':data,'note':'No future observed outcomes used'}
 def get_operating_context(self):
  p=self.packet
  if p.get('forecast_kind')=='scenario':
   fc=p.get('future_calendar_climatology_only',[])
   # 90 rows can exceed model context, summarize known covariates; no measured future readings.
   keys=['known_public_holiday','planned_workday','climatology_expected_rain_mm_day','climatology_daily_min_temp_c','climatology_daily_max_temp_c']
   summ={}
   for k in keys:
    vals=[]
    for x in fc:
     try:vals.append(float(x[k]))
     except (TypeError,ValueError,KeyError):pass
    if vals:summ[k]={'n':len(vals),'mean':round(statistics.mean(vals),3),'sum':round(sum(vals),3)}
   plans=sorted(set(str(r.get('headcount_plan_known','')) for r in fc))
   return {'future_known_only':True,'calendar_climatology_summary':summ,'headcount_plan':plans[:10]}
  return {'forecast_input':p.get('forecast_input',{}),'note':'Fields are historical summaries and forecast-origin-known assumptions, not future actual observations.'}
