from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.e7_validation import EvidenceLedger
from src.e8a_evidence import evidence_packet, validate_e8a, verify_with_repair
from pydantic import BaseModel, Field
from typing import Literal


class Comparison(BaseModel):
    left_id: str
    right_id: str
    relation: Literal['higher_than', 'lower_than', 'equal_to', 'rose_since', 'fell_since']


class Review(BaseModel):
    status: Literal['normal', 'suspect', 'anomaly', 'unknown']
    evidence_ids: list[str] = Field(default_factory=list)
    comparisons: list[Comparison] = Field(default_factory=list)
    explanation: str = ''


def setup():
    origin = '2026-01-02T12:00:00+08:00'
    ledger = EvidenceLedger(origin)
    prev = ledger.add('TEMP_1', '2026-01-02T03:55:00Z', 24.5, source='recent')
    current = ledger.add('TEMP_1', '2026-01-02T04:00:00Z', 25.0, source='recent')
    earlier = ledger.add('TEMP_1', '2026-01-02T03:00:00Z', 23.0, source='trajectory')
    recent = {'current': ledger.entries[current], 'readings':
              [ledger.entries[prev], ledger.entries[current]], 'as_of': ledger.origin}
    trajectory = {'current_changes': {'1h': {'from_id': earlier, 'to_id': current,
                                           'delta': 2.0}},
                  'historical_change_reference': {'1h': {'n': 12, 'median': 0.2,
                                                         'p10': -0.1, 'p90': 0.3,
                                                         'current_delta': 2.0}}}
    r = SimpleNamespace(sensor_id='TEMP_1')
    packet = evidence_packet(r, recent, trajectory, [trajectory], ledger)
    return ledger, prev, current, earlier, packet


def test_packet_has_actual_ids_and_true_same_sensor_comparisons():
    ledger, prev, cur, earlier, p = setup()
    assert p['current_id'] == cur
    assert {x['right_id'] for x in p['suggested_comparisons']} == {prev, earlier}
    assert all(x['left_id'] == cur and x['relation'] == 'rose_since'
               for x in p['suggested_comparisons'])
    assert len(p['computed_differences']) == 2
    assert p['historical_change_reference']['1h']['n'] == 12
    assert all(x['timestamp'] <= ledger.origin for x in p['earlier_observations'])


def test_positive_with_true_current_comparison_grounded():
    ledger, prev, cur, _, _ = setup()
    proposal = {'status':'suspect','evidence_ids':[cur,prev],
                'comparisons':[{'left_id':cur,'right_id':prev,'relation':'rose_since'}]}
    v = validate_e8a(proposal, ledger, 'TEMP_1', cur)
    assert v['evidence_status'] == 'grounded'
    assert v['verified_status'] == 'suspect'
    assert v['current_comparison_grounded']


def test_false_numeric_claim_is_rejected():
    ledger, prev, cur, _, _ = setup()
    proposal = {'status':'anomaly','evidence_ids':[cur,prev],
                'comparisons':[{'left_id':cur,'right_id':prev,'relation':'fell_since'}]}
    v = validate_e8a(proposal, ledger, 'TEMP_1', cur)
    assert v['evidence_status'] == 'invalid_numeric_comparison'
    assert v['verified_status'] == 'unknown'


def test_historical_only_comparison_is_not_sufficient():
    ledger, prev, cur, earlier, _ = setup()
    proposal = {'status':'anomaly', 'evidence_ids':[cur,prev,earlier],
                'comparisons':[{'left_id':prev,'right_id':earlier,'relation':'rose_since'}]}
    v = validate_e8a(proposal, ledger, 'TEMP_1', cur)
    assert v['evidence_status'] == 'missing_current_comparison'
    assert v['verified_status'] == 'unknown'


def test_same_id_comparison_is_not_sufficient():
    ledger, prev, cur, earlier, _ = setup()
    proposal = {'status':'anomaly', 'evidence_ids':[cur,prev],
                'comparisons':[{'left_id':cur,'right_id':cur,'relation':'equal_to'}]}
    v = validate_e8a(proposal, ledger, 'TEMP_1', cur)
    assert v['evidence_status'] == 'missing_current_comparison'
    assert v['verified_status'] == 'unknown'


def test_missing_current_citation_rejected():
    ledger, prev, cur, _, _ = setup()
    v = validate_e8a({'status':'normal','evidence_ids':[prev], 'comparisons':[]},
                     ledger, 'TEMP_1', cur)
    assert v['verified_status'] == 'unknown'


class FakeLLM:
    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    def ask(self, system, prompt, schema):
        self.calls.append((system, prompt))
        return Review.model_validate(self.replies[len(self.calls)-1])


def test_citation_repair_one_retry_preserves_screening():
    ledger, prev, cur, _, packet = setup()
    screening = {'status':'normal','explanation':'Initial screening'}
    model = FakeLLM([
        {'status':'anomaly','evidence_ids':[cur,'OBS9999'],'comparisons':[], 'explanation':'Bad citations'},
        {'status':'suspect','evidence_ids':[cur,prev],
         'comparisons':[{'left_id':cur,'right_id':prev,'relation':'rose_since'}],
         'explanation':'Cited measured rise; status still uncertain'},
    ])
    proposal, validation, audit = verify_with_repair(model, Review, screening,
                                                     packet, ledger, 'TEMP_1')
    assert audit['attempts'] == 2 and audit['repair_attempted']
    assert audit['first_evidence_status'] == 'invalid_citation'
    assert validation['verified_status'] == 'suspect'
    assert len(model.calls) == 2
    assert screening['status'] == 'normal'
    assert 'OBS9999' in model.calls[1][1]


def test_unknown_does_not_retry_or_create_fake_alert():
    ledger, prev, cur, _, packet = setup()
    model = FakeLLM([{'status':'unknown','explanation':'Insufficient support'}])
    proposal, validation, audit = verify_with_repair(model, Review,
                                                     {'status':'anomaly'}, packet,
                                                     ledger, 'TEMP_1')
    assert proposal['status'] == 'unknown'
    assert validation['verified_status'] == 'unknown'
    assert validation['evidence_status'] == 'abstained'
    assert len(model.calls) == 1
    assert audit['repair_attempted'] is False


def test_failed_repair_remains_unknown():
    ledger, prev, cur, _, packet = setup()
    model = FakeLLM([
        {'status':'anomaly','evidence_ids':[],'comparisons':[]},
        {'status':'anomaly','evidence_ids':[cur,prev],
         'comparisons':[{'left_id':cur,'right_id':prev,'relation':'fell_since'}]},
    ])
    _, validation, audit = verify_with_repair(model, Review, {'status':'normal'},
                                              packet, ledger, 'TEMP_1')
    assert validation['verified_status'] == 'unknown'
    assert audit['attempts'] == 2
    assert validation['evidence_status'] == 'invalid_numeric_comparison'
