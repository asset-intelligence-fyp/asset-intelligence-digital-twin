"""Regression tests against the exact E7.1 Digital Twin CSV headers supplied by the user.
No external dataset or local LLM required.
"""
import csv
from pathlib import Path
from src.e71_context import build_index, discover, retrieve_context


def write_csv(path: Path, headers, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


def test_real_schemas_respect_hvac_link_cutoff_and_prohibited_fields(tmp_path):
    root = tmp_path / 'dataset'
    live = root / 'generated/anomaly_eval_2026_q1_llm_inputs'
    meta = root / 'generated/llm_reference_visible'
    t = '2026-01-02T11:25:00+08:00'
    later = '2026-01-02T11:35:00+08:00'
    write_csv(live / 'hvac_state.csv',
              ['timestamp', 'ac_zone_id', 'ac_on', 'setpoint_c', 'ventilation_level', 'source', 'fault_active'],
              [[t, 'AC-L03-Z1', '1', '24.0', 'high', 'synthetic_schedule', '1'],
               [t, 'AC-L03-Z2', '0', '99.0', 'off', 'synthetic_schedule', '1'],
               [later, 'AC-L03-Z1', '0', '88.0', 'off', 'synthetic_schedule', '0']])
    write_csv(live / 'weather_5min.csv',
              ['timestamp', 'regional_temp_c', 'regional_humidity_pct', 'regional_rain_mm_h',
               'solar_w_m2', 'local_rain_mm_h', 'rain_wet', 'local_rain_3h_mm',
               'weather_source', 'rain_sensor_source'],
              [[t, '31.2', '76', '0.0', '500', '0.0', '0', '0.0', 'SYNTH', 'SYNTH'],
               [later, '99.0', '90', '20', '0', '20', '1', '20', 'SYNTH', 'SYNTH']])
    write_csv(live / 'headcount.csv', ['timestamp', 'room_id', 'headcount', 'occupancy_ratio', 'source'],
              [[t, 'L03-OPEN-01', '12', '0.25', 'synthetic_badge_meeting'],
               [t, 'L03-OPEN-02', '999', '1.0', 'synthetic_badge_meeting']])
    write_csv(meta / 'room_metadata.csv',
              ['room_id', 'room_name', 'type', 'area_m2_ASSUMED', 'ceiling_height_m_ASSUMED',
               'volume_m3_ASSUMED', 'max_capacity_ASSUMED', 'seat_count_ASSUMED',
               'orientation_ASSUMED', 'ac_zone_id'],
              [['L03-OPEN-01', 'Open Office', 'open_office', '195', '2.9', '565.5', '48', '48', 'west', 'AC-L03-Z1']])
    write_csv(meta / 'sensor_registry.csv',
              ['sensor_id', 'room_id', 'sensor_type', 'unit', 'scope', 'primary_influences',
               'synthetic', 'rain_context_policy'],
              [['TEMP-L03-OPEN-01', 'L03-OPEN-01', 'temperature', '°C', 'room_level',
                'outdoor heat;solar exposure;occupant heat;AC schedule;cooling problems', '1', 'not directly linked']])
    write_csv(root / 'generated/anomaly_eval_2026_q1_evaluation_keys/ground_truth_labels.csv',
              ['timestamp', 'sensor_id', 'fault_active'], [[t, 'TEMP-L03-OPEN-01', '1']])

    inventory = discover(root)
    assert len(inventory) == 5
    assert all(x['status'] == 'ready' for x in inventory), inventory
    hvac = next(x for x in inventory if x['kind'] == 'hvac')
    assert hvac['zone_col'] == 'ac_zone_id'
    assert 'ac_on' in hvac['value_cols']
    assert 'ventilation_level' in hvac['value_cols']
    assert 'fault_active' not in hvac['value_cols']
    weather = next(x for x in inventory if x['kind'] == 'weather')
    assert len(weather['value_cols']) == 7
    room = next(x for x in inventory if x['kind'] == 'room')
    assert 'ac_zone_id' in room['value_cols']
    assert 'orientation_ASSUMED' in room['value_cols']

    db = tmp_path / 'e71_context.sqlite'
    build = build_index(root, db)
    assert build['metadata_indexed'] > 0
    assert build['rows_indexed'] > 0
    observed = retrieve_context('2026-01-02T11:30:00+08:00', 'L03-OPEN-01',
                                'TEMP-L03-OPEN-01', db)
    assert observed['available'], observed
    assert set(observed['source_counts']) == {'hvac', 'weather', 'occupancy'}, observed
    assert all(x['timestamp'] <= observed['as_of'] for x in observed['observations'])
    hvac_rows = [x for x in observed['observations'] if x['kind'] == 'hvac']
    assert {x['zone'] for x in hvac_rows} == {'AC-L03-Z1'}
    assert {x['attribute'] for x in hvac_rows} == {'ac_on', 'setpoint_c', 'ventilation_level'}
    assert any(x['value'] == 24.0 for x in hvac_rows)
    assert 'fault_active' not in str(observed)
    assert '88.0' not in str(observed) and '99.0' not in str(observed)
    assert not any(x['value'] == 999 for x in observed['observations'])
    assert any(x['attribute'] == 'ac_zone_id' and x['value'] == 'AC-L03-Z1'
               for x in observed['metadata'])
    assert any(x['kind'] == 'weather' and x['attribute'] == 'regional_temp_c'
               and x['value'] == 31.2 for x in observed['observations'])


def test_unmapped_room_does_not_inherit_other_hvac_zone(tmp_path):
    root = tmp_path / 'dataset'
    live = root / 'generated/llm_reference_visible'
    write_csv(live / 'hvac_state.csv',
              ['timestamp', 'ac_zone_id', 'ac_on'],
              [['2026-01-02T11:25:00+08:00', 'AC-L03-Z1', '1']])
    write_csv(live / 'room_metadata.csv',
              ['room_id', 'ac_zone_id'], [['L03-OPEN-01', 'AC-L03-Z1']])
    db = tmp_path / 'e71_context.sqlite'
    build_index(root, db)
    result = retrieve_context('2026-01-02T11:30:00+08:00', 'L03-OPEN-02', 'TEMP-X', db)
    assert not any(x['kind'] == 'hvac' for x in result['observations'])
