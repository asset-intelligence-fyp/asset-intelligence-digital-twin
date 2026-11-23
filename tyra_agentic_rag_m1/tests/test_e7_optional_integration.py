"""Runs on user's Mac after installing project dependencies; skips without them."""
from datetime import datetime, timedelta

import pytest

pytest.importorskip("duckdb")
pytest.importorskip("langgraph")
from src import e7
from src.e7 import E7Plan, E7Verification, E7Comparison
from src.schemas import AnomalyAnswer
from src.db import stamp


class RetrieverStub:
    sensor_id = "TEMP_01"
    as_of = datetime(2026, 1, 2, 4, 0)
    db_path = None

    def recent(self, hours):
        assert hours == 3
        vals = []
        for k in range(37):
            vals.append({"timestamp": stamp(self.as_of - timedelta(minutes=(36-k)*5)),
                         "value": round(23 + k * 0.02, 5)})
        return {"tool": "recent", "readings": vals}


class FakeLLM:
    def ask(self, sys, prompt, schema):
        if schema is AnomalyAnswer:
            return AnomalyAnswer(status="anomaly", anomaly_type="drift",
                                 confidence=0.8, evidence_timestamps=[],
                                 explanation="An initially concerning trend")
        if schema is E7Plan:
            return E7Plan(action="finish", reason="trajectory already sufficient")
        if schema is E7Verification:
            return E7Verification(status="suspect",
                                  evidence_ids=["OBS0037", "OBS0025"],
                                  comparisons=[E7Comparison(left_id="OBS0037",
                                                            right_id="OBS0025",
                                                            relation="rose_since")],
                                  explanation="Observed target increased")
        raise ValueError(f"Unexpected schema: {schema}")


def test_e7_keeps_screening_and_verified_channels(monkeypatch):
    monkeypatch.setattr(e7, "historical_trajectory", lambda r, l:
                        {"tool": "trajectory", "as_of": l.origin, "historical_samples": 0})
    result = e7.run_e7_detection(RetrieverStub(), FakeLLM(), max_rounds=1)
    assert result["answer"]["status"] == "anomaly"
    assert result["screening_status"] == "anomaly"
    assert result["verified_status"] == "suspect"
    assert result["evidence_status"] == "grounded"
    assert result["trace"][0]["tool"] == "trajectory"
    assert result["validation"]["current_observation_cited"]


def test_trajectory_query_hard_cutoff_and_deltas(tmp_path):
    import csv
    from src.db import ingest, valid_timestamp
    from src.retrieval import TemporalRetriever
    from src.e7_tools import historical_trajectory
    from src.e7_validation import EvidenceLedger

    origin = datetime(2026, 1, 2, 4, 20)
    measured = {}
    # 3h current segment: current rises steadily.
    for i in range(37):
        dt = origin - timedelta(minutes=i * 5)
        measured[dt] = 25.0 - i * 0.02
    # Previous 12 same-weekday/clock hours and historical 1/3/6/24h lag points.
    for week in range(1, 13):
        t = origin - timedelta(days=week * 7)
        for h in (0, 1, 3, 6, 24):
            measured[t - timedelta(hours=h)] = 24.0 - 0.01 * h
    # A future extreme is in the physical DB but must never be returned.
    measured[origin + timedelta(minutes=5)] = 999.0
    p = tmp_path / "series.csv"
    with p.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "sensor_id", "zone_id", "value"])
        for dt, value in sorted(measured.items()):
            writer.writerow([stamp(dt), "TEMP_01", "A", value])
    db = tmp_path / "test.duckdb"
    ingest(str(p), zone_col="zone_id", db_path=str(db))
    r = TemporalRetriever("TEMP_01", stamp(origin), db_path=str(db))
    ledger = EvidenceLedger(stamp(origin))
    result = historical_trajectory(r, ledger)
    assert result["historical_samples"] == 12
    assert result["current_changes"]["1h"]["delta"] == pytest.approx(0.24)
    assert len(result["examples"]) <= 4
    assert all(valid_timestamp(v["timestamp"]) <= origin for v in ledger.entries.values())
    assert not any(v["value"] == 999.0 for v in ledger.entries.values())
