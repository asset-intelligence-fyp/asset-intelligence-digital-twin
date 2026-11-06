"""Synthetic-fault benchmark contracts. Mock analysis; no Ollama or physical sensors."""
import csv
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from scripts import evaluate_llm_anomalies as m

MYT=timezone(timedelta(hours=8))
CODE='CO2-L03-MEET-01'
START=datetime(2026,10,30,8,tzinfo=MYT)
POINT={'code':CODE,'sensorType':'co2','unit':'ppm',
       'simulatorRoomId':'L03-MEET-01','locationLabel':'Meeting room'}


def csvwrite(path, headers, rows):
    with Path(path).open('w',encoding='utf8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


class AnomalyBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        (self.root/'shared').mkdir()
        (self.root/'shared'/'sensorRegistry.json').write_text(json.dumps([POINT]))
        self.folder=self.root/'sim'
        self.folder.mkdir()
        readings=[];labels=[]
        for minute in range(240):
            at=(START+timedelta(minutes=minute)).isoformat()
            fault=90<=minute<121
            readings.append({'timestamp':at,'sensor_id':CODE,'room_id':'L03-MEET-01',
                             'sensor_type':'co2','value':900 if fault else 430,
                             'unit':'ppm','source':'synthetic_demo','sequence':minute,
                             'generated_at_utc':at})
            labels.append({'timestamp':at,'sensor_id':CODE,'room_id':'L03-MEET-01',
                           'fault_active':int(fault),'scenario':'reduced_ventilation' if fault else 'normal',
                           'event_id':'E1' if fault else ''})
        csvwrite(self.folder/'sensor_history.csv',list(readings[0]),readings)
        csvwrite(self.folder/'ground_truth_labels.csv',list(labels[0]),labels)
        events=[{'event_id':'E1','sensor_id':CODE,'room_id':'L03-MEET-01',
                 'sensor_type':'co2','scenario':'reduced_ventilation',
                 'start':(START+timedelta(minutes=90)).isoformat(),
                 'end':(START+timedelta(minutes=121)).isoformat(),
                 'duration_minutes':31,'severity':'test','seed':1}]
        csvwrite(self.folder/'ground_truth_events.csv',list(events[0]),events)
        self.db=self.root/'normal.sqlite'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE sensor_readings (dataset TEXT,sensor_id TEXT,timestamp TEXT,weekday INT,minute_of_day INT,quality_flag TEXT,value REAL)')
            db.execute("INSERT INTO sensor_readings (dataset) VALUES ('normal')")
        self.public=self.root/'public.jsonl'
        self.key=self.root/'answer_key_PRIVATE.jsonl'
        self.out=self.root/'predictions.jsonl'
        self._root_patch=patch.object(m,'ROOT',self.root)
        self._root_patch.start()

    def tearDown(self):
        self._root_patch.stop()
        self.tmp.cleanup()

    def test_prepare_is_blind_and_event_balanced(self):
        result=m.prepare_cases(self.folder,self.public,self.key,negatives=7,positive_per_event=2)
        self.assertEqual(result['positive_cases'],2)
        self.assertEqual(result['negative_cases'],7)
        self.assertEqual(result['events_sampled'],1)
        public=list(m.read_jsonl(self.public))
        labels=list(m.read_jsonl(self.key))
        self.assertEqual(len(public),9)
        self.assertTrue(all(set(c)=={'case_id','sensor_id','room_id','at_time'} for c in public))
        self.assertTrue(all('fault_active' in c for c in labels))
        self.assertTrue(all('fault_active' not in str(c) for c in public))

    def test_run_uses_only_past_unlabelled_history_and_can_resume(self):
        m.prepare_cases(self.folder,self.public,self.key,negatives=4,positive_per_event=2)
        inspected=[]
        def fake(request,config,factory):
            assert request['source']=='historical_replay'
            assert len(request['points'])==1
            assert 'fault_active' not in str(request)
            assert all(m.parse_myt(r['timestamp'])<=m.parse_myt(request['as_of']) for r in request['history'])
            inspected.append(request['as_of'])
            is_fault=request['history'][-1]['value']>600
            status='alert' if is_fault else 'no_alert'
            return {'status':status,'decision_assessment':{
                'llm_alert_raw':is_fault,'llm_alert_scorable':is_fault,
                'historical_rule_alert':is_fault,'narrative_numeric_issues':[]},
                'numeric_verification_passed':True,
                'result':{'finding':'Grounded in simulated observations'}}
        with patch.object(m,'analyse_validated',fake):
            first=m.run_cases(self.public,self.folder/'sensor_history.csv',self.db,self.out,
                              limit=2,factory=lambda model:None)
            self.assertTrue(first['partial_run'])
            second=m.run_cases(self.public,self.folder/'sensor_history.csv',self.db,self.out,
                               resume=True,factory=lambda model:None)
        self.assertFalse(second['partial_run'])
        self.assertEqual(second['new_cases'],4)
        self.assertEqual(len(inspected),6)
        report=m.score_cases(self.out,self.key,self.root/'summary.json')
        self.assertEqual(report['methods']['llm_raw']['TP'],2)
        self.assertEqual(report['methods']['llm_raw']['FP'],0)
        self.assertEqual(report['methods']['llm_raw']['f1_on_scored'],1)
        self.assertEqual(report['event_results']['llm_raw']['sampled_event_recall'],1)
        self.assertEqual(report['status'],'evaluated')

    def test_abstentions_and_reviews_are_not_silently_scored_as_normal(self):
        truth={'a':{'fault_active':1},'b':{'fault_active':0},'c':{'fault_active':1}}
        result={'a':{'validated_hybrid':True},'b':{'validated_hybrid':None},
                'c':{'validated_hybrid':None}}
        score=m.classification(result,truth,'validated_hybrid')
        self.assertEqual(score['TP'],1)
        self.assertEqual(score['abstain_positive'],1)
        self.assertEqual(score['abstain_negative'],1)
        self.assertEqual(score['coverage_pct'],33.33)
        self.assertEqual(score['recall_all_positives'],0.5)

    def test_run_rejects_leaked_ground_truth_in_public_case(self):
        m.write_jsonl(self.public,[{'case_id':'A00001','sensor_id':CODE,
             'room_id':'L03-MEET-01','at_time':START.isoformat(),'fault_active':1}])
        with self.assertRaises(ValueError):
            m.run_cases(self.public,self.folder/'sensor_history.csv',self.db,self.out,
                        factory=lambda model:None)


if __name__=='__main__':
    unittest.main()
