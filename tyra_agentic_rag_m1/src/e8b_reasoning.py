"""Independent, evidence-sufficiency-focused E8-B LLM review.

The reviewer is blind to E7/E8-A screening/verification explanations.
Python verifies structured numeric claims and whether requested supporting
indicators exist. It does NOT call a threshold anomaly detector.
"""
from __future__ import annotations
import json, math, re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

SUPPORT = ('historical_change_outside_band',
           'persistent_outside_band_same_direction',
           'unusual_five_minute_step')
LAGS={'5min':5,'1h':60,'3h':180,'6h':360,'24h':1440}

class ClaimedChange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    horizon:Literal['5min','1h','3h','6h','24h']
    elapsed_minutes:int
    delta:float

class E8BDecision(BaseModel):
    model_config=ConfigDict(extra='forbid')
    status:Literal['normal','suspect','anomaly','unknown']='unknown'
    fault_evidence:Literal['supported','insufficient','contradicted']='insufficient'
    supporting_signals:list[Literal[
        'historical_change_outside_band',
        'persistent_outside_band_same_direction',
        'unusual_five_minute_step']]=Field(default_factory=list)
    claims:list[ClaimedChange]=Field(default_factory=list)
    explanation:str=''
    missing_context:str=''

REVIEW_SYSTEM='''You are the INDEPENDENT E8-B reviewer of building sensor measurements.
You have NOT been shown any previous screening or verification classification.
Return a JSON object matching the schema, and only grounded facts.

Task: classify the SENSOR AT EXACTLY AS_OF, not an earlier event.
A measured change is NOT by itself evidence of a sensor fault.
Use timestamped numeric facts only from CURRENT_FEATURES. Do not invent
reading values, time spans, instrument states, sensor fault types, or causes.

Signal meanings: historical_change_outside_band means at least one CURRENT
change lies outside the historical change p10-p90 band; it is a candidate
unusual change, not necessarily a fault. persistent_outside_band_same_direction
means at least two outside-band changes with the same sign. unusual_five_minute_step
means current 5-minute absolute change exceeds an earlier 5-minute step p95.
Only cite true indicator names listed under candidate_numeric_indicators.
Historical references are small and unconditioned; do not assume they prove
normality or fault. Rain can affect humidity; more occupants can increase CO2;
HVAC and occupancy affect temperature and power; daylight affects illuminance.
But do not invent these conditions. Missing context is unknown, not normal.

For status suspect/anomaly you MUST have fault_evidence='supported', at least
one true supporting_signal, and at least one correct structured claim with
exact horizon, elapsed_minutes and signed delta copied from CURRENT_FEATURES.
The signal(s) plus the full context must justify the actual current condition.
If the readings look unremarkable, choose normal with a supported explanation.
If evidence is genuinely insufficient, choose unknown and explain what's missing.
Do not use the prior screening opinion; it is intentionally omitted.
Never claim 'no clear anomaly' while classifying suspect/anomaly.
Answer in JSON only.'''

CONTRADICTIONS=[
 re.compile(r'\bno\s+(?:clear|direct|meaningful|sufficient|convincing)\s+(?:evidence\s+of\s+)?(?:fault|anomal(?:y|ies)|abnormal)', re.I),
 re.compile(r'\bno\s+(?:indication|evidence)\s+of\s+(?:a\s+)?(?:fault|anomal(?:y|ies))', re.I),
 re.compile(r'\b(?:is|appears|remains)\s+(?:within\s+)?normal\s+(?:variation|range|behavior|behaviour)', re.I),
]

def _j(x):return json.dumps(x, ensure_ascii=False, separators=(',',':'), default=str)

def independent_prompt(features:dict, context:dict|None) -> str:
    return ('TARGET SENSOR AND CAUSAL FEATURES: '+_j(features)+'\n'
            'OPTIONAL OBSERVED CONTEXT (only if reliably mapped): '+_j(context or {'status':'unavailable'})+'\n'
            'Assess whether the anomaly conclusion is supported. Do not repeat '
            'a screening classification; none is provided.')

