"""Runs with your existing project dependencies; skips when unavailable."""
from datetime import datetime, timedelta
import pytest

pytest.importorskip('duckdb')
pytest.importorskip('langgraph')
from src import e8a
from src.schemas import AnomalyAnswer
from src.db import stamp


class RetrieverStub:
    sensor_id='TEMP_1'
    as_of=datetime(2026,1,2,4,0)
    def recent(self,hours):
        assert hours==3
        vals=[]
        for k in range(37):
            vals.append({'timestamp':stamp(self.as_of-timedelta(minutes=(36-k)*5)),
                         'value':round(23+k*0.02,5)})
        return {'readings': vals}


class FakeLLM:
    def __init__(self):
        self.verifies=0
        self.screen_calls=0

    def ask(self,system,prompt,schema):
        if schema is AnomalyAnswer:
            self.screen_calls+=1
            return AnomalyAnswer(status='anomaly',anomaly_type='drift',
                                 confidence=.8,evidence_timestamps=[],
                                 explanation='Initial suspected drift')
        if schema is e8a.E7Plan:
            return e8a.E7Plan(action='finish',reason='enough')
        if schema is e8a.E7Verification:
            self.verifies+=1
            if self.verifies==1:
                return e8a.E7Verification(status='suspect',evidence_ids=[],
                                          comparisons=[],explanation='Needs citations')
            return e8a.E7Verification(status='suspect',
                   evidence_ids=['OBS0037','OBS0025'],
                   comparisons=[e8a.E7Comparison(left_id='OBS0037',
                        right_id='OBS0025',relation='rose_since')],
                   explanation='Rise from the earlier observation')
        raise AssertionError('Unexpected schema')


def test_e8a_screening_kept_and_review_repaired(monkeypatch):
    monkeypatch.setattr(e8a,'historical_trajectory',
                        lambda r,l:{'tool':'trajectory','as_of':l.origin,
                                    'historical_change_reference':{},
                                    'current_changes':{}})
    llm=FakeLLM()
    result=e8a.run_e8a_detection(RetrieverStub(),llm,max_rounds=1)
    assert result['screening_status']=='anomaly'
    assert result['answer']['status']=='anomaly'
    assert result['verified_status']=='suspect'
    assert result['review_audit']['attempts']==2
    assert result['validation']['current_comparison_grounded']
    assert llm.screen_calls==1
    assert llm.verifies==2


def test_e8a_cached_screen_uses_no_screening_llm(monkeypatch):
    monkeypatch.setattr(e8a,'historical_trajectory',
                        lambda r,l:{'tool':'trajectory','as_of':l.origin,
                                    'historical_change_reference':{},
                                    'current_changes':{}})
    llm=FakeLLM()
    cached=AnomalyAnswer(status='normal',confidence=.5,
                         evidence_timestamps=[],explanation='Cached').model_dump()
    result=e8a.run_e8a_detection(RetrieverStub(),llm,max_rounds=1,
                                  screening_override=cached)
    assert llm.screen_calls==0
    assert result['screening_status']=='normal'
    assert result['screening_source']=='cached_E7_screening'
    assert result['verified_status']=='suspect'
