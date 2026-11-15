import json
import unittest
from pathlib import Path
from simulator.core import SevenSensorSimulator
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
C=json.loads((ROOT/'config/simulation.json').read_text())
I=json.loads((ROOT/'config/sensors.json').read_text())
class TestSimulator(unittest.TestCase):
 def test_all_seven_types(self):
  e=SevenSensorSimulator(C,I)
  m,truth=e.step()
  self.assertEqual({x['sensor_type'] for x in m['readings']},{'temperature','humidity','co2','occupancy','light','power','water_leakage'})
  self.assertEqual(len(m['readings']),len(truth))
 def test_stage1_exact_allocation(self):
  e=SevenSensorSimulator(C,I)
  m,_=e.step()
  self.assertEqual(len(m['readings']),18)
  from collections import Counter
  self.assertEqual(dict(Counter(x['sensor_type'] for x in m['readings'])),
                   {'temperature':2,'humidity':3,'co2':2,'occupancy':4,'light':4,'water_leakage':2,'power':1})
  self.assertEqual(len({x['sensor_id'] for x in m['readings']}),18)
 def test_cleaning_room_is_not_continuously_occupied(self):
  e=SevenSensorSimulator(C,I,start_time='2026-10-30T09:16:00+08:00')
  m,_=e.step()
  x=next(x for x in m['readings'] if x['room_id']=='L03-CLEAN-01' and x['sensor_type']=='occupancy')
  self.assertEqual(x['value'],1)
 def test_reproducibility(self):
  a=SevenSensorSimulator(C,I);b=SevenSensorSimulator(C,I)
  for i in range(30): self.assertEqual(a.step(),b.step())
 def test_physical_bounds(self):
  e=SevenSensorSimulator(C,I)
  for i in range(300):
   m,_=e.step()
   for x in m['readings']:
    if x['sensor_type']=='humidity':self.assertTrue(0<=x['value']<=100)
    if x['sensor_type'] in ('occupancy','water_leakage'):self.assertIn(x['value'],(0,1))
    if x['sensor_type'] in ('light','power'):self.assertGreaterEqual(x['value'],0)
 def test_fault_truth_not_live(self):
  e=SevenSensorSimulator(C,I,fault_mode='demo')
  for i in range(C['fault_start_minute']+1):m,truth=e.step()
  self.assertTrue(any(x['fault_active'] for x in truth))
  self.assertNotIn('fault_active',json.dumps(m))

class TestSOPV15(unittest.TestCase):
  def test_multiple_events_per_day(self):
    import copy
    cfg = copy.deepcopy(C)
    cfg['live_faults']['events_per_day_probabilities'] = {
        '0': 0, '1': 0, '2': 0, '3': 1
    }

    sim = SevenSensorSimulator(
        cfg, I, start_time='2026-11-02T00:00:00+08:00',
        fault_mode='live'
    )
    sim.step()
    self.assertEqual(len(sim.events), 3)

  def test_no_same_sensor_overlap(self):
      import copy
      cfg = copy.deepcopy(C)
      cfg['live_faults']['events_per_day_probabilities'] = {
          '0': 0, '1': 0, '2': 0, '3': 1
      }

      sim = SevenSensorSimulator(
          cfg, I, start_time='2026-11-02T00:00:00+08:00',
          fault_mode='live'
      )
      for _ in range(1440 * 7):
          sim.step()

      for i, a in enumerate(sim.events):
          for b in sim.events[i + 1:]:
              if a['sensor_id'] == b['sensor_id']:
                  self.assertFalse(
                      a['start'] < b['end'] and b['start'] < a['end']
                  )
  def test_normal_has_no_injected_labels(self):
    sim = SevenSensorSimulator(C, I, fault_mode='normal')
    for _ in range(400):
        _, labels = sim.step()
        self.assertFalse(any(x['fault_active'] for x in labels))
  def test_live_random_events_seeded_sparse_and_eligible(self):
    a = SevenSensorSimulator(
        C, I, start_time='2026-10-30T00:00:00+08:00',
        seed=437119, fault_mode='live'
    )
    b = SevenSensorSimulator(
        C, I, start_time='2026-10-30T00:00:00+08:00',
        seed=437119, fault_mode='live'
    )

    for _ in range(1440 * 3):
        self.assertEqual(a.step(), b.step())

    daily_counts = Counter(e['start'].date() for e in a.events)
    self.assertTrue(all(count <= 3 for count in daily_counts.values()))

    for e in a.events:
        self.assertIn(e['sensor_type'], C['abnormal_scenarios'])
        self.assertIn(e['room_id'], [r['room_id'] for r in I['rooms']])
  def test_demo_meeting_co2_rises_when_ventilation_reduced(self):
    sim = SevenSensorSimulator(C, I, fault_mode='demo')
    vals = []

    for _ in range(301):
        m, _ = sim.step()
        if 180 <= sim.tick <= 300:
            vals.append(next(
                r['value'] for r in m['readings']
                if r['room_id'] == 'L03-MEET-01'
                and r['sensor_type'] == 'co2'
            ))

    self.assertGreater(vals[-1] - vals[0], 600)
  
if __name__ == '__main__':
    unittest.main()