def verify_decision(decision:dict, features:dict) -> dict:
    status=decision.get('status','unknown')
    assessment=decision.get('fault_evidence')
    refs=features['changes']
    errors=[]
    verified_claims=[]
    for c in decision.get('claims',[]):
        horizon=c.get('horizon'); minutes=c.get('elapsed_minutes')
        actual=refs.get(horizon,{})
        signed=actual.get('delta')
        try:
            measured=float(c.get('delta'))
        except (TypeError,ValueError):
            measured=float('nan')
        ok=(horizon in LAGS and minutes==LAGS[horizon]
            and signed is not None and math.isfinite(measured)
            and math.isclose(measured,signed,rel_tol=0,abs_tol=0.011))
        verified_claims.append({'claim':c, 'valid':bool(ok),
                                'actual_delta':signed,
                                'actual_elapsed_minutes':actual.get('lag_minutes')})
        if not ok:errors.append('incorrect_numeric_or_time_claim')
    signals=decision.get('supporting_signals',[])
    unknown_signals=[s for s in signals if s not in SUPPORT]
    invalid_signals=[s for s in signals if features['candidate_numeric_indicators'].get(s) is not True]
    if unknown_signals or invalid_signals: errors.append('unsupported_indicator')
    validated_horizons={v['claim']['horizon'] for v in verified_claims if v['valid']}
    if status in ('suspect','anomaly'):
        if ('historical_change_outside_band' in signals
                and not any(refs[k]['outside_reference_band'] is True
                            for k in validated_horizons if k in refs)):
            errors.append('missing_claim_for_outside_band')
        if ('persistent_outside_band_same_direction' in signals
                and sum(refs[k]['outside_reference_band'] is True
                        for k in validated_horizons if k in refs)<2):
            errors.append('missing_claims_for_persistent_shift')
        if ('unusual_five_minute_step' in signals
                and '5min' not in validated_horizons):
            errors.append('missing_claim_for_five_minute_step')
        if assessment!='supported':errors.append('inconsistent_fault_assessment')
        if not signals:errors.append('no_supporting_indicator')
        if not verified_claims:errors.append('no_numeric_claim')
        if any(p.search(decision.get('explanation','')) for p in CONTRADICTIONS):
            errors.append('text_contradicts_alert')
    elif status=='normal' and assessment=='supported' and signals:
        errors.append('normal_with_supported_fault_assessment')

    if status=='unknown' and not errors:
        return {'verified_status':'unknown','evidence_status':'reviewer_abstained',
                'valid':True,'errors':[],'validated_claims':verified_claims,
                'valid_signals':[]}
    accepted=not errors
    return {'verified_status': status if accepted else 'unknown',
            'evidence_status':'candidate_evidence_verified' if accepted else 'insufficient_or_inconsistent',
            'valid':accepted, 'errors':sorted(set(errors)),
            'validated_claims':verified_claims,
            'valid_signals':[s for s in signals if s not in invalid_signals and s in SUPPORT]}


def run_independent_review(llm, features:dict, context:dict|None=None):
    """At most two review calls; second may correct numeric/decision errors.

    The previous screening is never passed into either call.
    """
    prompt=independent_prompt(features,context)
    initial=llm.ask(REVIEW_SYSTEM,prompt,E8BDecision).model_dump()
    verdict=verify_decision(initial,features)
    audit={'attempts':1,'repair_attempted':False,
           'first_proposal':initial,'first_errors':verdict['errors']}
    if verdict['valid']:
        return initial,verdict,audit
    audit['attempts']=2; audit['repair_attempted']=True
    second_prompt=(prompt+'\nYOUR PREVIOUS REVIEW FAILED DETERMINISTIC VALIDATION: '+
                   _j({'errors':verdict['errors'],'claims':verdict['validated_claims'],
                       'invalid_signals':initial.get('supporting_signals',[])})+
                   '\nReassess the actual current reading independently. Do not invent facts. '
                   'A false-positive alert is harmful. If fault evidence is weak '
                   'choose normal only if supported, otherwise unknown. JSON only.')
    try:
        second=llm.ask(REVIEW_SYSTEM,second_prompt,E8BDecision).model_dump()
        validated=verify_decision(second,features)
        audit['final_errors']=validated['errors']
        return second,validated,audit
    except Exception as ex:
        audit['repair_error']=f'{type(ex).__name__}: {ex}'
        return initial,verdict,audit
