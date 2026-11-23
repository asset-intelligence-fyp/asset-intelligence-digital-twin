from src.e71_facts import build_facts, check_review
from src.e7_validation import EvidenceLedger


def test_factual_review_preserves_decision_and_checks_fact_ids():
    ledger = EvidenceLedger("2026-01-02T04:00:00Z")
    earlier = ledger.add("TEMP", "2026-01-02T03:00:00Z", 24.0, source="recent")
    now = ledger.add("TEMP", "2026-01-02T04:00:00Z", 25.0, source="recent")
    recent = {"current": ledger.entries[now].copy()}
    trajectory = {"current_changes": {"1h": {"delta": 1.0, "from_id": earlier, "to_id": now}},
                  "historical_change_reference": {"1h": {"n": 12, "median": 0.1, "p10": -0.1, "p90": 0.3}}}
    context = {"observations": [{"id": "CTX0001", "kind": "occupancy", "timestamp": "2026-01-02T03:55:00Z",
                                 "attribute": "headcount", "value": 5, "zone": "A", "source": "headcount.csv"}]}
    facts = build_facts(recent, trajectory, context)
    assert [x["kind"] for x in facts] == ["current_observation", "observed_change",
                                             "historical_change_reference", "operational_context"]
    ok = check_review({"status": "anomaly", "fact_ids": ["F001", "F002"],
                       "evidence_ids": [now, earlier]}, facts, recent["current"], ledger)
    assert ok["review_status"] == "anomaly"
    assert ok["supported_status"] == "anomaly"
    assert ok["evidence_status"] == "factual_references_valid"
    partial = check_review({"status": "anomaly", "fact_ids": [], "evidence_ids": []},
                           facts, recent["current"], ledger)
    assert partial["review_status"] == "anomaly"  # No alert erased
    assert partial["supported_status"] == "unknown"
    assert partial["evidence_status"] == "partial_evidence"
    invalid = check_review({"status": "normal", "fact_ids": ["F999"], "evidence_ids": []},
                           facts, recent["current"], ledger)
    assert invalid["review_status"] == "normal"
    assert invalid["evidence_status"] == "invalid_evidence_ids"


def test_ledger_blocks_future_reading():
    import pytest
    ledger = EvidenceLedger("2026-01-02T04:00:00Z")
    with pytest.raises(ValueError):
        ledger.add("TEMP", "2026-01-02T04:05:00Z", 999.0, source="recent")
