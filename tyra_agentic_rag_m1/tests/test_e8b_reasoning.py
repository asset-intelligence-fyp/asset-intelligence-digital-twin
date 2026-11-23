from src.e8b_reasoning import verify_decision,run_independent_review,E8BDecision
from src.e8b_features import make_features
from datetime import datetime,timedelta,timezone


def features():
    t=datetime(2026,1,6,22,45,tzinfo=timezone.utc)
    readings=[{'timestamp':(t-timedelta(minutes=n)).isoformat(),
               'value':25.25 if n in (0,5) else 25.0} for n in range(0,1441,5)]
    traj={'historical_change_reference':{'1h':{'n':12,'p10':-.1,'p90':.1},
                                         '3h':{'n':12,'p10':-.1,'p90':.1}}}
    return make_features(sensor_id='TEMP-L03-MEET-01',origin=t,readings=readings,trajectory=traj)

def decision(**kw):
    return {'status':'suspect','fault_evidence':'supported',
            'supporting_signals':['historical_change_outside_band'],
            'claims':[{'horizon':'3h','elapsed_minutes':180,'delta':.25}],
            'explanation':'Recent change exceeds reference; fault is plausible',
            'missing_context':'HVAC state',**kw}

def test_valid_numerics_can_support_but_not_prove_anomaly():
    f=features()
    v=verify_decision(decision(),f)
    assert v['verified_status']=='suspect'
    assert v['evidence_status']=='candidate_evidence_verified'

def test_false_five_minute_claim_rejected():
    f=features()
    d=decision();d['claims']=[{'horizon':'5min','elapsed_minutes':5,'delta':.25}]
    v=verify_decision(d,f)
    assert v['verified_status']=='unknown'
    assert 'incorrect_numeric_or_time_claim' in v['errors']

def test_three_hours_claimed_as_five_minutes_rejected():
    f=features()
    d=decision();d['claims']=[{'horizon':'3h','elapsed_minutes':5,'delta':.25}]
    assert verify_decision(d,f)['verified_status']=='unknown'

def test_contradictory_alert_rejected():
    f=features()
    d=decision();d['explanation']='No clear fault or anomaly indicated by current readings.'
    assert 'text_contradicts_alert' in verify_decision(d,f)['errors']

def test_unknown_signal_and_unsupported_flag_rejected():
    f=features()
    d=decision();d['supporting_signals']=['persistent_outside_band_same_direction']
    assert 'unsupported_indicator' in verify_decision(d,f)['errors'] or f['candidate_numeric_indicators']['persistent_outside_band_same_direction']
    d['supporting_signals']=['nonexistent']
    assert 'unsupported_indicator' in verify_decision(d,f)['errors']

def test_outside_band_without_claim_rejected():
    d=decision();d['claims']=[]
    assert verify_decision(d,features())['verified_status']=='unknown'

def test_insufficient_fault_evidence_cannot_alert():
    d=decision();d['fault_evidence']='insufficient'
    assert 'inconsistent_fault_assessment' in verify_decision(d,features())['errors']

def test_unknown_stays_abstention():
    d={'status':'unknown','fault_evidence':'insufficient','supporting_signals':[],
       'claims':[], 'explanation':'Insufficient evidence'}
    assert verify_decision(d,features())['evidence_status']=='reviewer_abstained'

class LLM:
    def __init__(self,answers):self.answers=answers;self.prompts=[]
    def ask(self,system,prompt,schema):
        self.prompts.append(prompt)
        return E8BDecision.model_validate(self.answers[len(self.prompts)-1])

def test_one_repair_and_screening_is_never_visible():
    d=decision(); d['claims'][0]['elapsed_minutes']=5
    llm=LLM([d,decision()])
    proposed,validated,audit=run_independent_review(llm,features())
    assert validated['verified_status']=='suspect' and audit['attempts']==2
    assert len(llm.prompts)==2
    assert all('INITIAL SCREENING' not in p and 'screening explanation' not in p for p in llm.prompts)

def test_bad_second_attempt_remains_abstained():
    d=decision();d['claims'][0]['delta']=1e4
    llm=LLM([d,d])
    _,v,a=run_independent_review(llm,features())
    assert v['verified_status']=='unknown' and a['attempts']==2


def test_alert_claim_must_support_reported_indicator():
    f=features()
    d=decision()
    d['claims']=[{'horizon':'5min','elapsed_minutes':5,'delta':0.0}]
    v=verify_decision(d,f)
    assert v['verified_status']=='unknown'
    assert 'missing_claim_for_outside_band' in v['errors']
