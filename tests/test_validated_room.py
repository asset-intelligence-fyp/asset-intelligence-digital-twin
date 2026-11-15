"""No-network checks for source-backed Qwen3 P2/R4.3.1-style integration."""
import json
import tempfile
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timedelta,timezone
from llm_service.validated_room import (
    analyse_validated,build_evidence,check_claims,expected_claims,finding_signal,
    publish,reference_daily_samples,source_evidence_lines,normal_history_ready,
    resolve_history_path,prose_number_issues,
)
TZ=timezone(timedelta(hours=8))
CUTOFF=datetime(2026,3,9,14,0,tzinfo=TZ)

def point(kind='co2',code=None):
    code=code or ('LEAK-L03-WC-01' if kind=='water_leakage' else 'CO2-L03-MEET-01')
    return {'code':code,'simulatorRoomId':'L03-MEET-01', 'sensorType':kind,
            'ifcSensorId':'L03-MEET-'+kind.upper(), 'unit':'binary' if kind in ('water_leakage','occupancy') else 'ppm'}

def row(value,when=CUTOFF,code='CO2-L03-MEET-01',quality='synthetic'):
    return {'point_code':code,'timestamp':when.isoformat(),'value':value,'quality':quality}

def request(kind='co2',current=700,prior=430,include_prior=True,source='http'):
    p=point(kind)
    rows=[row(current,CUTOFF-timedelta(minutes=15),p['code']),row(current,CUTOFF,p['code'])]
    if include_prior:
        rows += [row(prior,CUTOFF-timedelta(weeks=i),p['code']) for i in range(1,7)]
    return {'points':[p],'history':rows,'source':source,'room_id':'L03-MEET-01',
            'room_name':'Meeting room','as_of':CUTOFF.isoformat(),'question':'Summarise the room.'}

def draft(ev,alert, finding='Unusually high room reading warrants investigation.'):
    focus=next(f for f in ev['sensors'] if f['sensor_id']==ev['focus_sensor_id'])
    return {'finding':finding,'needs_investigation':alert,'possible_explanations':['Investigate possible causes.'],
            'recommended_checks':['Inspect telemetry source.'],'limitations':[],
            'numeric_claims':expected_claims(focus)}

class MockClient:
    def __init__(self,model,raw): self.model=model;self.raw=raw
    def chat(self,messages,format=None):
        assert format['properties']['numeric_claims']
        assert 'P2 Concise' in messages[0]['content']
        return {'message':{'content':json.dumps(self.raw)}}

