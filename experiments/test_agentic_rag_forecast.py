"""Offline regression tests: no Ollama required, no January truth in inference."""
import copy
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
import agentic_rag_forecast as module
import qwen4b_one_month_backtest as base


class AgenticRetrievalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.out=Path(cls.temp.name)/"jan"
        cls.collection=module.cases(cls.out)
        cls.first=cls.collection["CASE-001"]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def args(self, mode="structured", model="qwen3:1.7b", limit=1, resume=False):
        return SimpleNamespace(mode=mode,model=model,limit_cases=limit,case="",
                               out=self.out,ollama_url="http://127.0.0.1:11434",
                               timeout=10,context=6144,max_tools=3,
                               resume=resume,dry_run=False)

    @staticmethod
    def fake_output(evidence_ids=None):
        return {"predictions":{"temperature":25.0,"humidity":65.0,
                               "co2":720.0,"energy":38.0},
                "interpretation":"Conditional, evidence-based estimate",
                "assumptions":["Calendar is known; future attendance is unknown"],
                "evidence_ids":evidence_ids or ["HISTORY"]}

    def test_60_cases_history_and_calendar_only(self):
        self.assertEqual(len(self.collection),60)
        with patch.object(base,"HIDDEN_TRUTH",Path("/missing/deliberately_hidden.csv")):
            material=module.cases(self.out)
            self.assertEqual(len(material),60)
            for cid,case in material.items():
                self.assertEqual(module.guard_case(case["history"],case["known"],case["request"]),
                                 base.parse_date("2026-01-01"))
                self.assertTrue(all(r["date"]<case["cutoff"] for r in case["history"]))
                self.assertTrue(all(r["future_date"]>=case["cutoff"] for r in case["known"]))
                self.assertEqual(case["request"]["case_id"],cid)
                self.assertEqual(module.evidence_structured(case,"structured")[2]["result"]["actual_future_weather_occupancy_hvac_or_sensor_data"],"NOT AVAILABLE")

    def test_cross_case_and_future_lookups_fail(self):
        case=self.first
        mixed=copy.deepcopy(case["history"])
        mixed[-1]["case_id"]="CASE-002"
        with self.assertRaisesRegex(ValueError,"mix"):
            module.guard_case(mixed,case["known"],case["request"])
        leaked=copy.deepcopy(case["history"])
        leaked[-1]["date"]="2026-01-01"
        with self.assertRaisesRegex(ValueError,"strictly"):
            module.guard_case(leaked,case["known"],case["request"])
        future=copy.deepcopy(case["known"])
        future[0]["future_date"]="2025-12-31"
        with self.assertRaisesRegex(ValueError,"calendar"):
            module.guard_case(case["history"],future,case["request"])

    def test_retrieved_analogues_have_entirely_past_outcomes(self):
        h=self.first["history"]
        for metric in module.METRICS:
            analog=module.analogues(h,metric,top_k=3)
            self.assertEqual(len(analog),3)
            for item in analog:
                self.assertLess(item["outcome_end"],h[-14]["date"])
                self.assertLess(item["outcome_end"],self.first["cutoff"])
                self.assertEqual(item["source"],"same_case_observed_pre_cutoff")
                self.assertGreater(item["distance"],0)
            estimate=module.analogue_baseline(h)[metric]
            self.assertTrue(math.isfinite(estimate))
            self.assertEqual(len({x["id"] for x in analog}),3)

    def test_structured_context_exposes_real_covariates_and_safe_future_calendar(self):
        case=self.first
        summary=module.evidence_structured(case,"structured")
        self.assertEqual([x["id"] for x in summary],
                         ["HISTORY","TRENDS","FUTURE_KNOWN","BASELINES"])
        values=summary[1]["result"]
        self.assertIn("attendance_workdays",values)
        self.assertIn("workday_headcount_pearson_r_last28",values["co2"])
        self.assertEqual(summary[2]["result"]["actual_future_weather_occupancy_hvac_or_sensor_data"],
                         "NOT AVAILABLE")
        self.assertEqual(len(summary[0]["recent_daily_readings"]),7)
        analog=module.evidence_structured(case,"analogue")
        self.assertEqual(analog[-1]["id"],"ANALOGUES")
        self.assertEqual(len(analog[-1]["matches"]),4)
        self.assertFalse("embedding" in json.dumps(analog[-1]).lower() and
                         "no_embeddings" not in json.dumps(analog[-1]).lower())

    def test_structured_run_records_valid_forecasts_with_traceable_sources(self):
        args=self.args()
        fake=(self.fake_output(["HISTORY","TRENDS"]),
              {"latency_ms":9,"tokens_input":200,"tokens_output":70})
        with patch.object(module,"ollama_chat",return_value=fake):
            module.run(args)
        saved=list(base.read_jsonl(module.result_path(self.out,args.mode,args.model)))
        self.assertEqual(len(saved),1)
        self.assertEqual(saved[0]["case_id"],"CASE-001")
        self.assertEqual(saved[0]["status"],"valid")
        self.assertEqual(saved[0]["predictions"]["co2"],720.0)
        self.assertTrue(saved[0]["citation_verified"])
        self.assertEqual(saved[0]["evidence_ids"],["HISTORY","TRENDS"])
        self.assertEqual(saved[0]["llm_calls"],1)
        self.assertEqual(saved[0]["tool_calls"],0)

    def test_analogue_mode_retrieval_is_grounded_not_pretrained_forecast(self):
        args=self.args(mode="analogue")
        fake=(self.fake_output(["ANALOGUES"]),
              {"latency_ms":7,"tokens_input":310,"tokens_output":60})
        with patch.object(module,"ollama_chat",return_value=fake):
            module.run(args)
        saved=list(base.read_jsonl(module.result_path(self.out,args.mode,args.model)))
        self.assertEqual(len(saved),1)
        self.assertTrue(saved[0]["citation_verified"])
        self.assertEqual(saved[0]["evidence_ids"],["ANALOGUES"])

    def test_agentic_planner_selects_tools_and_receives_past_outcomes(self):
        args=self.args(mode="agentic")
        calls=[]
        def respond(system,prompt,schema,settings):
            if schema is module.TOOL_SCHEMA:
                n=sum(s=="planner" for s,_ in calls)
                steps=[
                    {"tool":"find_similar_periods","metric":"co2","window_days":14,
                     "reason":"Find historical CO2 analogues"},
                    {"tool":"get_historical_outcomes","metric":"co2","window_days":14,
                     "reason":"Inspect actual past outcomes"},
                    {"tool":"finish","metric":"co2","window_days":14,"reason":"Enough evidence"},
                ]
                calls.append(("planner",steps[n]))
                return steps[n],{"latency_ms":4,"tokens_input":25,"tokens_output":12}
            calls.append(("forecast",prompt))
            self.assertIn("TOOL-1", {x["id"] for x in prompt["evidence"]})
            self.assertIn("TOOL-2", {x["id"] for x in prompt["evidence"]})
            self.assertTrue(next(x for x in prompt["evidence"] if x["id"]=="TOOL-2")
                            ["result"]["available"])
            evidence_ids=[e["id"] for e in prompt["evidence"]]
            return self.fake_output(evidence_ids),{"latency_ms":13,"tokens_input":400,
                                                    "tokens_output":70}
        with patch.object(module,"ollama_chat",side_effect=respond):
            module.run(args)
        saved=list(base.read_jsonl(module.result_path(self.out,args.mode,args.model)))
        self.assertEqual(len(saved),1)
        self.assertEqual(saved[0]["status"],"valid")
        self.assertEqual(saved[0]["tool_calls"],2)
        self.assertEqual(saved[0]["llm_calls"],4)
        self.assertEqual(saved[0]["tool_trace"][0]["tool"],"find_similar_periods")
        self.assertEqual(saved[0]["tool_trace"][1]["tool"],"get_historical_outcomes")
        self.assertEqual(len(calls),4)

    def test_retrieval_only_genuine_60_case_scoring(self):
        args=self.args()
        summary=module.score_retrieval_only(args)
        self.assertEqual(summary["cases"],60)
        self.assertFalse(summary["model_used"])
        for metric in module.METRICS:
            self.assertEqual(summary["by_metric"][metric]["retrieval_only"]["n"],60)
            self.assertGreaterEqual(summary["by_metric"][metric]["retrieval_only"]["mae"],0)
        self.assertTrue((self.out/"agentic_rag"/"summary_retrieval_only.json").exists())

    def test_resume_skips_only_valid_records_and_retries_errors(self):
        args=self.args(mode="structured",model="qwen3:4b",limit=2)
        fake=(self.fake_output(),{"latency_ms":8,"tokens_input":50,"tokens_output":12})
        counter=iter([fake,(None,None)])
        def fail_on_second(*unused):
            x=next(counter)
            if x==(None,None):raise RuntimeError("Simulated Ollama outage")
            return x
        with patch.object(module,"ollama_chat",side_effect=fail_on_second):
            module.run(args)
        path=module.result_path(self.out,args.mode,args.model)
        first=list(base.read_jsonl(path))
        self.assertEqual([r["status"] for r in first],["valid","error"])
        args.resume=True
        with patch.object(module,"ollama_chat",return_value=fake) as mocked:
            module.run(args)
        self.assertEqual(mocked.call_count,1)
        rows=list(base.read_jsonl(path))
        self.assertEqual(rows[-1]["case_id"],"CASE-002")
        self.assertEqual(rows[-1]["status"],"valid")

    def test_score_reads_truth_only_after_inference_and_on_identical_valid_cases(self):
        args=self.args(mode="structured")
        args.resume=True
        fake=(self.fake_output(),{"latency_ms":10,"tokens_input":20,"tokens_output":20})
        with patch.object(module,"ollama_chat",return_value=fake):
            module.run(args)
        summaries={}
        # After inference is saved, scoring opens hidden January truth.
        all_cases=module.cases(self.out)
        truth=base.truth_monthly()
        out=module.score_arm(args,args.mode,
                             {cid:c["request"] for cid,c in all_cases.items()},
                             truth,{cid:c["history"] for cid,c in all_cases.items()})
        summaries["score"]=out
        self.assertEqual(out["attempted_cases"],1)
        self.assertEqual(out["valid_cases"],1)
        self.assertEqual(out["by_metric"]["co2"]["llm"]["n"],1)
        self.assertEqual(out["by_metric"]["co2"]["retrieval_only"]["n"],1)
        self.assertEqual(out["training_or_fine_tuning"],False)
        self.assertEqual(out["vector_embeddings"],False)


if __name__=="__main__":
    unittest.main()
