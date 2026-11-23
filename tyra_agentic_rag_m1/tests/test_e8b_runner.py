from datetime import datetime,timedelta,timezone
import sys, types
from src.e8b import run_e8b_detection
from src.e8b_reasoning import E8BDecision

class E7Verification:
    def __init__(self, status='unknown',evidence_ids=None,comparisons=None,explanation=''):
        self.status=status

class StubRetriever:
    sensor_id='TEMP-L03-MEET-01'
    as_of=datetime(2026,1,6,22,45,tzinfo=timezone.utc)
    def recent(self,hours):
        assert hours==25
        return {'readings':[{'sensor_id':self.sensor_id,
                   'timestamp':(self.as_of-timedelta(minutes=m)).isoformat(),
                   'value':25.25 if m in (0,5) else 25.0}
                for m in range(0,1441,5)]}

class FakeLLM:
    def __init__(self):self.seen=[]
    def ask(self,system,prompt,schema):
        self.seen.append((schema.__name__, prompt))
        if schema.__name__=='E8BDecision':
            return E8BDecision(status='suspect',fault_evidence='supported',
                      supporting_signals=['historical_change_outside_band'],
                      claims=[{'horizon':'3h','elapsed_minutes':180,'delta':.25}],
                      explanation='The current change exceeds the reference')
        raise AssertionError('Unexpected model call: '+schema.__name__)

def test_new_reviewer_ignores_screening_and_skips_e8a_review(monkeypatch):
    module=types.ModuleType('src.e8a')
    def old_runner(retriever,adapter,max_rounds,screening_override=None):
        assert adapter.ask('screen','screen',E7Verification).status=='unknown'
        return {'task':'detect','method':'e8a','origin':retriever.as_of.isoformat(),
                'answer':{'status':'anomaly','explanation':'Biased initial opinion'},
                'screening':{'status':'anomaly','explanation':'Biased initial opinion'},
                'screening_status':'anomaly','current_observation':{'sensor_id':retriever.sensor_id,
                    'timestamp':retriever.as_of.isoformat(),'value':25.25},
                'trace':[{'tool':'trajectory'}],
                'trajectory':{'historical_change_reference':{
                    '3h':{'n':12,'p10':-.1,'p90':.1}}}}
    module.run_e8a_detection=old_runner
    monkeypatch.setitem(sys.modules,'src.e8a',module)
    llm=FakeLLM()
    result=run_e8b_detection(StubRetriever(),llm,screening_override={'status':'anomaly'})
    assert result['screening_status']=='anomaly'
    assert result['verified_status']=='suspect'
    assert result['method']=='e8b'
    assert result['review_audit']['attempts']==1
    assert len(llm.seen)==1
    assert 'Biased initial opinion' not in llm.seen[0][1]
    assert result['e8b_features']['changes']['5min']['delta']==0

class Context:
    def at(self,sensor_id,origin):
        return {'status':'available','observed_context':{'occupancy':{'values':{'headcount':3}}}}

class WithContext(FakeLLM):
    def ask(self,system,prompt,schema):
        if schema.__name__=='E8BContextPlan':
            self.seen.append(('E8BContextPlan',prompt))
            from src.e8b import E8BContextPlan
            return E8BContextPlan(action='retrieve_context',reason='occupancy affects thermal patterns')
        return super().ask(system,prompt,schema)

def test_context_retrieval_is_model_selected(monkeypatch):
    # Same wrapper, but only a requested context query is made.
    module=types.ModuleType('src.e8a')
    def old_runner(r,adapter,max_rounds,screening_override=None):
        return {'origin':r.as_of.isoformat(), 'screening_status':'normal',
                'screening':{'status':'normal'},'answer':{'status':'normal'},
                'current_observation':{'timestamp':r.as_of.isoformat(),
                                       'sensor_id':r.sensor_id,'value':25.25},
                'trace':[], 'trajectory':{'historical_change_reference':{'3h':{'n':12,'p10':-.1,'p90':.1}}}}
    module.run_e8a_detection=old_runner
    monkeypatch.setitem(sys.modules,'src.e8a',module)
    llm=WithContext()
    result=run_e8b_detection(StubRetriever(),llm,context_store=Context())
    assert result['e8b_context_plan']['action']=='retrieve_context'
    assert result['e8b_context']['observed_context']['occupancy']['values']['headcount']==3
    assert result['verified_status']=='suspect'
    assert [x[0] for x in llm.seen]==['E8BContextPlan','E8BDecision']
