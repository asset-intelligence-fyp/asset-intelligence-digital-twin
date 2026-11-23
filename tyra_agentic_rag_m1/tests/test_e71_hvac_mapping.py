import csv
from src.e71_context import build_index, retrieve_context


def test_hvac_zone_requires_explicit_room_mapping(tmp_path):
    root = tmp_path / "dataset" / "generated" / "llm_reference_visible"
    root.mkdir(parents=True)
    for name, headers, rows in [
        ("room_metadata.csv", ["room_id", "hvac_zone"], [["L03-OPEN", "AHU3"]]),
        ("hvac_state.csv", ["timestamp", "hvac_zone", "hvac_state"],
         [["2026-01-02T11:20:00+08:00", "AHU3", "cooling"],
          ["2026-01-02T11:20:00+08:00", "AHU4", "heating"]])
    ]:
        with (root / name).open("w", newline="") as f:
            w = csv.writer(f); w.writerow(headers); w.writerows(rows)
    db = tmp_path / "ctx.sqlite"
    build_index(tmp_path / "dataset", db)
    got = retrieve_context("2026-01-02T11:30:00+08:00", "L03-OPEN", "TEMP-L03-OPEN-01", db)
    assert len(got["observations"]) == 1
    assert got["observations"][0]["value"] == "cooling"
    assert got["observations"][0]["zone"] == "AHU3"
    assert any("maps this room" in x for x in got["warnings"])
    missing = retrieve_context("2026-01-02T11:30:00+08:00", "L03-OTHER", "S", db)
    assert not missing["available"]
