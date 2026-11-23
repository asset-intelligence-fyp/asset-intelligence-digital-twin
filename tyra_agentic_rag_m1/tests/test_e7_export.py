import json
import pytest
from src.e7_export import export_channels


def test_exports_both_channels(tmp_path):
    src = tmp_path / "E7_raw.jsonl"
    record = {"method": "e7", "task": "detect", "valid": True,
              "sensor_id": "TEMP_01", "origin": "2026-01-02T04:00:00Z",
              "answer": {"status": "anomaly"}, "screening": {"status": "anomaly"},
              "verified_status": "unknown", "evidence_status": "insufficient",
              "verification": {"status": "suspect", "explanation": "needs evidence"},
              "validation": {"grounded_observations": []}}
    src.write_text(json.dumps(record) + "\n")
    first, second, n = export_channels(src)
    assert n == 1
    a = json.loads(first.read_text())
    b = json.loads(second.read_text())
    assert a["answer"]["status"] == "anomaly"
    assert b["answer"]["status"] == "unknown"
    assert a["channel"] == "screening"
    assert b["channel"] == "verified"
    assert a["valid"] and b["valid"]


def test_rejects_non_e7_files(tmp_path):
    p = tmp_path / "bad.jsonl"
    p.write_text(json.dumps({"method": "agentic", "valid": True}) + "\n")
    with pytest.raises(ValueError, match="Expected method"):
        export_channels(p)
