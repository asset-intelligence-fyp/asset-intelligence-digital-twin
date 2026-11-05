"""Long-range Qwen-only prediction tests; all LLM outputs are mocked."""
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from llm_service.prediction import forecast_room_reading, add_months

TZ=timezone(timedelta(hours=8))
CUTOFF=datetime(2026,11,6,14,0,tzinfo=TZ)
POINT={'code':'CO2-L03-MEET-01','sensorType':'co2','unit':'ppm','simulatorRoomId':'L03-MEET-01'}
CONFIG={'model':'qwen3:1.7b','prompt':'concise'}
DRAFT={'projected_value':725,'lower_scenario':500,'upper_scenario':950,
       'direction':'increasing','explanation':'A speculative continuation of the observed monthly patterns.',
       'assumptions':['Similar building operation'],
       'limitations':['Future ventilation and schedules are unknown']}

class FakeClient:
    def __init__(self,content=None):
        self.calls=[]
        self.content=json.dumps(content if content is not None else DRAFT)
    def chat(self,messages,format=None):
        self.calls.append((messages,format))
        return {'message':{'content':self.content}}

class PredictionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/'normal.sqlite')
        self.db=sqlite3.connect(self.path)
        self.db.execute('''CREATE TABLE sensor_readings
            (dataset TEXT,sensor_id TEXT,timestamp TEXT,value REAL,quality_flag TEXT)''')
        self.client=FakeClient()
    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()
    def add(self,stamp,val=650,code=POINT['code'],dataset='normal',quality='ok'):
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',
                        (dataset,code,stamp.isoformat(),val,quality))
    def normal(self,days=170):
        for i in range(1,days+1):
            self.add(CUTOFF-timedelta(days=i),600+(i%30)*2)
        self.db.commit()
    def request(self,horizon=1,history=None,source='http'):
        if history is None:
            history=[{'point_code':POINT['code'],'value':655,'timestamp':(CUTOFF-timedelta(minutes=2)).isoformat(),'quality':'synthetic'}]
        return {'point':dict(POINT),'room_id':'L03-MEET-01','as_of':CUTOFF.isoformat(),
                'horizon_months':horizon,'source':source,'history':history}
    def invoke(self,req=None,client=None,db=None):
        config={**CONFIG,'history_db':self.path if db is None else db}
        c=self.client if client is None else client
        return forecast_room_reading(req or self.request(),config,lambda model:c)

    def test_one_month_llm_generates_forecast_from_source_months(self):
        self.normal()
        result=self.invoke()
        self.assertEqual(result['status'],'llm_projection')
        self.assertEqual(result['horizon_months'],1)
        self.assertEqual(result['projected_value'],725)
        self.assertEqual(result['lower_scenario'],500)
        self.assertEqual(result['upper_scenario'],950)
        self.assertFalse(result['trained_forecast'])
        self.assertEqual(result['method'],'llm_only_one_month_trend_projection')
        self.assertEqual(result['data_basis'],'historical_normal_synthetic')
        self.assertEqual(result['numeric_output_check'],'schema_and_basic_range_passed')
        self.assertEqual(len(self.client.calls),1)
        messages, schema=self.client.calls[0]
        self.assertIn('current_stream',messages[1]['content'])
        self.assertIn('historical_normal',messages[1]['content'])
        self.assertIn('future numbers',messages[0]['content'])
        self.assertIn('projected_value',schema['properties'])
        self.assertNotIn('trained forecasting',result['explanation'])

    def test_only_one_month_horizon_calendar_accurate(self):
        self.normal(35)
        result=self.invoke(self.request(horizon=1))
        self.assertEqual(result['target_time'],add_months(CUTOFF,1).isoformat())
        self.assertEqual(result['status'],'llm_projection')
        for horizon in (4,6,12,24):
            with self.subTest(horizon=horizon),self.assertRaises(ValueError):
                self.invoke(self.request(horizon=horizon))

    def test_sparse_live_data_and_no_matching_reference_refuse_invention(self):
        result=self.invoke(db='/no/such/file.sqlite')
        self.assertEqual(result['status'],'insufficient_history')
        self.assertIsNone(result['projected_value'])
        self.assertEqual(self.client.calls,[])
        self.assertIn('14 distinct days',result['reason'])

    def test_reference_history_isolation_quality_cutoff(self):
        self.normal(13)
        for k in range(200):
            self.add(CUTOFF+timedelta(days=k+1),999)
            self.add(CUTOFF-timedelta(days=65+k),999,code='OTHER-SENSOR')
            self.add(CUTOFF-timedelta(days=65+k),999,dataset='fault')
            self.add(CUTOFF-timedelta(days=65+k),999,quality='invalid')
        self.db.commit()
        result=self.invoke()
        self.assertEqual(result['status'],'insufficient_history')
        self.assertEqual(result['coverage']['historical_normal_days'],13)
        self.assertEqual(self.client.calls,[])

    def test_invalid_llm_projections_are_rejected(self):
        self.normal()
        invalid=[{'projected_value':500,'lower_scenario':600,'upper_scenario':950},
                 {'projected_value':950,'lower_scenario':500,'upper_scenario':10100},
                 {'projected_value':'700','lower_scenario':500,'upper_scenario':900},
                 {'projected_value':float('nan'),'lower_scenario':500,'upper_scenario':900}]
        for bad in invalid:
            draft={**DRAFT,**bad}
            c=FakeClient(draft)
            result=self.invoke(client=c)
            self.assertEqual(result['status'],'validation_failed')
            self.assertIsNone(result['projected_value'])
            self.assertEqual(len(c.calls),1)

    def test_horizon_room_source_and_sensor_restrictions(self):
        for payload in [
            {**self.request(), 'horizon_months':3},
            {**self.request(), 'horizon_months':4},
            {**self.request(), 'horizon_months':6},
            {**self.request(), 'horizon_months':12},
            {**self.request(), 'horizon_months':24},
            {**self.request(), 'horizon_months':True},
            {**self.request(), 'horizon_months':'12'},
            {**self.request(), 'room_id':'WRONG'},
            {**self.request(), 'source':'what_if'},
            {**self.request(), 'point':{**POINT,'sensorType':'occupancy'}},
            {**self.request(), 'as_of':'2026-11-06T14:00:00'}]:
            with self.subTest(payload=str(payload)[:120]),self.assertRaises(ValueError):
                self.invoke(payload)

    def test_current_http_trend_alone_can_support_llm_projection(self):
        hist=[{'point_code':POINT['code'],'value':600+(i//30),'timestamp':(CUTOFF-timedelta(days=i)).isoformat(),'quality':'synthetic'}
              for i in range(160)]
        result=self.invoke(self.request(horizon=1,history=hist),db='/no/such/file.sqlite')
        self.assertEqual(result['status'],'llm_projection')
        self.assertEqual(result['data_basis'],'connected_http_trend')
        self.assertEqual(result['coverage']['recent_http_days'],160)

    def test_stale_current_stream_rejected(self):
        self.normal()
        hist=[{'point_code':POINT['code'],'value':600,'timestamp':(CUTOFF-timedelta(hours=5)).isoformat()}]
        result=self.invoke(self.request(history=hist))
        self.assertEqual(result['status'],'insufficient_history')
        self.assertIn('two hours',result['reason'])
        self.assertFalse(self.client.calls)

    def test_month_end_target_is_clamped(self):
        january=datetime(2026,1,31,10,0,tzinfo=TZ)
        self.assertEqual(add_months(january,1).date().isoformat(),'2026-02-28')

if __name__=='__main__':unittest.main()
