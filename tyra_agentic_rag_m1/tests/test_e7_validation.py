from datetime import datetime, timedelta

import pytest

from src.e7_validation import EvidenceLedger, validate_comparison, validate_verification


def ledger():
    x = EvidenceLedger("2026-01-02T12:00:00+08:00")
    a = x.add("TEMP_01", "2026-01-02T03:00:00Z", 24.2, source="recent")
    b = x.add("TEMP_01", "2026-01-02T04:00:00Z", 25.0, source="recent")
    return x, a, b


def test_timezones_deduplicate_and_no_future():
    x, a, b = ledger()
    assert x.add("TEMP_01", "2026-01-02T12:00:00+08:00", 25.0, source="trajectory") == b
    assert x.entries[b]["timestamp"] == "2026-01-02T04:00:00Z"
    with pytest.raises(ValueError, match="future"):
        x.add("TEMP_01", "2026-01-02T12:05:00+08:00", 25.1, source="recent")


def test_correct_numeric_comparison_and_citation_validation():
    x, a, b = ledger()
    cmp = {"left_id": b, "right_id": a, "relation": "rose_since"}
    assert validate_comparison(cmp, x)["valid"]
    result = validate_verification({"status": "suspect", "evidence_ids": [a, b],
                                    "comparisons": [cmp]}, x, "TEMP_01")
    assert result["evidence_status"] == "grounded"
    assert result["verified_status"] == "suspect"
    assert result["validated_comparisons"][0]["difference_left_minus_right"] == 0.8


def test_false_numeric_claim_cannot_pass():
    x, a, b = ledger()
    cmp = {"left_id": b, "right_id": a, "relation": "fell_since"}
    result = validate_verification({"status": "anomaly", "evidence_ids": [a, b],
                                    "comparisons": [cmp]}, x, "TEMP_01")
    assert result["evidence_status"] == "invalid_numeric_comparison"
    assert result["verified_status"] == "unknown"


def test_nonexistent_id_makes_verified_unknown_without_touching_screening():
    x, a, b = ledger()
    screening = {"status": "anomaly", "explanation": "initial signal"}
    result = validate_verification({"status": "anomaly", "evidence_ids": [b, "OBS9999"],
                                    "comparisons": []}, x, "TEMP_01")
    assert result["evidence_status"] == "invalid_citation"
    assert result["verified_status"] == "unknown"
    assert screening["status"] == "anomaly"


def test_positive_without_comparison_is_unverified():
    x, a, b = ledger()
    result = validate_verification({"status": "suspect", "evidence_ids": [b],
                                    "comparisons": []}, x, "TEMP_01")
    assert result["verified_status"] == "unknown"
    assert result["evidence_status"] == "insufficient"


def test_cross_sensor_number_comparison_rejected():
    x, a, b = ledger()
    other = x.add("CO2_01", "2026-01-02T04:00:00Z", 400, source="related")
    cmp = {"left_id": b, "right_id": other, "relation": "lower_than"}
    assert validate_comparison(cmp, x)["reason"] == "different_sensor_units"


def test_normal_requires_cited_target():
    x, a, b = ledger()
    assert validate_verification({"status": "normal", "evidence_ids": [b]}, x,
                                  "TEMP_01")["verified_status"] == "normal"
    assert validate_verification({"status": "normal", "evidence_ids": []}, x,
                                  "TEMP_01")["verified_status"] == "unknown"
