"""E8-B Agentic RAG: same E7/E8-A retrieval, independent fault reviewer.

Requires E8-A installed. No prior screening/verification judgment is shown to
E8-B's independent reviewer. The E8-A reviewer is skipped (not called) while
its existing, tested LangGraph retrieval/planner pipeline is reused unchanged.
"""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel,Field
from .e8b_features import make_features
from .e8b_reasoning import run_independent_review


class E8BContextPlan(BaseModel):
    action:Literal['retrieve_context','skip_context']
    reason:str=Field(default='')

class _SkipE8AReview:
    def __init__(self,llm):self.llm=llm
    def ask(self,system,prompt,schema):
        if schema.__name__=='E7Verification':
            return schema(status='unknown',evidence_ids=[],comparisons=[],
                          explanation='E8-A review skipped; replaced by independent E8-B reviewer')
        return self.llm.ask(system,prompt,schema)


def _context_plan(llm,features,context_store):
    if context_store is None:
        return {'action':'unavailable','reason':'no E8-B context index'},None
    if features['sensor_prefix'] not in ('TEMP','RH','CO2','PWR','LUX'):
        return {'action':'skip_context','reason':'context is not requested for this discrete sensor'},None
    prompt=('Decide whether observed HVAC, occupancy or weather context could change '
            'the interpretation of this sensor. Choose retrieve_context when it may '
            'help distinguish normal operations from a fault.\n'
            'You have not been shown the initial model classification.\n'
            'SENSOR: '+features['sensor_id']+'\n'
            'FEATURE FLAGS: '+str(features['candidate_numeric_indicators'])+'\n'
            'Do not assume context is already available. JSON only.')
    try:
        plan=llm.ask('You are an agentic retrieval planner. Choose whether to query mapped '
                     'past-or-current context data, not whether the sensor is faulty.',
                     prompt,E8BContextPlan).model_dump()
    except Exception as exc:
        return {'action':'unavailable','reason':f'planner_error: {type(exc).__name__}: {exc}'},None
    if plan['action'] != 'retrieve_context':
        return plan,None
    try:
        return plan,context_store.at(features['sensor_id'],features['as_of_utc'])
    except Exception as exc:
        return plan,{'status':'unavailable','reason':f'context_lookup_error: {type(exc).__name__}: {exc}'}


def run_e8b_detection(retriever,llm,max_rounds:int=2,
                      screening_override:dict|None=None,
                      context_store=None)->dict:
    # Original E8-A screening/agentic LangGraph retrieval; suppress only its
    # biased verifier and perform E8-B independent review below.
    from .e8a import run_e8a_detection
    base=run_e8a_detection(retriever,_SkipE8AReview(llm),max_rounds,
                            screening_override=screening_override)
    base['method']='e8b'
    base['original_agentic_trace']=base.get('trace',[])
    base['review_audit']={}
    base['verification']={}
    base['verified_status']='unknown'
    base['evidence_status']='verification_error'
    base['validation']={}
    base['note']='E8-B: causal temporal features + independent evidence-sufficiency review; original E7/E8-A screening preserved.'
    try:
        recent=retriever.recent(hours=25)
        features=make_features(sensor_id=retriever.sensor_id,origin=getattr(retriever,'as_of',base.get('origin')),
                               readings=recent['readings'],trajectory=base.get('trajectory'),
                               current=base.get('current_observation'))
        plan,context=_context_plan(llm,features,context_store)
        base['e8b_context_plan']=plan
        base['e8b_context']=context or {'status':'unavailable','reason':'not_retrieved'}
        base['e8b_features']=features
        review,validation,audit=run_independent_review(llm,features,context)
        base['verification']=review
        base['validation']=validation
        base['verified_status']=validation['verified_status']
        base['evidence_status']=validation['evidence_status']
        base['review_audit']=audit
    except Exception as ex:
        base['e8b_error']=f'{type(ex).__name__}: {ex}'
        base['verification']={'status':'unknown','fault_evidence':'insufficient',
                              'supporting_signals':[],'claims':[],
                              'explanation':'E8-B review unavailable; abstained.'}
        base['validation']={'valid':False,'verified_status':'unknown',
                            'evidence_status':'verification_error',
                            'errors':[base['e8b_error']]}
        base['review_audit']={'attempts':0,'repair_attempted':False}
    return base
