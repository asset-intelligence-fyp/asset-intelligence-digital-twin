"""Offline regression tests; do not call Ollama or expose hidden targets to prompts."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from experiments import qwen4b_one_month_backtest as b

class MonthlyForecastTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()

    def test_only_visible_history_and_future_calendar_used_in_prepare(self):
        real = b.csv_rows
        def guarded(path):
            self.assertNotEqual(path, b.HIDDEN_TRUTH)
            return real(path)
        with patch.object(b, "csv_rows", side_effect=guarded):
            n = b.prepare(self.out)
        self.assertEqual(n, 60)
        cases = list(b.read_jsonl(self.out / "requests.jsonl"))
        self.assertEqual(len(cases), 60)
        for item in cases:
            prompt = item["prompt"]
            self.assertEqual(prompt["as_of_date"], "2026-01-01")
            self.assertEqual(prompt["forecast_end_exclusive"], "2026-02-01")
            self.assertEqual(prompt["context"]["history_days"], 90)
            self.assertEqual(prompt["context"]["known_future_calendar"]["days"], 31)
            self.assertLess(prompt["context"]["observed_end"], prompt["as_of_date"])
            self.assertEqual(set(prompt["forecast_targets"]), set(b.SENSORS))
            self.assertNotIn("actual_future",json.dumps(prompt))
            self.assertNotIn("ground_truth",json.dumps(prompt))
            self.assertEqual(len(prompt["context"]["latest_7_observed_days"]),7)

    def test_baseline_results_match_real_dataset(self):
        b.prepare(self.out)
        class Args: mode="baselines";out=self.out
        b.score(Args())
        report=json.loads((self.out/"summary_baseline.json").read_text())
        self.assertEqual(report["scheduled_cases"],60)
        self.assertEqual(report["valid_cases"],0)
        self.assertAlmostEqual(report["by_metric"]["temperature"]["last_31d"]["mae"],0.13234,places=4)
        self.assertAlmostEqual(report["by_metric"]["humidity"]["last_31d"]["mae"],0.87731,places=4)
        self.assertAlmostEqual(report["by_metric"]["co2"]["last_31d"]["mae"],28.97043,places=3)
        self.assertAlmostEqual(report["by_metric"]["energy"]["last_90d"]["mae"],0.82230,places=4)

    def test_model_predictions_scored_after_separate_inference_stage(self):
        b.prepare(self.out)
        example={"predictions":{"temperature":24.7,"humidity":63.1,"co2":670.0,"energy":40.0},
                 "interpretation":"Test model output","assumptions":["Average conditions"],
                 "latency_ms":350}
        class Args:
            model="qwen3:4b"
            out=self.out
            case=""
            limit_cases=2
            resume=False
            ollama_url="http://127.0.0.1:11434"
            timeout=150
            context=4096
            dry_run=False
            mode="score"
        with patch.object(b,"request_ollama",return_value=example) as fake:
            b.run(Args())
            self.assertEqual(fake.call_count,2)
        b.score(Args())
        report=json.loads((self.out/"summary_qwen3_4b.json").read_text())
        self.assertEqual(report["valid_cases"],2)
        self.assertTrue(report["partial_run"])
        self.assertEqual(report["by_metric"]["temperature"]["llm"]["n"],2)
        self.assertIsNotNone(report["by_metric"]["temperature"]["skill_vs_last31_pct"])

    def test_invalid_model_is_rejected_before_inference(self):
        with self.assertRaises(ValueError):
            b.model_slug("untrusted:model")

    def test_calendar_month_is_31_days(self):
        self.assertEqual(str(b.month_after(b.date(2026,1,1))),"2026-02-01")
        self.assertEqual(str(b.month_after(b.date(2026,12,1))),"2027-01-01")

if __name__ == "__main__":
    unittest.main()
