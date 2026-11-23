import json
from src.e8b_export import export_channels

def test_channels_preserve_screen_and_unknown(tmp_path):
    raw={'task':'detect','method':'e8b','sensor_id':'TEMP-1','origin':'2026-01-01T00:00:00Z',
         'screening':{'status':'anomaly','confidence':0.7,'anomaly_type':'unspecified',
                      'evidence_timestamps':[],'explanation':'Original screen'},
         'verified_status':'unknown','verification':{'explanation':'Insufficient evidence'},
         'valid':True}
    inp=tmp_path/'raw.jsonl';inp.write_text(json.dumps(raw)+'\n')
    a,b,n=export_channels(inp)
    assert n==1
    screen=json.loads(a.read_text());verified=json.loads(b.read_text())
    assert screen['answer']['status']=='anomaly'
    assert verified['answer']['status']=='unknown'
    assert verified['answer']['confidence']==0.0
