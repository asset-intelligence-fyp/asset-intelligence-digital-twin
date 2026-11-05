"""Regression coverage for the future-time historical expected-value endpoint."""
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from llm_service.prediction import expected_room_reading

TZ=timezone(timedelta(hours=8))
CUTOFF=datetime(2026,11,6,14,0,tzinfo=TZ)
POINT={'code':'CO2-L03-MEET-01','sensorType':'co2','unit':'ppm','simulatorRoomId':'L03-MEET-01'}

def req(horizon=1):
    return {'point':dict(POINT),'room_id':'L03-MEET-01','as_of':CUTOFF.isoformat(),
            'horizon_hours':horizon,'source':'http'}

class PredictionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/'normal.sqlite')
        self.conn=sqlite3.connect(self.path)
        self.conn.execute('''CREATE TABLE sensor_readings (dataset TEXT,timestamp TEXT,sensor_id TEXT,
            value REAL,quality_flag TEXT,weekday INTEGER,minute_of_day INTEGER)''')
    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()
    def add(self,when,value,code='CO2-L03-MEET-01',dataset='normal',quality='ok'):
        self.conn.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?)',
                          (dataset,when.isoformat(),code,value,quality,when.weekday(),when.hour*60+when.minute))
        self.conn.commit()
    def populate(self,n=6,horizon=1):
        target=CUTOFF+timedelta(hours=horizon)
        for week in range(1,n+1):
            day=target-timedelta(weeks=week)
            self.add(day,500+week*20)
    def test_one_hour_expected_value_source_range_and_count(self):
        self.populate()
        result=expected_room_reading(req(),self.path)
        self.assertEqual(result['status'],'ok')
        self.assertEqual(result['historical_days'],6)
        self.assertEqual(result['expected_value'],570)
        self.assertEqual(result['historical_range'],{'p10':530,'p90':610})
        self.assertEqual(result['horizon_hours'],1)
        self.assertEqual(result['model'],'deterministic_historical_estimator')
        self.assertFalse(result['trained_forecast'])
    def test_24_hour_uses_target_weekday_not_current_weekday(self):
        self.populate(horizon=24)
        result=expected_room_reading(req(24),self.path)
        self.assertEqual(result['status'],'ok')
        self.assertEqual(result['target_time'],(CUTOFF+timedelta(hours=24)).isoformat())
    def test_same_day_future_and_post_cutoff_rows_never_leak(self):
        self.populate()
        target=CUTOFF+timedelta(hours=1)
        for j in range(100):
            self.add(target+timedelta(days=j*7),10000)
        result=expected_room_reading(req(),self.path)
        self.assertEqual(result['historical_days'],6)
        self.assertEqual(result['expected_value'],570)
    def test_duplicate_single_day_not_counted_five_times(self):
        target=CUTOFF+timedelta(hours=1)-timedelta(weeks=1)
        for minute in range(-25,26,5):
            self.add(target+timedelta(minutes=minute),500)
        result=expected_room_reading(req(),self.path)
        self.assertEqual(result['status'],'insufficient_history')
        self.assertEqual(result['historical_days'],1)
    def test_only_normal_valid_quality_and_canonical_id(self):
        self.populate(n=4)
        day=CUTOFF+timedelta(hours=1)-timedelta(weeks=5)
        self.add(day,555,quality='invalid')
        self.add(day,555,dataset='fault')
        self.add(day,555,code='ANOTHER-SENSOR')
        self.assertEqual(expected_room_reading(req(),self.path)['status'],'insufficient_history')
    def test_missing_db_is_explicit(self):
        result=expected_room_reading(req(),'/does-not-exist.sqlite')
        self.assertEqual(result['status'],'insufficient_history')
        self.assertIsNone(result['expected_value'])
    def test_rejects_binary_invalid_horizon_and_room(self):
        cases=[{**req(),'horizon_hours':2},{**req(),'horizon_hours':True},
               {**req(),'room_id':'WRONG'},
               {**req(),'point':{**POINT,'sensorType':'occupancy'}}]
        for case in cases:
            with self.subTest(case=case),self.assertRaises(ValueError):
                expected_room_reading(case,self.path)
    def test_invalid_db_schema_is_explicit(self):
        self.conn.execute('DROP TABLE sensor_readings')
        self.conn.commit()
        result=expected_room_reading(req(),self.path)
        self.assertEqual(result['status'],'insufficient_history')
        self.assertIn('schema',result['reason'])

if __name__=='__main__':unittest.main()
