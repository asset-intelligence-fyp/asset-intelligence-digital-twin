import json
from pathlib import Path
import pytest
from src.e8a_cache import load_causal_screenings
from src.e8a_export import export_channels


def screening():
    return {'task':'detect','method':'e7','model':'qwen3:1.7b','valid':True,
            'sensor_id':'TEMP_1','origin':'2026-01-02T04:00:00Z',
            'answer':{'status':'normal','anomaly_type':'unspecified',
                      'confidence':0.7,'evidence_timestamps':[], 'explanation':'No abrupt change'}}


def write(path, data):
    path.write_text(json.dumps(data)+'\n',encoding='utf-8')


def test_cache_loads_and_normalizes_timestamp(tmp_path):
    p = tmp_path / 'screen.jsonl'
    write(p,screening())
    cache = load_causal_screenings(p,expected_model='qwen3:1.7b')
    assert cache[('TEMP_1','2026-01-02T04:00:00Z')]['status']=='normal'


def test_cache_rejects_ground_truth(tmp_path):
    p = tmp_path / 'bad.jsonl'
    x=screening(); x['label']='anomaly'; write(p,x)
    with pytest.raises(ValueError, match='forbidden'):
        load_causal_screenings(p)


def test_cache_rejects_future_screening_evidence(tmp_path):
    p = tmp_path / 'bad.jsonl'
    x=screening(); x['answer']['evidence_timestamps']=['2026-01-02T04:05:00Z']; write(p,x)
    with pytest.raises(ValueError, match='future'):
        load_causal_screenings(p)


def test_cache_rejects_different_model(tmp_path):
    p = tmp_path / 'bad.jsonl'
    write(p,screening())
    with pytest.raises(ValueError,match='different model'):
        load_causal_screenings(p,expected_model='qwen3:4b')


def test_export_preserves_distinct_channels(tmp_path):
    p = tmp_path / 'e8a_run.jsonl'
    r={**screening(),'method':'e8a','screening':screening()['answer'],
       'verified_status':'suspect','verification':{'status':'suspect','explanation':'Reviewed'},
       'validation':{'grounded_observations':[{'timestamp':'2026-01-02T04:00:00Z'}]}}
    write(p,r)
    a,b,n=export_channels(p)
    assert n==1
    sa=json.loads(a.read_text())
    sb=json.loads(b.read_text())
    assert sa['answer']['status']=='normal'
    assert sb['answer']['status']=='suspect'
    assert sa['method']=='e8a_screening'
    assert sb['method']=='e8a_verified'
