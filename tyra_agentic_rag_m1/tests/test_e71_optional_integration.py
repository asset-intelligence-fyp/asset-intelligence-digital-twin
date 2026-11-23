"""Requires E7 project dependency installation on user's Mac."""
from datetime import datetime, timedelta
import pytest

pytest.importorskip("langgraph")
pytest.importorskip("duckdb")
from src import e71
from src.schemas import AnomalyAnswer
from src.e71 import E71FirstPlan, E71LaterPlan, E71Review
from src.db import stamp


class FakeRetriever:
    sensor_id = "TEMP-L03-OPEN-01"
    zone = "L03-OPEN"
    as_of = datetime(2026, 1, 2, 3, 30)
    db_path = None

    def recent(self, hours):
        return {"tool": "recent", "readings": [
            {"timestamp": stamp(self.as_of-timedelta(minutes=5*(36-i))),
             "value": round(24+i*.02, 4)} for i in range(37)]}

    def reference(self):
        return {"tool": "reference", "reference_summary": {"n": 12, "median": 24.5},
                "same_weekday_and_clock": []}


class FakeLLM:
    def ask(self, sys, prompt, schema):
        if schema is AnomalyAnswer:
            return AnomalyAnswer(status="anomaly", confidence=.8, anomaly_type="drift",
                                 explanation="Initial screen", evidence_timestamps=[])
        if schema is E71FirstPlan:
            return E71FirstPlan(action="reference", reason="Need a baseline")
        if schema is E71LaterPlan:
            return E71LaterPlan(action="finish", reason="Enough evidence")
        if schema is E71Review:
            return E71Review(status="suspect", fact_ids=["F001", "F002"],
                             explanation="Gradual rise")
        raise ValueError(schema)


def test_e71_preserves_screening_and_real_llm_planner_choice(monkeypatch):
    monkeypatch.setattr(e71, "historical_trajectory", lambda r,l: {
      "tool": "trajectory", "current_changes": {"1h": {
          "delta": .24, "from_id": "OBS0025", "to_id": "OBS0037"}},
      "historical_change_reference": {"1h": {"n": 12, "median": 0.02}}})
    monkeypatch.setattr(e71, "retrieve_context", lambda *args, **kwargs: {
       "tool": "operational_context", "available": False,
       "observations": [], "metadata": [], "source_counts": {}, "warnings": []})
    out = e71.run_e71_detection(FakeRetriever(), FakeLLM(), max_rounds=2)
    assert out["screening_status"] == "anomaly"
    assert out["review_status"] == "suspect"
    assert out["supported_status"] == "suspect"
    assert out["optional_retrieval_count"] == 1
    assert [x["tool"] for x in out["trace"]] == ["trajectory", "operational_context", "reference"]
