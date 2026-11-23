from __future__ import annotations
import csv
import json
from datetime import datetime, timedelta
import pytest
from src.db import ingest, stamp, valid_timestamp, get_series
from src.retrieval import TemporalRetriever
from src.schemas import AnomalyAnswer, RetrievalPlan
from src.workflow import run_method


@pytest.fixture
def tiny_db(tmp_path):
    src=tmp_path/'s.csv'
    db=tmp_path/'r.duckdb'
    with src.open('w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['timestamp','sensor_id','zone_id','value'])
        origin=datetime(2025,1,1)
        for i in range(1200):
            t=stamp(origin+timedelta(minutes=i*5))
            w.writerow([t,'TEMP_01','A',20+(i%288)/100])
            w.writerow([t,'CO2_01','A',500+(i%12)])
    meta=ingest(str(src),zone_col='zone_id',db_path=str(db))
    assert meta['rows']==2400
    return db


def test_no_future_retrieval(tiny_db):
    cutoff='2025-01-04T00:00:00Z'
    r=TemporalRetriever('TEMP_01',cutoff,'forecast',12,db_path=str(tiny_db))
    recent=r.recent(3)
    assert max(valid_timestamp(x['timestamp']) for x in recent['readings'])<=valid_timestamp(cutoff)
    summ=r.summary(7)
    assert all(valid_timestamp(x['bucket_start'])<=valid_timestamp(cutoff) for x in summ['buckets'])
    sim=r.similar(3)
    assert all(valid_timestamp(x['continuation_end'])<=valid_timestamp(cutoff) for x in sim['matches'])
    assert r.context()['zone_id']=='A'
    ref=r.reference()
    assert ref['current']['timestamp']==cutoff
    assert all(valid_timestamp(x['timestamp'])<valid_timestamp(cutoff)
               for x in ref['same_weekday_and_clock'])
    assert all(valid_timestamp(x['timestamp'])<=valid_timestamp(cutoff)
               for n in r.related()['related'] for x in n['readings'])


class FakeLLM:
    def __init__(self):self.plans=0
    def ask(self,sys,prompt,schema):
        if schema is RetrievalPlan:
            self.plans+=1
            return RetrievalPlan(action='summary' if self.plans==1 else 'finish',
                                 reason='historical context')
        return AnomalyAnswer(status='suspect',anomaly_type='drift',confidence=0.65,
                             evidence_timestamps=[],explanation='Test fake evidence')


def test_langgraph_agent_selects_a_tool(tiny_db):
    r=TemporalRetriever('TEMP_01','2025-01-04T00:00:00Z',db_path=str(tiny_db))
    answer=run_method('detect','agentic',r,FakeLLM(),max_rounds=2)
    assert answer['answer']['status']=='unknown'  # unsupported positive evidence abstains
    assert answer['trace'][0]['tool']=='summary'
    assert answer['trace'][1]['tool']=='reference'
    assert answer['validation']['evidence_guard_abstained'] is True
    assert answer['evidence_count']==3


def test_wide_ingest(tmp_path):
    f=tmp_path/'wide.csv'
    f.write_text('timestamp,temp,co2\n2025-01-01T00:00:00Z,20,450\n'
                 '2025-01-01T00:05:00Z,21,460\n')
    out=ingest(str(f),fmt='wide',timestamp_col='timestamp',wide_sensors=['temp','co2'],db_path=str(tmp_path/'wide.duckdb'))
    assert out['rows']==4


def test_invalid_series_limit(tiny_db):
    with pytest.raises(ValueError):
        get_series('TEMP_01','2025-01-02T00:00:00Z',10000,str(tiny_db))


def test_label_columns_never_imported_as_wide_sensors(tmp_path):
    f=tmp_path/'wide_labeled.csv'
    f.write_text('timestamp,temp,anomaly_label\n2025-01-01T00:00:00Z,23,1\n')
    with pytest.raises(ValueError):
        ingest(str(f),fmt='wide',timestamp_col='timestamp',db_path=str(tmp_path/'x.duckdb'))
    with pytest.raises(ValueError):
        ingest(str(f),fmt='wide',timestamp_col='timestamp',
               wide_sensors=['temp','anomaly_label'],db_path=str(tmp_path/'x.duckdb'))
