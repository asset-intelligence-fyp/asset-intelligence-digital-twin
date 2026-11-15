"""Focused checks for the backtesting protocol; no real Ollama call is made."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from scripts import evaluate_llm_one_month as m

TZ=timezone(timedelta(hours=8))
ORIGIN=datetime(2024,12,15,14,tzinfo=TZ)
SENSOR={'code':'CO2-L03-MEET-01','unit':'ppm','sensorType':'co2','simulatorRoomId':'L03-MEET-01'}

class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.path=Path(self.folder.name)/'normal.sqlite'
        self.db=sqlite3.connect(self.path)
        self.db.execute('CREATE TABLE sensor_readings (dataset TEXT,sensor_id TEXT,timestamp TEXT,value REAL,quality_flag TEXT)')
        for days_ago in range(1,130):
            stamp=ORIGIN-timedelta(days=days_ago)
            self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',('normal',SENSOR['code'],stamp.isoformat(),650,'ok'))
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',('normal',SENSOR['code'],(ORIGIN-timedelta(minutes=1)).isoformat(),650,'ok'))
        future=m.add_months(ORIGIN,1)
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',('normal',SENSOR['code'],future.isoformat(),640,'ok'))
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',('fault',SENSOR['code'],future.isoformat(),9999,'ok'))
        self.db.commit()

    def tearDown(self):
        self.db.close();self.folder.cleanup()

    def test_future_excluded_from_history(self):
        hist=m.pre_cutoff_history(self.db,SENSOR['code'],ORIGIN)
        self.assertTrue(hist)
        self.assertTrue(all(datetime.fromisoformat(x['timestamp'])<=ORIGIN for x in hist))
        self.assertTrue(all(x['value']==650 for x in hist))
        self.assertEqual(m.ground_truth_at(self.db,SENSOR['code'],m.add_months(ORIGIN,1))['actual'],640)

    def test_actual_only_queried_after_forecaster_returns(self):
        observed=[]
        def fake(req,config,factory):
            observed.extend(req['history'])
            self.assertEqual(req['horizon_months'],1)
            self.assertEqual(req['as_of'],ORIGIN.isoformat())
            self.assertLess(max(datetime.fromisoformat(x['timestamp']) for x in observed),m.add_months(ORIGIN,1))
            return {'status':'llm_projection','projected_value':680,
                    'lower_scenario':600,'upper_scenario':690,
                    'coverage':{'historical_normal_days':129},'data_basis':'historical_normal_synthetic'}
        with patch.object(m,'forecast_room_reading',fake):
            row=m.evaluate_case(self.db,SENSOR,ORIGIN,lambda model:None,self.path)
        self.assertEqual(row['actual'],640)
        self.assertEqual(row['abs_error'],40)
        self.assertEqual(row['persistence_abs_error'],10)
        self.assertTrue(row['scenario_contains_actual'])
        score=m.summary_for([row],2025,'rolling')['summary'][0]
        self.assertEqual(score['MAE'],40)
        self.assertEqual(score['RMSE'],40)
        self.assertEqual(score['bias'],40)
        self.assertEqual(score['accuracy_score_pct'],93.75)
        self.assertEqual(score['skill_vs_persistence_pct'],-300)

    def test_missing_future_truth_does_not_contribute_to_accuracy(self):
        row={'sensor_id':SENSOR['code'],'sensor_type':'co2','unit':'ppm',
             'status':'insufficient_history','actual':None,'abs_error':None,'horizon_months':1}
        score=m.summary_for([row],2025,'rolling')['summary'][0]
        self.assertIsNone(score['MAE'])
        self.assertIsNone(score['accuracy_score_pct'])
        self.assertEqual(score['valid_predictions'],0)

    def test_end_to_end_mock_report_and_case_audit(self):
        root=Path(self.folder.name)
        (root/'shared').mkdir()
        (root/'shared'/'sensorRegistry.json').write_text(json.dumps([SENSOR]))
        output=root/'reports'/'llm_one_month_eval'
        opts=SimpleNamespace(db=str(self.path), sensors=SENSOR['code'],target_year=2025,
             origin_from='2024-12',origin_to='2024-12',origin_days='15',origin_hours='14',
             mode='strict',limit_cases=1,tolerance_minutes=30,output=str(output),ollama_url='http://127.0.0.1:11434')
        def fake(req,config,factory):
            self.assertLessEqual(max(datetime.fromisoformat(x['timestamp']) for x in req['history']),ORIGIN)
            return {'status':'llm_projection','projected_value':680,'lower_scenario':600,
                    'upper_scenario':690,'data_basis':'historical_normal_synthetic',
                    'coverage':{'historical_normal_days':129}}
        with patch.object(m,'ROOT',root),patch.object(m,'forecast_room_reading',fake):
            report=m.run(opts,factory=lambda model:None)
        self.assertEqual(report['summary'][0]['accuracy_score_pct'],93.75)
        self.assertEqual(json.loads((output/'summary.json').read_text())['schema_version'],1)
        self.assertIn('abs_error',(output/'cases.csv').read_text())
        self.assertEqual(len((output/'cases.partial.jsonl').read_text().splitlines()),1)


    def test_baselines_use_only_pre_cutoff_values(self):
        hist=m.pre_cutoff_history(self.db,SENSOR['code'],ORIGIN)
        hist.append({'timestamp':(ORIGIN+timedelta(days=3)).isoformat(),'value':9999})
        values=m.baseline_forecasts(hist,ORIGIN,m.add_months(ORIGIN,1))
        self.assertEqual(values['recent_mean'],650)
        self.assertEqual(values['seasonal_naive'],650)

    def test_summary_counts_failed_and_missing_cases(self):
        rows=[
            {'sensor_id':SENSOR['code'],'sensor_type':'co2','unit':'ppm',
             'target_time':'2025-01-15T14:00:00+08:00','status':'llm_projection',
             'actual':640,'abs_error':40,'squared_error':1600,'signed_error':40,
             'persistence_abs_error':10,'recent_mean_abs_error':10,
             'seasonal_naive_abs_error':10,'scenario_contains_actual':True},
            {'sensor_id':SENSOR['code'],'sensor_type':'co2','unit':'ppm',
             'target_time':'2025-02-15T14:00:00+08:00','status':'validation_failed',
             'actual':630,'abs_error':None},
            {'sensor_id':SENSOR['code'],'sensor_type':'co2','unit':'ppm',
             'target_time':'2025-03-15T14:00:00+08:00','status':'insufficient_history',
             'actual':None,'abs_error':None},
        ]
        report=m.summary_for(rows,2025,'rolling')
        metric=report['summary'][0]
        self.assertEqual(metric['planned_cases'],3)
        self.assertEqual(metric['cases_with_ground_truth'],2)
        self.assertEqual(metric['valid_predictions'],1)
        self.assertEqual(metric['prediction_success_pct'],50)
        self.assertEqual(metric['seasonal_naive_MAE'],10)
        self.assertEqual(metric['skill_vs_seasonal_naive_pct'],-300)
        self.assertEqual(report['overall']['valid_predictions'],1)
        self.assertEqual(len(report['by_target_month']),3)

    def test_all_selects_supported_registry_sensors(self):
        root=Path(self.folder.name)
        (root/'shared').mkdir(exist_ok=True)
        second={**SENSOR,'code':'TEMP-L03-MEET-01','sensorType':'temperature','unit':'°C'}
        (root/'shared'/'sensorRegistry.json').write_text(json.dumps([SENSOR,second]))
        self.db.execute('''INSERT INTO sensor_readings
                           SELECT dataset, ?, timestamp, 25.0, quality_flag
                           FROM sensor_readings WHERE sensor_id=? AND dataset='normal' ''',
                        (second['code'], SENSOR['code']))
        self.db.commit()
        output=root/'full'
        opts=SimpleNamespace(db=str(self.path),sensors='all',target_year=2025,
             origin_from='2024-12',origin_to='2024-12',origin_days='15',
             origin_hours='14',mode='strict',limit_cases=0,tolerance_minutes=30,
             output=str(output),ollama_url='http://127.0.0.1:11434')
        def fake(req,config,factory):
            return {'status':'llm_projection','projected_value':650,
                    'lower_scenario':0,'upper_scenario':1000,
                    'coverage':{'historical_normal_days':129}}
        with patch.object(m,'ROOT',root),patch.object(m,'forecast_room_reading',fake):
            report=m.run(opts,factory=lambda model:None)
        self.assertEqual(report['overall']['planned_cases'],2)
        self.assertEqual(report['expected_planned_cases'],2)
        self.assertFalse(report['partial_run'])
        self.assertEqual(len(report['summary']),2)


    def test_recreates_output_directory_deleted_mid_run(self):
        root=Path(self.folder.name)
        (root/'shared').mkdir(exist_ok=True)
        (root/'shared'/'sensorRegistry.json').write_text(json.dumps([SENSOR]))
        later_origin=ORIGIN.replace(day=22)
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',
                        ('normal',SENSOR['code'],(later_origin-timedelta(minutes=1)).isoformat(),650,'ok'))
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',
                        ('normal',SENSOR['code'],m.add_months(later_origin,1).isoformat(),641,'ok'))
        self.db.commit()
        output=root/'reports'/'llm_one_month_eval'
        opts=SimpleNamespace(db=str(self.path),sensors=SENSOR['code'],target_year=2025,
             origin_from='2024-12',origin_to='2024-12',origin_days='15,22',
             origin_hours='14',mode='strict',limit_cases=0,tolerance_minutes=30,
             output=str(output),ollama_url='http://127.0.0.1:11434')
        seen=[]
        def fake(req,config,factory):
            seen.append(req['as_of'])
            if len(seen)==2:
                # Emulate an external cleanup while a long LLM call is underway.
                shutil.rmtree(output)
            return {'status':'llm_projection','projected_value':650,
                    'lower_scenario':600,'upper_scenario':690,
                    'coverage':{'historical_normal_days':129}}
        with patch.object(m,'ROOT',root),patch.object(m,'forecast_room_reading',fake):
            report=m.run(opts,factory=lambda model:None)
        self.assertEqual(report['overall']['planned_cases'],2)
        self.assertFalse(report['partial_run'])
        self.assertEqual(len((output/'cases.partial.jsonl').read_text().splitlines()),2)
        self.assertEqual(len((output/'cases.csv').read_text().splitlines()),3)
        self.assertEqual(len(list((root/'storage'/'llm_one_month_checkpoints').glob('*.jsonl'))),1)

    def test_resume_skips_completed_llm_requests(self):
        root=Path(self.folder.name)
        (root/'shared').mkdir(exist_ok=True)
        (root/'shared'/'sensorRegistry.json').write_text(json.dumps([SENSOR]))
        later_origin=ORIGIN.replace(day=22)
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',
                        ('normal',SENSOR['code'],(later_origin-timedelta(minutes=1)).isoformat(),650,'ok'))
        self.db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',
                        ('normal',SENSOR['code'],m.add_months(later_origin,1).isoformat(),641,'ok'))
        self.db.commit()
        output=root/'reports'/'llm_one_month_eval'
        opts=SimpleNamespace(db=str(self.path),sensors=SENSOR['code'],target_year=2025,
             origin_from='2024-12',origin_to='2024-12',origin_days='15,22',
             origin_hours='14',mode='strict',limit_cases=1,tolerance_minutes=30,
             output=str(output),ollama_url='http://127.0.0.1:11434')
        seen=[]
        def fake(req,config,factory):
            seen.append(req['as_of'])
            return {'status':'llm_projection','projected_value':650,
                    'lower_scenario':600,'upper_scenario':690,
                    'coverage':{'historical_normal_days':129}}
        with patch.object(m,'ROOT',root),patch.object(m,'forecast_room_reading',fake):
            first=m.run(opts,factory=lambda model:None)
            self.assertEqual(len(seen),1)
            self.assertTrue(first['partial_run'])
            # Simulate disappearance of the reports folder between processes.
            shutil.rmtree(output)
            opts.limit_cases=0
            opts.resume=True
            second=m.run(opts,factory=lambda model:None)
        self.assertEqual(len(seen),2)  # only the remaining case requested
        self.assertEqual(second['resumed_cases'],1)
        self.assertFalse(second['partial_run'])
        self.assertEqual(len((output/'cases.partial.jsonl').read_text().splitlines()),2)
        self.assertEqual(json.loads((output/'summary.json').read_text())['overall']['valid_predictions'],2)

    def test_one_month_calendar_rollover(self):
        self.assertEqual(m.add_months(datetime(2024,12,31,14,tzinfo=TZ),1).date().isoformat(),'2025-01-31')

if __name__=='__main__':unittest.main()
