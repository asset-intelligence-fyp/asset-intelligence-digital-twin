import unittest
from tools.hybrid_simulator.experiment import compare

class PairedScenarioTests(unittest.TestCase):
 def test_weather_comparison_is_deterministic_and_has_correct_hours(self):
  args=('rain','RH-L03-OPEN-01','2026-11-18T09:00:00+08:00')
  a=compare(*args);b=compare(*args)
  self.assertEqual(a,b)
  self.assertEqual(a['seed'],42)
  self.assertEqual(len(a['baseline']),13)
  self.assertEqual([v['minute'] for v in a['baseline']],list(range(0,61,5)))
  self.assertNotEqual([v['value'] for v in a['baseline']],[v['value'] for v in a['intervention']])
  self.assertGreater(a['intervention'][-1]['weather']['rainfall_mm_per_h'],0)
  self.assertEqual(a['baseline'][-1]['weather']['rainfall_mm_per_h'],0)
 def test_occupancy_and_holiday_experiments_keep_source_context(self):
  busy=compare('busy','CO2-L03-OPEN-01','2026-11-18T09:00:00+08:00')
  self.assertEqual(busy['sensor_id'],'CO2-L03-OPEN-01')
  self.assertNotEqual([x['value'] for x in busy['baseline']],[x['value'] for x in busy['intervention']])
  holiday=compare('holiday','PIR-L03-OPEN-01','2026-11-18T09:00:00+08:00')
  self.assertTrue(all(x['value']==0 for x in holiday['intervention']))
 def test_invalid_scenario_and_sensor_are_rejected(self):
  with self.assertRaises(ValueError):compare('unknown','RH-L03-OPEN-01','2026-11-18T09:00:00+08:00')
  with self.assertRaises(ValueError):compare('rain','not-a-sensor','2026-11-18T09:00:00+08:00')

if __name__=='__main__':unittest.main()
