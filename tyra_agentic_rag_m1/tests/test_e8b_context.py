import csv,json,sqlite3
from pathlib import Path
from src.e8b_context import build_context_index,E8BContextStore

def makecsv(p, rows):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)

def test_causal_context_mapping_and_no_future_leakage(tmp_path):
    dataset=tmp_path/'dataset'
    makecsv(dataset/'generated/llm_reference_visible/sensor_registry.csv',
        [{'sensor_id':'CO2-L03-MEET-01','room_id':'R1','ac_zone_id':'Z1',
          'weather_station_id':'ST1','region_id':'REG1'}])
    inputs=dataset/'generated/anomaly_eval_2026_q1_llm_inputs'
    makecsv(inputs/'headcount.csv',[
        {'timestamp':'2026-01-06T10:00:00+08:00','room_id':'R1','headcount':'5'},
        {'timestamp':'2026-01-06T10:05:00+08:00','room_id':'R1','headcount':'99'}])
    makecsv(inputs/'hvac_state.csv',[
        {'timestamp':'2026-01-06T10:00:00+08:00','ac_zone_id':'Z1','ac_on':'true','setpoint_c':'23.0'}])
    makecsv(inputs/'weather_5min.csv',[
        {'timestamp':'2026-01-06T10:00:00+08:00','weather_station_id':'ST1','regional_rain_mm_h':'8.0',
         'regional_humidity_pct':'90'}])
    path=tmp_path/'c.sqlite'
    report=build_context_index(dataset,path)
    assert report['labels_used'] is False
    store=E8BContextStore(path)
    now=store.at('CO2-L03-MEET-01','2026-01-06T02:00:00Z')
    assert now['observed_context']['occupancy']['values']['headcount']==5
    assert now['observed_context']['hvac']['values']['setpoint_c']==23
    assert now['observed_context']['weather']['values']['regional_rain_mm_h']==8
    later=store.at('CO2-L03-MEET-01','2026-01-06T02:05:00Z')
    assert later['observed_context']['occupancy']['values']['headcount']==99
    store.close()

def test_ambiguous_weather_or_unmapped_hvac_are_not_inferred(tmp_path):
    dataset=tmp_path/'dataset'
    makecsv(dataset/'generated/llm_reference_visible/sensor_registry.csv',
        [{'sensor_id':'TEMP-1','room_id':'ROOM','ac_zone_id':''}])
    inputs=dataset/'generated/anomaly_eval_2026_q1_llm_inputs'
    makecsv(inputs/'headcount.csv',[{'timestamp':'2026-01-01T12:00:00+08:00','room_id':'ROOM','headcount':'2'}])
    makecsv(inputs/'hvac_state.csv',[{'timestamp':'2026-01-01T12:00:00+08:00','ac_zone_id':'Z2','ac_on':'true'}])
    makecsv(inputs/'weather_5min.csv',[{'timestamp':'2026-01-01T12:00:00+08:00',
                                        'regional_temp_c':'31.0'}])
    db=tmp_path/'x.sqlite';build_context_index(dataset,db)
    store=E8BContextStore(db)
    c=store.at('TEMP-1','2026-01-01T04:00:00Z')
    assert 'hvac' not in c['observed_context']
    assert 'occupancy' in c['observed_context']
    store.close()
