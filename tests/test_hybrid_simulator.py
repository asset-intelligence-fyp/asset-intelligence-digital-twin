import unittest,json,math,tempfile
from pathlib import Path
from tools.hybrid_simulator.engine import HybridSimulator,HERE,stamp,BOUNDS
from tools.hybrid_simulator.calibrate import solve,Regression,Source
class HybridTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.profile=json.loads((HERE/'profile.json').read_text())
 def sim(self,seed=10,start='2026-11-05T00:00:00+08:00',**kwargs):return HybridSimulator(self.profile,seed,start,300,**kwargs)
 def test_seed_reproducibility_and_new_trajectories(self):
  a,b,c=self.sim(),self.sim(),self.sim(11)
  aa=[a.step()[0] for _ in range(50)];bb=[b.step()[0] for _ in range(50)];cc=[c.step()[0] for _ in range(50)]
  self.assertEqual(aa,bb);self.assertNotEqual([x['readings'] for x in aa],[x['readings'] for x in cc])
  self.assertGreater(len({x['readings'][0]['value'] for x in aa}),10)
 def test_multi_day_finite_bounds_binary_ids_and_clock(self):
  s=self.sim();last=None
  for _ in range(288*8):
   b,truth=s.step();rows=b['readings'];self.assertEqual(len(rows),18);self.assertEqual(len({r['sensor_id'] for r in rows}),18);self.assertFalse(truth)
   t=stamp(b['dataset_timestamp']);self.assertTrue(last is None or (t-last).total_seconds()==300);last=t
   for r in rows:
    self.assertTrue(math.isfinite(r['value']))
    if r['unit']=='binary':self.assertIn(r['value'],[0,1])
    else:
     lo,hi=BOUNDS[r['sensor_type']];self.assertTrue(lo<=r['value']<=hi)
   w=b['simulation']['weather'];self.assertTrue(0<=w['outdoor_humidity_pct']<=100)
   if t.hour<6 or t.hour>=18:self.assertEqual(w['solar_radiation_w_m2'],0)
 def test_holiday_names_and_unknown_year_not_silently_repeated(self):
  s=self.sim();c=s.calendar(stamp('2026-06-01T12:00:00+08:00'));self.assertFalse(c['is_workday']);self.assertIn('Gawai',c['holiday_name'])
  c=s.calendar(stamp('2026-06-04T12:00:00+08:00'));self.assertFalse(c['is_workday'])
  c=s.calendar(stamp('2027-02-17T12:00:00+08:00'));self.assertFalse(c['calendar_complete']);self.assertIsNone(c['holiday_name'])
  c=s.calendar(stamp('2026-11-05T12:00:00+08:00'),'holiday');self.assertFalse(c['is_public_holiday']);self.assertFalse(c['is_workday'])
 def test_holiday_reduces_attendance_co2_light_and_power(self):
  work,holiday=self.sim(),self.sim();summary=[]
  for sim,mode in [(work,'workday'),(holiday,'holiday')]:
   rows=[]
   for _ in range(288):
    b,_=sim.step({'calendar_mode':mode});h=stamp(b['dataset_timestamp']).hour
    if 10<=h<17:rows.extend(b['readings'])
   summary.append({code:sum(r['value'] for r in rows if r['sensor_id']==code)/sum(r['sensor_id']==code for r in rows) for code in ['PIR-L03-OPEN-01','CO2-L03-OPEN-01','LUX-L03-OPEN-01','PWR-L03-PWR-POINT-01']})
  for code in summary[0]:self.assertGreater(summary[0][code],summary[1][code],code)
 def test_weather_intervention_changes_indoor_values_without_inventing_leaks(self):
  outcomes=[]
  for mode in ['clear','rain']:
   s=self.sim(start='2026-11-05T08:00:00+08:00');rows=[]
   for _ in range(120):
    b,_=s.step({'weather_mode':mode});rows.append(b)
    self.assertTrue(all(r['value']==0 for r in b['readings'] if r['sensor_type']=='water_leakage'))
   outcomes.append(rows)
  self.assertGreater(outcomes[0][-1]['simulation']['weather']['solar_radiation_w_m2'],outcomes[1][-1]['simulation']['weather']['solar_radiation_w_m2'])
  self.assertNotEqual([b['readings'][0]['value'] for b in outcomes[0]],[b['readings'][0]['value'] for b in outcomes[1]])
 def test_fault_truth_is_separate_and_faults_do_not_taint_normal_state(self):
  normal,demo=self.sim(fault_mode='normal'),self.sim(fault_mode='demo');found=set()
  for _ in range(30):
   a,_=normal.step();b,truth=demo.step();found.update(x['fault'] for x in truth)
   self.assertNotIn('injected_faults',json.dumps(b));self.assertNotIn('fault_mode',json.dumps(b));self.assertEqual(normal.values,demo.values)
   if not truth:self.assertEqual(a['readings'],b['readings'])
  self.assertEqual(found,{'temperature_drift','leak','missing'})
 def test_profile_provenance_and_chronological_holdout(self):
  p=self.profile;self.assertEqual(p['fit_period'],'2023-01-01/2024-12-31');self.assertEqual(p['validation_period'],'2025-01-01/2025-12-31');self.assertEqual(len(p['models']),12)
  self.assertNotIn('sensor_history',p);self.assertNotIn('ground_truth',p)
  for m in p['models'].values():self.assertGreater(m['holdout_2025']['n'],0);self.assertTrue(math.isfinite(m['holdout_2025']['rmse']))
 def test_malaysia_midnight_and_custom_company_calendar(self):
  s=HybridSimulator(self.profile,1,'2025-12-31T18:00:00Z',300);b,_=s.step();self.assertEqual(b['simulation']['calendar']['date'],'2026-01-01');self.assertFalse(b['simulation']['calendar']['is_workday'])
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'calendar.json';path.write_text(json.dumps({'2026-11-05':{'closed':True,'name':'Company day off'}}));s=self.sim(calendar_file=path);c=s.step()[0]['simulation']['calendar'];self.assertEqual(c['holiday_name'],'Company day off');self.assertFalse(c['is_workday']);self.assertIsNone(c['school_holiday'])
 def test_regression_learns_aggregate_response(self):
  r=Regression()
  for i in range(100):
   x=[1,i/100,0,0,0,0,0,0];r.add(x,20+3*x[1])
  m=r.export();self.assertAlmostEqual(m['coefficients'][1],3,delta=.7)
if __name__=='__main__':unittest.main()
