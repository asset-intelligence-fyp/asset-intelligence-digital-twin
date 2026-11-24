"""Exercise the exact E8-A LangGraph workflow with a fake schema-safe local LLM.

No network, Ollama service, fault labels, future observations or model claims.
These tests verify wiring: screening kept, tool planning, citations and
numeric comparison validated in the independently verified channel.
"""
from __future__ import annotations

import importlib.util
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

READY = all(importlib.util.find_spec(p) is not None for p in
            ("duckdb", "numpy", "pydantic", "langgraph", "ollama"))


class StructuredFakeLLM:
    def __init__(self, model=None, host=None):
        self.model = model

    def ask(self, system, prompt, schema):
        if schema.__name__ == "AnomalyAnswer":
            return schema(status="suspect", anomaly_type="gradual_change",
                          confidence=.63, evidence_timestamps=[],
                          explanation="The recent current trajectory warrants checking.")
        if schema.__name__ == "E7Plan":
            return schema(action="finish", reason="Mandatory trajectory sufficient",
                          lookback_days=30)
        if schema.__name__ == "E7Verification":
            block = prompt.split("CAUSAL EVIDENCE MENU: ", 1)[1].split(
                "\nReturn an independently reasoned decision.", 1)[0]
            packet = json.loads(block)
            pair = packet["suggested_comparisons"][0]
            return schema(status="suspect",
                          evidence_ids=[packet["current_id"], pair["right_id"]],
                          comparisons=[pair],
                          explanation="Current observation differs from an earlier observed sample.")
        raise AssertionError("Unexpected E8-A schema " + schema.__name__)


@unittest.skipUnless(READY, "E8-A optional Python packages not installed")
class ExactE8AWorkflowTests(unittest.TestCase):
    def test_agentic_langgraph_evidence_screening_and_verification(self):
        from llm_service.e8a_website import analyse_e8a_website
        cutoff = datetime(2026, 11, 24, 1, 20, tzinfo=timezone.utc)
        code = "TEMP-L03-OPEN-01"
        rows = []
        for i in range(37):
            dt = cutoff - timedelta(minutes=5 * (36 - i))
            rows.append({"point_code": code,
                         "timestamp": dt.isoformat(),
                         "value": round(22.5 + i * .05, 3),
                         "quality": "simulated"})
        request = {"sensor_id": code, "as_of": cutoff.isoformat(),
                   "points": [{"code": code, "assetId": "L03-OPEN",
                               "sensorType": "temperature"}],
                   "history": rows}
        with patch("tyra_agentic_rag_m1.src.local_llm.OllamaJSON", StructuredFakeLLM):
            result = analyse_e8a_website(request)
        self.assertEqual(result["workflow"], "E8-A")
        self.assertEqual(result["screening_status"], "suspect")
        self.assertEqual(result["verified_status"], "suspect")
        self.assertEqual(result["evidence_status"], "grounded")
        self.assertEqual(result["screening"]["status"], "suspect")
        self.assertTrue(result["validation"]["current_comparison_grounded"])
        self.assertGreater(len(result["validation"]["grounded_observations"]), 1)
        self.assertEqual(result["trace"][0]["tool"], "trajectory")
        self.assertFalse(result["review_audit"]["repair_attempted"])
        self.assertEqual(result["source_observation_count"], 37)
        self.assertEqual(result["as_of"], "2026-11-24T01:20:00Z")
        self.assertIn("Synthetic", " ".join(result["limitations"]).capitalize())


if __name__ == "__main__":
    unittest.main()