class ValidatedRoomTests(unittest.TestCase):
    def test_historical_rule_and_window_stats(self):
        ev=build_evidence(request())
        f=ev['sensors'][0]
        self.assertEqual(f['historical_days'],6)
        self.assertEqual(f['historical_median'],430)
        self.assertEqual(f['average'],700)
        self.assertTrue(f['rule_alert'])
        self.assertEqual(ev['source_trust'],'server_postgresql_or_memory')
    def test_no_future_or_same_day_hist_baseline(self):
        inp=request()
        inp['history'] += [row(10000,CUTOFF+timedelta(minutes=1)),row(900,CUTOFF-timedelta(hours=2))]
        f=build_evidence(inp)['sensors'][0]
        self.assertEqual(f['average'],700)
        self.assertEqual(f['historical_days'],6)
    def test_no_reference_does_not_invent_normality(self):
        ev=build_evidence(request(include_prior=False))
        self.assertIsNone(ev['sensors'][0]['historical_median'])
        r=publish(draft(ev,False,'No anomaly was detected.'),ev,1.2)
        self.assertEqual(r['status'],'insufficient_evidence')
        self.assertTrue(r['numeric_verification_passed'])
    def test_rule_model_disagreement_review_not_veto(self):
        ev=build_evidence(request())
        r=publish(draft(ev,False,'No anomaly was detected.'),ev,1)
        self.assertEqual(r['status'],'review_required')
        self.assertTrue(r['human_review_required'])
        self.assertEqual(r['decision_assessment']['historical_rule_alert'],True)
    def test_explicit_semantic_contradiction_preserved(self):
        ev=build_evidence(request())
        r=publish(draft(ev,False),ev,1)
        self.assertTrue(r['semantic_conflict'])
        self.assertEqual(r['status'],'review_required')
        self.assertIsNone(r['decision_assessment']['llm_alert_scorable'])
        self.assertTrue(r['numeric_verification_passed'])
    def test_numeric_mismatch_rejected(self):
        ev=build_evidence(request())
        d=draft(ev,True)
        d['numeric_claims']['observed_average']=1.23
        r=publish(d,ev,1)
        self.assertEqual(r['status'],'validation_failed')
        self.assertIn('Numeric mismatch: observed_average',r['decision_assessment']['validation_issues'])
        self.assertNotIn(d['finding'],r['result']['finding'])
    def test_unsupported_historical_number_rejected(self):
        ev=build_evidence(request(include_prior=False))
        d=draft(ev,False,'No anomaly was detected.')
        d['numeric_claims']['historical_median']=430
        self.assertFalse(check_claims(d,expected_claims(ev['sensors'][0]))[0])
    def test_unverified_prose_number_is_withheld_without_discarding_structured_evidence(self):
        ev=build_evidence(request())
        d=draft(ev,True,'The reading was 999 ppm and unusually high. Inspect the ventilation.')
        out=publish(d,ev,1)
        self.assertEqual(out['status'],'review_required')
        self.assertTrue(out['numeric_verification_passed'])
        self.assertNotIn('999', out['result']['finding'])
        self.assertIn('Inspect the ventilation.',out['result']['finding'])
        self.assertTrue(out['decision_assessment']['narrative_numeric_issues'])

    def test_actual_uploaded_co2_prose_values_are_verified(self):
        req=request(current=650.49,include_prior=False,source='browser_demo')
        req['history'][0]['value']=631.702
        ev=build_evidence(req)
        self.assertAlmostEqual(ev['sensors'][0]['average'],641.096)
        d=draft(ev,True,'Current CO₂ level is 650.49 ppm, higher than the average of 641.096 ppm. History is unavailable.')
        out=publish(d,ev,1)
        self.assertEqual(out['status'],'review_required')
        self.assertTrue(out['numeric_verification_passed'])
        self.assertFalse(out['decision_assessment']['narrative_numeric_issues'])
        self.assertIn('650.49 ppm',out['result']['finding'])
        self.assertIsNone(out['verified_evidence']['sensors'][0]['historical_median'])

    def test_numeric_prose_unit_mismatch_is_removed(self):
        ev=build_evidence(request(include_prior=False))
        d=draft(ev,True,'CO₂ is 700 °C. Check the sensor.')
        result=publish(d,ev,1)
        self.assertEqual(result['status'],'review_required')
        self.assertNotIn('700 °C',result['result']['finding'])

    def test_subscript_co2_is_not_a_numeric_claim(self):
        ev=build_evidence(request())
        self.assertEqual(prose_number_issues('Check CO₂ conditions.',ev),[])

    def test_explicit_history_path_uses_real_normal_only_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'reference.sqlite'
            with sqlite3.connect(file) as db:
                db.execute('CREATE TABLE sensor_readings(dataset TEXT,sensor_id TEXT,timestamp TEXT,weekday INT,minute_of_day INT,quality_flag TEXT,value REAL)')
                for n in range(1,7):
                    ts=(CUTOFF-timedelta(weeks=n)).isoformat()
                    db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?)',('normal','CO2-L03-MEET-01',ts,CUTOFF.weekday(),CUTOFF.hour*60,'ok',430))
                db.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?)',('fault','CO2-L03-MEET-01',(CUTOFF-timedelta(weeks=7)).isoformat(),CUTOFF.weekday(),CUTOFF.hour*60,'ok',9000))
            self.assertTrue(normal_history_ready(resolve_history_path(str(file))))
            req=request(source='browser_demo',include_prior=False)
            ev=build_evidence(req,resolve_history_path(str(file)))
            f=ev['sensors'][0]
            self.assertEqual(f['historical_days'],6)
            self.assertEqual(f['historical_median'],430)
            self.assertEqual(f['historical_source'],'normal_synthetic_sqlite')
            self.assertEqual(f['rule_alert'],True)

    def test_discover_only_existing_project_local_reference_and_do_not_create_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'website'
            sample=root/'storage'/'digital_twin.sqlite'
            sample.parent.mkdir(parents=True)
            sample.write_bytes(b'not a database')
            with patch('llm_service.validated_room.__file__',str(root/'llm_service'/'validated_room.py')):
                self.assertEqual(resolve_history_path(),str(sample))
                self.assertFalse(normal_history_ready(str(sample)))
            self.assertFalse(resolve_history_path(str(root/'not_here.sqlite')))
    def test_leak_detection_not_normal(self):
        inp=request(kind='water_leakage',current=1,include_prior=False)
        ev=build_evidence(inp)
        r=publish(draft(ev,False,'No anomaly was detected.'),ev,1)
        self.assertEqual(ev['sensors'][0]['rule_alert'],True)
        self.assertEqual(r['status'],'review_required')
    def test_occupancy_only_is_not_a_fault_detector(self):
        inp=request(kind='occupancy',current=1,include_prior=False)
        ev=build_evidence(inp)
        self.assertFalse(ev['rule_evaluable'])
        self.assertEqual(publish(draft(ev,False,'No anomaly was detected.'),ev,1)['status'],'insufficient_evidence')
    def test_client_demo_cannot_be_confused_with_postgres(self):
        ev=build_evidence(request(source='browser_demo',include_prior=True))
        self.assertEqual(ev['source_trust'],'browser_supplied_synthetic_snapshot')
        self.assertIsNone(ev['sensors'][0]['historical_median'])
        r=publish(draft(ev,True),ev,1)
        self.assertIn('not independently authenticated',' '.join(r['result']['limitations']))
    def test_bad_quality_does_not_pollute_mean(self):
        inp=request()
        inp['history'].append(row(100000,CUTOFF-timedelta(minutes=10),quality='invalid'))
        self.assertEqual(build_evidence(inp)['sensors'][0]['average'],700)
    def test_negative_language_is_not_anomaly(self):
        self.assertEqual(finding_signal('No anomaly was detected.'),'normal_asserted')
        self.assertEqual(finding_signal('There is no unusual behaviour.'),'normal_asserted')
    def test_claims_all_correct_are_verified(self):
        ev=build_evidence(request())
        r=publish(draft(ev,True),ev,1)
        self.assertEqual(r['status'],'alert')
        self.assertTrue(r['numeric_verification_passed'])
        self.assertEqual(r['prompt_variant'],'concise')
        self.assertEqual(r['retrieval_policy'],'backend_verified_preflight_not_autonomous_tool_call')
    def test_correct_configuration_and_mock_inference(self):
        req=request()
        ev=build_evidence(req)
        raw=draft(ev,True)
        result=analyse_validated(req,{'model':'qwen3:1.7b','prompt':'concise','validation_mode':'hybrid_semantic'},lambda model: MockClient(model,raw))
        self.assertEqual(result['status'],'alert')
        with self.assertRaises(ValueError):
            analyse_validated(req,{'model':'qwen3:4b','prompt':'concise','validation_mode':'hybrid_semantic'},lambda model: None)
    def test_bad_schema_fails_closed(self):
        ev=build_evidence(request())
        self.assertEqual(publish({'finding':'looks okay'},ev,1)['status'],'validation_failed')
    def test_cutoff_timezone_requirement(self):
        req=request();req['as_of']='2026-03-09T14:00:00'
        with self.assertRaises(ValueError):build_evidence(req)
    def test_max_room_and_malformed_reading(self):
        req=request();req['points'][0]['simulatorRoomId']='different'
        with self.assertRaises(ValueError):build_evidence(req)

if __name__=='__main__':unittest.main()