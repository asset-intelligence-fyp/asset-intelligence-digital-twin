import sys, unittest, json, tempfile, csv, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from independent_hvac_core import ThreeHRUIndependent,BIM_POINTS,AUX_FIELDS,FAULTS
profile=json.loads((ROOT/'reference/train_only_weather_calibration.json').read_text())

class StreamTests(unittest.TestCase):
    def engine(self,**kw):return ThreeHRUIndependent(profile,**kw)
    def test_reproducible_and_seed_independent(self):
        a=self.engine(seed=111,fault_mode='normal');b=self.engine(seed=111,fault_mode='normal');c=self.engine(seed=112,fault_mode='normal')
        va,_=a.step();vb,_=b.step();vc,_=c.step()
        self.assertEqual(va,vb);self.assertNotEqual(va,vc)
    def test_schema_sensible_and_temporal_variation(self):
        a=self.engine(seed=12,fault_mode='normal')
        rows=[a.step()[0] for _ in range(220)]
        for row in rows:
            self.assertTrue(all(k in row for k in (*BIM_POINTS,*AUX_FIELDS,'timestamp')))
            self.assertTrue(0<=row['DP-504']<=100)
            self.assertTrue(0<=row['CV-507']<=100)
            self.assertTrue(row['FS-501A'] in (0,1))
        self.assertNotEqual(rows[0]['SAT-501A'],rows[-1]['SAT-501A'])
        self.assertNotEqual(rows[0]['SAT-501A'],rows[0]['SAT-504'])
        self.assertEqual(rows[0]['timestamp'],'2026-07-01 10:00:00')
    def test_stuck_damper_recording_and_command_mismatch(self):
        a=self.engine(fault_mode='damper_stuck',initial_fault_after_minutes=8)
        rows=[];active=[]
        for i in range(80):
            row,f=a.step();rows.append(row);active.append(f)
        self.assertIsNone(active[7]);self.assertEqual(active[8].event_type,'damper_stuck')
        self.assertLess(max(rows[i]['DP-504'] for i in range(10,75))-min(rows[i]['DP-504'] for i in range(10,75)),1.1)
        self.assertTrue(a.count==1)
    def test_valve_stuck_tracks_engine_state(self):
        a=self.engine(fault_mode='valve_stuck',initial_fault_after_minutes=8)
        for i in range(60):v,f=a.step()
        self.assertIsNotNone(f)
        self.assertEqual(f.event_type,'valve_stuck')
        self.assertLess(abs(a.vactual-f.fixed_value),1e-8)
    def test_drift_is_visible_and_labeled_separately(self):
        a=self.engine(seed=123,fault_mode='sensor_drift',initial_fault_after_minutes=5)
        b=self.engine(seed=123,fault_mode='normal',initial_fault_after_minutes=5)
        ra=rb=None
        for _ in range(250):ra,fa=a.step();rb,fb=b.step()
        self.assertGreater(abs(ra['S-L5-008-TEMP']-rb['S-L5-008-TEMP']),.2)
        self.assertEqual(fa.event_type,'sensor_drift');self.assertIsNone(fb)
    def test_publisher_does_not_leak_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable,str(ROOT/'scripts/simulate_live.py'),
                '--ticks','12','--interval-seconds','.001','--initial-fault-after-minutes','3',
                '--fault-mode','sensor_spike','--out-dir',tmp,'--quiet'],check=True,stdout=subprocess.PIPE)
            base=Path(tmp)
            latest=json.loads((base/'latest.json').read_text())
            self.assertNotIn('event_type',str(latest));self.assertNotIn('event_id',str(latest))
            with (base/'telemetry_history.csv').open() as f:
                rows=list(csv.DictReader(f))
            self.assertEqual(len(rows),12)
            self.assertEqual(list(rows[0].keys())[0],'timestamp')
            self.assertNotIn('active', rows[0]);self.assertNotIn('event_type',rows[0])
            self.assertGreater((base/'ground_truth_events.csv').stat().st_size,100)

if __name__=='__main__':unittest.main()

