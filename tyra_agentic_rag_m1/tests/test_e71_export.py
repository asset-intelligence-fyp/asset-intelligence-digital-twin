import json
from src.e71_export import export_channels


def test_export_channels_separate_decisions_and_audit(tmp_path):
    source = tmp_path / "sample.jsonl"
    record = {"method": "e71", "task": "detect", "origin": "2026-01-02T03:30:00Z",
              "sensor_id": "TEMP", "valid": True, "model": "local",
              "screening": {"status": "anomaly", "explanation": "first screen"},
              "review": {"status": "normal", "explanation": "context suggests normal"},
              "review_status": "normal", "supported_status": "unknown",
              "evidence_status": "partial_evidence", "trace": [
                  {"tool": "trajectory", "source": "mandatory_E71"},
                  {"tool": "related", "source": "LLM_selected"}],
              "operational_context": {"available": True, "observations": [{"kind": "weather"}]}}
    source.write_text(json.dumps(record)+"\n")
    result = export_channels(source)
    assert result["records"] == 1
    a = json.loads((tmp_path / "sample_screening.jsonl").read_text())
    b = json.loads((tmp_path / "sample_review.jsonl").read_text())
    c = json.loads((tmp_path / "sample_supported.jsonl").read_text())
    assert a["answer"]["status"] == "anomaly"
    assert b["answer"]["status"] == "normal"
    assert c["answer"]["status"] == "unknown"
    assert "related" in (tmp_path / "sample_audit.csv").read_text()
