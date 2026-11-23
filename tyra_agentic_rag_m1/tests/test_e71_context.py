import csv
from pathlib import Path
from src.e71_context import build_index, discover, retrieve_context, parse_timestamp


def write_csv(path: Path, head, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.writer(f); writer.writerow(head); writer.writerows(rows)


def test_context_index_asof_zone_leakage_and_label_exclusion(tmp_path):
    dataset = tmp_path / "dataset"
    base = dataset / "generated" / "llm_reference_visible"
    # Malaysia timezone offset maps 11:30 to 03:30 UTC.
    write_csv(base / "hvac_state.csv", ["timestamp", "room_id", "hvac_state", "setpoint", "fault_active"], [
        ["2026-01-02T11:20:00+08:00", "L03-OPEN", "cooling", "24", "1"],
        ["2026-01-02T11:35:00+08:00", "L03-OPEN", "off", "999", "0"],
        ["2026-01-02T11:25:00+08:00", "OTHER", "heating", "888", "1"],
    ])
    write_csv(base / "headcount.csv", ["timestamp", "room_id", "headcount"], [
        ["2026-01-02T11:25:00+08:00", "L03-OPEN", "6"],
        ["2026-01-02T11:25:00+08:00", "OTHER", "999"],
    ])
    write_csv(base / "weather_5min.csv", ["timestamp", "outdoor_temp", "humidity"], [
        ["2026-01-02T11:25:00+08:00", "31.0", "78"],
        ["2026-01-02T11:35:00+08:00", "999", "999"],
    ])
    write_csv(base / "room_metadata.csv", ["room_id", "room_type", "floor", "fault_flag"], [
        ["L03-OPEN", "open_office", "3", "secret"]
    ])
    write_csv(base / "sensor_registry.csv", ["sensor_id", "unit", "sensor_type"], [
        ["TEMP-L03-OPEN-01", "degC", "temperature"]
    ])
    write_csv(dataset / "generated" / "anomaly_eval_2026_q1_evaluation_keys" / "ground_truth_labels.csv",
              ["timestamp", "room_id", "fault_active"], [["2026-01-02T11:20:00+08:00", "L03-OPEN", "1"]])
    found = discover(dataset)
    assert len(found) == 5
    assert all(x["status"] == "ready" for x in found)
    db = tmp_path / "ctx.sqlite"
    stats = build_index(dataset, db)
    assert stats["rows_indexed"] > 0
    got = retrieve_context("2026-01-02T03:30:00Z", "L03-OPEN", "TEMP-L03-OPEN-01", db)
    assert got["available"]
    assert set(got["source_counts"]) == {"hvac", "occupancy", "weather"}
    assert all(x["timestamp"] <= got["as_of"] for x in got["observations"])
    vals = str(got["observations"])
    assert "999" not in vals and "888" not in vals and "secret" not in str(got)
    assert not any("fault" in str(x).lower() for x in got["observations"])
    assert got["metadata"]
    assert stats["metadata_indexed"] > 0


def test_missing_index_and_naive_timezone(tmp_path):
    assert parse_timestamp("2026-01-02 11:30:00", "timestamp") == "2026-01-02T03:30:00Z"
    assert parse_timestamp("2026-01-02 11:30:00", "timestamp_utc") == "2026-01-02T11:30:00Z"
    assert not retrieve_context("2026-01-02T03:30:00Z", "A", "S", tmp_path / "missing.sqlite")["available"]
