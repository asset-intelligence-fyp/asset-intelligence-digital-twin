"""Isolated, repeatable one-hour scenario comparison; never publishes or stores readings."""
from __future__ import annotations
import json,sys
from tools.hybrid_simulator.engine import HybridSimulator
SCENARIOS={
 'rain':({'weather_mode':'clear','calendar_mode':'workday'},{'weather_mode':'rain','calendar_mode':'workday'},'Clear weather','Rainy weather'),
 'busy':({'calendar_mode':'workday','attendance_factor':1},{'calendar_mode':'workday','attendance_factor':1.5},'Typical attendance','Busy attendance'),
 'holiday':({'calendar_mode':'workday'},{'calendar_mode':'holiday'},'Working day','Holiday'),
 'ac_off':({'calendar_mode':'workday','ac_mode':'on'},{'calendar_mode':'workday','ac_mode':'off'},'AC on','AC off'),
 'ventilation':({'calendar_mode':'workday','ventilation':1},{'calendar_mode':'workday','ventilation':2},'Normal ventilation','Increased ventilation'),
}
def compare(scenario,point_code,start_time):
 if scenario not in SCENARIOS:raise ValueError('Invalid scenario')
 a,b,a_label,b_label=SCENARIOS[scenario]
 def run(controls):
  sim=HybridSimulator(seed=42,start=start_time,step_seconds=300,fault_mode='normal')
  if point_code not in {p['code'] for p in sim.registry}:raise ValueError('Invalid sensor')
  samples=[]
  for i in range(13):
   batch,_=sim.step(controls)
   row=next(r for r in batch['readings'] if r['sensor_id']==point_code)
   samples.append({'minute':i*5,'time':row['timestamp'],'value':row['value'],'weather':batch['simulation']['weather'],'headcounts':batch['simulation']['simulated_headcounts']})
  return samples
 aa,bb=run(a),run(b)
 return {'scenario':scenario,'start_time':start_time,'sensor_id':point_code,'baseline_label':a_label,'intervention_label':b_label,'seed':42,'duration_minutes':60,'simulation_step_seconds':300,'synthetic':True,'baseline':aa,'intervention':bb}
if __name__=='__main__':
 if len(sys.argv)!=4:raise SystemExit('usage: experiment scenario point_code start_time')
 print(json.dumps(compare(*sys.argv[1:])))
