import csv,io,json,tempfile,unittest,zipfile,os
from pathlib import Path
from itertools import islice
from tools.dataset_replay.replay import Dataset,stamp,SPLITS
ROOT=Path(__file__).resolve().parents[1]
REGISTRY=json.loads((ROOT/'shared/sensorRegistry.json').read_text())
class ReplayTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
 def fixture(self,mutate=lambda rows:rows):
  folder=Path(self.temp.name)/SPLITS[1];folder.mkdir(exist_ok=True)
  (folder/'run_manifest.json').write_text(json.dumps(dict(generator='people_driven_v3.0',sensor_count=18,synthetic=True,faults=True,minutes=5)))
  rows=[dict(timestamp=t,sensor_id=p['code'],room_id=p['simulatorRoomId'],sensor_type=p['sensorType'],value=0 if p['unit']=='binary' else 26.34,unit=p['unit'],quality_flag='ok',sequence=i+1) for i,t in enumerate(['2026-01-01T00:00:00+08:00','2026-01-01T00:05:00+08:00']) for p in REGISTRY]
  rows=mutate(rows)
  with (folder/'sensor_history.csv').open('w') as f:
   w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
  return Dataset(Path(self.temp.name),SPLITS[1])
 def test_exact_values_and_time(self):
  rows=list(self.fixture().batches(REGISTRY));self.assertEqual(len(rows),2);self.assertEqual(rows[0]['readings'][0]['value'],26.34);self.assertEqual(rows[0]['dataset_timestamp'],'2026-01-01T00:00:00+08:00')
  self.assertNotIn('ground_truth',str(rows));self.assertEqual(len(rows[0]['readings']),18)
 def test_missing_is_null_and_annotations_do_not_leak(self):
  def change(rows):rows[0].update(value='',quality_flag='missing');rows[1].update(quality_flag='drift');return rows
  batch=next(self.fixture(change).batches(REGISTRY));self.assertIsNone(batch['readings'][0]['value']);self.assertEqual(batch['readings'][0]['quality_flag'],'missing');self.assertEqual(batch['readings'][1]['quality_flag'],'ok')
 def test_unknown_duplicate_incomplete_and_invalid_values_stop(self):
  def duplicate(rows):rows[1]=rows[0].copy();return rows
  def badunit(rows):rows[0]['unit']='bad';return rows
  def invalid(rows):rows[0]['value']='nan';return rows
  for mutate in [duplicate,badunit,invalid,lambda rows:rows[:17]]:
   with self.subTest(mutate=mutate):
    with self.assertRaises(ValueError):list(self.fixture(mutate).batches(REGISTRY))
 def test_time_filter_and_label_file_denial(self):
  data=self.fixture();rows=list(data.batches(REGISTRY,stamp('2026-01-01T00:05:00+08:00'),stamp('2026-01-01T00:10:00+08:00')));self.assertEqual(len(rows),1)
  with self.assertRaises(ValueError):
   with data.open('ground_truth_labels.csv'):pass
  with self.assertRaises(ValueError):stamp('2026-01-01T00:00:00')
 @unittest.skipUnless(os.environ.get('DATASET_TEST_ZIP'),'Original large ZIP not in Git')
 def test_supplied_zip_exact_rows_and_missing_sample(self):
  for split in SPLITS:
   data=Dataset(os.environ['DATASET_TEST_ZIP'],split)
   with data.open('sensor_history.csv') as f:raw=list(islice(csv.DictReader(f),36))
   batches=list(islice(data.batches(REGISTRY),2))
   for before,after in zip(raw,[r for b in batches for r in b['readings']]):
    self.assertEqual(float(before['value']),after['value']);self.assertEqual(before['timestamp'],after['timestamp'])
   if split==SPLITS[1]:
    missing=next(data.batches(REGISTRY,stamp('2026-01-01T08:15:00+08:00')))
    self.assertTrue(any(r['value'] is None for r in missing['readings']))
if __name__=='__main__':unittest.main()
