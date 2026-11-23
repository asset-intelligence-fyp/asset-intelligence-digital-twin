#!/usr/bin/env python3
"""Create challenging *separate* scenario-driven 90-day warning forecast cases.

60 counterfactual examples are not extra observed historical measurements.
The case scenarios are hidden during inference; prior 90 days are visible;
subsequent 90 days and hidden case labels are ONLY for evaluation.
"""
import csv,random,math,statistics,calendar,collections,json
from datetime import date,timedelta
from pathlib import Path
from generate import CLIMATE,clip,holidays_from_csv

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'generated'/'llm_reference';OUT.mkdir(parents=True,exist_ok=True)
CASE_TYPES=['stable_control','cooling_gradual_degradation','ventilation_gradual_degradation',
            'moisture_intrusion_trend','staff_growth_without_fault','rainy_season_normal']
PREFIX=['case_id','date','as_of_date','room_id','open_office_headcount_avg','local_rain_detected',
        'local_rain_mm_total','ac_operating','indoor_temp_daily_peak_c','indoor_humidity_mean_pct',
        'co2_daily_peak_ppm','floor_energy_kwh','public_holiday','weather_source','source']
FORECAST_KNOWN=['case_id','future_date','as_of_date','known_public_holiday','planned_workday','climatology_expected_rain_mm_day','climatology_daily_min_temp_c','climatology_daily_max_temp_c','headcount_plan_known','source']
SUMMARY=['case_id','scenario_HIDDEN','target_sensor_id','forecast_origin','end_exclusive','previous_90d_target_peak','future_90d_target_peak','first_future_warning_date','future_warning_day_count','future_condition','future_trend','source']

