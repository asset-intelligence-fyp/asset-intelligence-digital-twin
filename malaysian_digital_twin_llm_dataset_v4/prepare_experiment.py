#!/usr/bin/env python3
"""Create model/LLM metadata, 2026 known-in-advance scenario inputs and small tests."""
import csv,calendar,json
from datetime import date,timedelta
from pathlib import Path
from generate import SENSOR,ROMS,CLIMATE

root=Path(__file__).resolve().parent
meta=root/'generated'/'llm_reference';meta.mkdir(parents=True,exist_ok=True)
ROOM_LOOKUP={r[0]:r for r in ROMS}
INFLUENCES={
 'temperature':'outdoor heat;solar exposure;occupant heat;AC schedule;cooling problems',
 'humidity':'outdoor relative humidity;local rain and wetness lag;AC dehumidification;occupants;water ingress',
 'co2':'headcount;ventilation rate;room volume;time lag;meeting bookings',
 'occupancy':'badge events;meeting attendance;cleaning activity;motion sensor state',
 'light':'occupancy;lighting schedule;daylight and cloud cover',
 'water_leakage':'water presence in local wet areas;leak faults;not directly predictable from precipitation',
 'power':'floor-level AC operation;people;lighting;outdoor temperature;after-hours loads',
 'rainfall_intensity':'local precipitation;geographic differences from NASA regional grid rainfall'}
UNITS={'temperature':'°C','humidity':'%RH','co2':'ppm','occupancy':'binary','light':'lux','water_leakage':'binary','power':'kW','rainfall_intensity':'mm/h'}
with (meta/'sensor_registry.csv').open('w',newline='',encoding='utf8') as f:
 w=csv.writer(f);w.writerow(['sensor_id','room_id','sensor_type','unit','scope','primary_influences','synthetic','rain_context_policy'])
 for sid,rid,typ,unit in SENSOR:
  w.writerow([sid,rid,typ,unit,'building_rooftop' if typ=='rainfall_intensity' else 'floor_level' if typ=='power' else 'room_level',
    INFLUENCES[typ],1,'rain itself normal; use local rain as context' if typ=='rainfall_intensity' else 'consider local rainfall timing and AC dehumidification' if typ=='humidity' else 'not directly linked'])
with (meta/'room_metadata.csv').open('w',newline='',encoding='utf8') as f:
 w=csv.writer(f);w.writerow(['room_id','room_name','type','area_m2_ASSUMED','ceiling_height_m_ASSUMED','volume_m3_ASSUMED','max_capacity_ASSUMED','seat_count_ASSUMED','orientation_ASSUMED','ac_zone_id'])
 for r in ROMS:
  rid,name,typ,area,height,cap,seats,orient,zone=r
  w.writerow([rid,name,typ,area,height,round(area*height,1),cap,seats,orient,zone])
# 2026 Q1 known future planning calendar. This is not a measured weather forecast.
holidays={}
with (root/'data'/'holidays_sarawak_2019_2025.csv').open(newline='',encoding='utf8') as f:
 for r in csv.DictReader(f):holidays[r['date']]=r['holiday_name']
with (meta/'future_known_inputs_2026_q1.csv').open('w',newline='',encoding='utf8') as f:
 w=csv.writer(f);w.writerow(['date','day_of_week','holiday_name_known_in_advance','is_workday_planned','planning_attendance_factor_ASSUMED','climate_mean_daily_min_c_NOT_FORECAST','climate_mean_daily_max_c_NOT_FORECAST','climate_average_rain_mm_day_NOT_FORECAST','climate_rain_day_probability_NOT_FORECAST','future_exogenous_policy'])
 d=date(2026,1,1)
 while d<date(2026,4,1):
  mind,maxd,rain,wet=CLIMATE[d.month];iswork=d.weekday()<5 and str(d) not in holidays
  factor=0 if not iswork else .72 if d.weekday()==0 else .68 if d.weekday()==4 else .85
  w.writerow([d.isoformat(),d.weekday(),holidays.get(str(d),''),int(iswork),factor,
    mind,maxd,round(rain/calendar.monthrange(d.year,d.month)[1],2),round(wet/calendar.monthrange(d.year,d.month)[1],3),
    'Only climate normals/planned workday known. Actual rain, future occupancy and faults are hidden.'])
  d+=timedelta(days=1)
# Example LLM prompt contract, no embedded ground-truth labels.
contract={
 'task':'Zero-shot/in-context anomaly analysis or 13-week condition forecasting',
 'training_or_fine_tuning':False,'vector_embeddings':False,
 'allowed_input_sources':['past sensor_history','room_metadata','past weather/rain gauge','occupancy/headcount observations','past AC states','calendar known as of origin','WMO climate normals','historical normal reference segments'],
 'forbidden_input_sources':['future actual observations after as_of_date','ground_truth_labels.csv','ground_truth_events.csv','forecast_90day_targets_HIDDEN.csv'],
 'anomaly_output_schema':{'sensor_id':'string','as_of':'ISO-8601','anomaly':'bool','severity':'normal|watch|warning|critical|unknown',
  'evidence':['reading + timestamp + unit'],'alternative_explanations':['plausible cause, not diagnosis'],'action':'string'},
 'forecast_output_schema':{'sensor_id':'string','origin':'ISO-date','horizon_days':90,'weekly_outlook':[{'week_start':'YYYY-MM-DD','central_reference_value':'number or null','range_low':'number or null','range_high':'number or null','status':'normal|watch|warning|unknown','trend':'stable|improving|deteriorating|uncertain'}],
  'overall_condition':'normal|watch|warning|unknown','overall_trend':'stable|improving|deteriorating|uncertain','assumptions':['text'],'uncertainty':'text'},
 'numeric_forecast_policy':'Never assert uncalibrated model probabilities. Ranges may be scenario bands, not confidence intervals.',
 'safety_alert_policy':'Real-time hard safety alerts should be deterministic; LLM is additional contextual analyst.'}
(meta/'llm_input_output_contract.json').write_text(json.dumps(contract,indent=2,ensure_ascii=False))
print('Prepared registry, room metadata, known 2026 Q1 inputs and LLM contract')
