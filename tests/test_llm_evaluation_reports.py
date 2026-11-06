"""Report-combination and explanation-rubric tests (offline only)."""
import csv
import json
from pathlib import Path
import tempfile
import unittest

from scripts import build_llm_evaluation_report as summary
from scripts import evaluate_llm_explanations as explanation


class ReportTests(unittest.TestCase):
    def test_combine_keeps_distinct_units_and_marks_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'prediction.json').write_text(json.dumps({
                'horizon_months':1,'model':'qwen3:1.7b',
                'partial_run':True,'expected_planned_cases':336,
                'overall':{'valid_predictions':1},
                'summary':[{'sensor_id':'CO2-L03-MEET-01','unit':'ppm','MAE':25,'valid_predictions':1}]}))
            (root/'anomaly.json').write_text(json.dumps({
                'method':'blind_synthetic_fault_cases','status':'evaluated','total_cases':2,
                'evaluated_cases':2,'methods':{'llm_raw':{'f1_on_scored':0.8}}}))
            result=summary.generate(root/'prediction.json',root/'anomaly.json',root/'combined.json')
            self.assertEqual(result['status'],'partial')
            self.assertEqual(result['forecasting']['per_sensor'][0]['unit'],'ppm')
            self.assertEqual(result['anomaly_detection']['methods']['llm_raw']['f1_on_scored'],0.8)

    def test_anomaly_only_report_does_not_invent_forecast_scores(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'anomaly.json').write_text(json.dumps({
                'method':'blind_synthetic_fault_cases','status':'evaluated',
                'total_cases':3,'evaluated_cases':3,
                'methods':{'validated_hybrid':{'f1_on_scored':0.75}}}))
            result = summary.generate(root/'absent_forecast.json',
                                      root/'anomaly.json', root/'combined.json')
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(result['forecasting']['status'], 'not_evaluated')
            self.assertEqual(result['forecasting']['per_sensor'], [])
            self.assertEqual(result['anomaly_detection']['status'], 'evaluated')
            self.assertEqual(result['anomaly_detection']['methods']['validated_hybrid']['f1_on_scored'], 0.75)
            self.assertTrue((root/'combined.json').is_file())

    def test_forecast_only_report_is_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'prediction.json').write_text(json.dumps({
                'horizon_months':1,'model':'qwen3:1.7b',
                'partial_run':False,'expected_planned_cases':1,
                'overall':{'valid_predictions':1},
                'summary':[{'sensor_id':'X','unit':'ppm','MAE':3}]}))
            result = summary.generate(root/'prediction.json',
                                      root/'absent_anomaly.json', root/'combined.json')
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(result['forecasting']['status'], 'evaluated')
            self.assertEqual(result['anomaly_detection']['status'], 'not_evaluated')

    def test_both_reports_missing_is_actionable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, 'No evaluation summaries found'):
                summary.generate(root/'forecast.json', root/'anomaly.json',
                                 root/'combined.json')

    def test_explanation_template_and_score(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            cases=root/'predictions.jsonl'
            cases.write_text(json.dumps({'case_id':'A1','finding':'Check ventilation'})+'\n')
            output=root/'review.csv'
            created=explanation.template(cases,output)
            self.assertEqual(created['cases'],1)
            with output.open(newline='',encoding='utf8') as fh:
                rows=list(csv.DictReader(fh))
            rows[0].update(numerical_grounding='2',causal_restraint='1',recommended_checks='2')
            with output.open('w',newline='',encoding='utf8') as fh:
                writer=csv.DictWriter(fh,fieldnames=rows[0].keys())
                writer.writeheader();writer.writerows(rows)
            result=explanation.score(output,root/'quality.json')
            self.assertEqual(result['mean_scores']['causal_restraint'],1)
            self.assertEqual(result['mean_scores']['recommended_checks'],2)


if __name__=='__main__':unittest.main()