def run():
 hol=holidays_from_csv(ROOT/'data'/'holidays_sarawak_2019_2025.csv')
 origin=date(2026,1,1)
 with (OUT/'forecast_cases_history_VISIBLE.csv').open('w',newline='',encoding='utf8') as fa,(OUT/'forecast_cases_future_known_VISIBLE.csv').open('w',newline='',encoding='utf8') as fk,(OUT/'forecast_cases_future_HIDDEN.csv').open('w',newline='',encoding='utf8') as fb,(OUT/'forecast_cases_truth_summary_HIDDEN.csv').open('w',newline='',encoding='utf8') as fs:
  wa=csv.writer(fa);wa.writerow(PREFIX)
  wk=csv.writer(fk);wk.writerow(FORECAST_KNOWN)
  wb=csv.writer(fb);wb.writerow(PREFIX)
  ws=csv.writer(fs);ws.writerow(SUMMARY)
  case=0
  for typ in CASE_TYPES:
   for instance in range(10):
    case+=1;caseid=f'CASE-{case:03}';rng=random.Random(311203+case*101)
    historical=[];future=[]
    for dayoffset in range(-90,90):
     d=origin+timedelta(days=dayoffset)
     mind,maxd,rainmm,rain_days=CLIMATE[d.month]
     work=d.weekday()<5 and d not in hol
     normal_head=rng.randint(12,28) if work else 0
     if typ=='staff_growth_without_fault':
      normal_head=int(normal_head*(1+clip((dayoffset+35)*.0032,0,.42)))
     head=normal_head
     rainwet=rng.random()<rain_days/calendar.monthrange(d.year,d.month)[1]
     rain_total=rng.gammavariate(1.5,(rainmm/rain_days)/1.5) if rainwet else 0
     temp_out=(mind+maxd)/2+rng.gauss(0,.45)-.25*int(rainwet)
     humid_out=80+5*int(rainwet)-.7*(temp_out-27)+rng.gauss(0,1.2)
     ac=int(work)
     temp_peak=24.6+.12*(temp_out-27)+.022*head+rng.gauss(0,.2)
     rh=59+.20*(humid_out-75)+.09*head+2.6*int(rainwet)+rng.gauss(0,1.05)
     co2peak=425+head*19+rng.gauss(0,30)
     energy=(14.5 if not work else 38+head*.62+.2*max(0,temp_out-28)) + rng.gauss(0,2)
     if typ=='cooling_gradual_degradation':
      drift=max(0,dayoffset+55)*.015
      temp_peak+=drift;energy+=1.3*drift
     if typ=='ventilation_gradual_degradation':
      drift=max(0,dayoffset+52)*4.8
      co2peak+=drift if head else 0
      rh+=.008*drift
     if typ=='moisture_intrusion_trend':
      drift=max(0,dayoffset+56)*.10
      rh+=drift*(1.0 if rainwet else .38)
     if typ=='rainy_season_normal':
      # Moist rainy season is not a fault; working AC controls indoor RH.
      rh+=.25*int(rainwet)
     vals=[caseid,str(d),str(origin),'L03-OPEN-01',head,int(rainwet),round(rain_total,2),ac,round(temp_peak,2),round(rh,2),round(co2peak),round(energy,2),int(d in hol),'WMO_NORMALS_SIMULATED','counterfactual_synthetic']
     if dayoffset<0:
      wa.writerow(vals);historical.append(vals)
     else:
      wb.writerow(vals);future.append(vals)
      wk.writerow([caseid,str(d),str(origin),int(d in hol),int(work),round(rainmm/calendar.monthrange(d.year,d.month)[1],2),mind,maxd,'staffing plan unchanged' if typ!='staff_growth_without_fault' else 'staffing expansion possible','only_future_calendar_and_climatology'])
    target=({'cooling_gradual_degradation':'TEMP-L03-OPEN-01',
             'ventilation_gradual_degradation':'CO2-L03-OPEN-01',
             'moisture_intrusion_trend':'RH-L03-OPEN-01',
             'staff_growth_without_fault':'CO2-L03-OPEN-01',
             'rainy_season_normal':'RH-L03-OPEN-01',
             'stable_control':'TEMP-L03-OPEN-01'})[typ]
    ix={'TEMP-L03-OPEN-01':8,'RH-L03-OPEN-01':9,'CO2-L03-OPEN-01':10}[target]
    threshold={'TEMP-L03-OPEN-01':27.0,'RH-L03-OPEN-01':75.0,'CO2-L03-OPEN-01':1100}[target]
    warning_days=[r for r in future if int(r[12])==0 and float(r[ix])>threshold]
    pastlast=[float(r[ix]) for r in historical[-20:] if int(r[12])==0]
    futurelast=[float(r[ix]) for r in future[-20:] if int(r[12])==0]
    delta=(statistics.mean(futurelast)-statistics.mean(pastlast)) if (pastlast and futurelast) else 0
    tolerance={'TEMP-L03-OPEN-01':.7,'RH-L03-OPEN-01':3.0,'CO2-L03-OPEN-01':150}[target]
    trend='deteriorating' if delta>tolerance and typ!='staff_growth_without_fault' else 'stable' if abs(delta)<=tolerance or typ=='staff_growth_without_fault' else 'improving'
    # Long-term operational risk, not a certified equipment-health classification.
    condition='warning' if len(warning_days)>=12 else 'watch' if len(warning_days)>=3 else 'normal'
    ws.writerow([caseid,typ,target,origin,origin+timedelta(days=90),round(max(float(r[ix]) for r in historical),2),
      round(max(float(r[ix]) for r in future),2),warning_days[0][1] if warning_days else '',len(warning_days),condition,trend,'counterfactual_held_out_truth'])
 info={'cases':case,'scenarios':CASE_TYPES,'origin':'2026-01-01','past_days':90,'future_days':90,'future_labels_are_hidden':True,
       'note':'Artificial counterfactual trends, not actual future building readings or probabilistically calibrated forecast outputs.'}
 (OUT/'forecast_cases_manifest.json').write_text(json.dumps(info,indent=2))
 print('Created',case,'scenario-rich 90day forecasting test cases')

if __name__=='__main__':run()
