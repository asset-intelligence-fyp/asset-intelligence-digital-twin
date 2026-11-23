from __future__ import annotations
from src.e7_validation import EvidenceLedger
from src.e8b_evidence import validate_e8b, _alert_basis_supported

ASOF='2026-01-02T03:30:00Z'
SENSOR='CO2-L03-OPEN-01'

def _fixture():
    ledger=EvidenceLedger(ASOF)
    old=ledger.add(SENSOR,'2026-01-02T02:30:00Z',650,source='recent')
    cur=ledger.add(SENSOR,ASOF,890,source='recent')
    packet={'current_id':cur,
            'historical_change_reference':{'1h':{'n':12,'p10':-30,'p90':120,'current_delta':240}},
            'historical_level_reference':{'n':12,'p10':400,'p90':950,'current_value':890},
            'recent_observations':[{'value':850} for _ in range(9)],
            'operational_context':{'current':[{'id':'CTX0001','timestamp':ASOF,'value':8}],
                                    'historical_1h':[{'id':'CTX0002','timestamp':'2026-01-02T02:30:00Z','value':2}],
                                    'historical_3h':[]}}
    p={'status':'suspect','evidence_ids':[cur,old],
       'comparisons':[{'left_id':cur,'right_id':old,'relation':'rose_since'}],
       'context_ids':['CTX0001','CTX0002'],'context_effect':'expected',
       'diagnosis_basis':'historical_change_outlier','reference_window':'1h',
       'explanation':'CO2 rises but occupancy increased'}
    return ledger,packet,p


def test_verified_alert_requires_real_deviation():
    ledger,packet,p=_fixture()
    valid=validate_e8b(p,ledger,SENSOR,packet)
    assert valid['verified_status']=='suspect'
    assert valid['abnormality_basis_supported']
    packet['historical_change_reference']['1h']['p90']=400
    invalid=validate_e8b(p,ledger,SENSOR,packet)
    assert invalid['verified_status']=='unknown'
    assert invalid['evidence_status']=='unsupported_abnormality_basis'


def test_missing_context_citation_rejected():
    ledger,packet,p=_fixture()
    p['context_ids']=['CTX9999']
    r=validate_e8b(p,ledger,SENSOR,packet)
    assert r['verified_status']=='unknown'
    assert r['evidence_status']=='invalid_context_citation'


def test_unsupported_basis_never_forced_to_normal():
    ledger,packet,p=_fixture()
    p['diagnosis_basis']='insufficient'
    result=validate_e8b(p,ledger,SENSOR,packet)
    assert result['verified_status']=='unknown'  # no silent normal label


def test_context_cannot_by_itself_prove_fault():
    ledger,packet,p=_fixture()
    p['diagnosis_basis']='context_contradiction'
    p['context_effect']='contradictory'
    packet['historical_change_reference']['1h']['p90']=400
    status=validate_e8b(p,ledger,SENSOR,packet)
    assert status['verified_status']=='unknown'


def test_context_future_citation_is_rejected():
    ledger,packet,p=_fixture()
    packet['operational_context']['current'][0]['timestamp']='2026-01-02T03:35:00Z'
    result=validate_e8b(p,ledger,SENSOR,packet)
    assert result['verified_status']=='unknown'
    assert result['evidence_status']=='invalid_context_citation'


def test_historical_sample_count_is_required():
    ledger,packet,p=_fixture()
    packet['historical_change_reference']['1h']['n']=1
    result=validate_e8b(p,ledger,SENSOR,packet)
    assert result['verified_status']=='unknown'


def test_normal_without_outlier_is_allowed():
    ledger,packet,p=_fixture()
    p.update(status='normal',diagnosis_basis='ordinary_variation',comparisons=[])
    assert validate_e8b(p,ledger,SENSOR,packet)['verified_status']=='normal'


def test_co2_context_is_required_when_available():
    ledger,packet,p=_fixture()
    packet['operational_context']['current'][0]['kind']='occupancy'
    packet['operational_context']['current'][0]['attribute']='headcount'
    packet['operational_context']['historical_1h'][0]['kind']='occupancy'
    packet['operational_context']['historical_1h'][0]['attribute']='headcount'
    packet['operational_context']['changes']=[{'attribute':'occupancy.headcount','window':'1h',
         'delta':6,'current_id':'CTX0001','earlier_id':'CTX0002'}]
    p['context_ids']=[]
    assert validate_e8b(p,ledger,SENSOR,packet)['evidence_status']=='missing_relevant_context_citation'
    p['context_ids']=['CTX0001']
    assert validate_e8b(p,ledger,SENSOR,packet)['evidence_status']=='occupancy_growth_not_fully_cited'
    p['context_ids']=['CTX0001','CTX0002']
    assert validate_e8b(p,ledger,SENSOR,packet)['verified_status']=='suspect'


def test_humidity_rain_citation_required_when_raining():
    ledger,packet,p=_fixture()
    packet['operational_context']['current']=[
        {'id':'CTX0001','timestamp':ASOF,'kind':'weather','attribute':'rain_wet','value':1},
        {'id':'CTX0003','timestamp':ASOF,'kind':'weather','attribute':'regional_humidity_pct','value':91}]
    p['context_ids']=['CTX0003']
    status=validate_e8b(p,ledger,'RH-L03-OPEN-01',packet)
    # Target sensor mismatch is also a factual error; create RH ledger for final assertion.
    rh=EvidenceLedger(ASOF)
    old=rh.add('RH-L03-OPEN-01','2026-01-02T02:30:00Z',60,source='recent')
    cur=rh.add('RH-L03-OPEN-01',ASOF,79,source='recent')
    p['evidence_ids']=[cur,old]
    p['comparisons']=[{'left_id':cur,'right_id':old,'relation':'rose_since'}]
    packet['current_id']=cur
    assert validate_e8b(p,rh,'RH-L03-OPEN-01',packet)['evidence_status']=='rain_context_not_cited'
    p['context_ids']=['CTX0003','CTX0001']
    assert validate_e8b(p,rh,'RH-L03-OPEN-01',packet)['verified_status']=='suspect'
