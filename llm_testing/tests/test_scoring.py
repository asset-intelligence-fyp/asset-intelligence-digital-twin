from benchmark.score import binary_metrics,macro_f1
from benchmark.run import validate,parse
from benchmark.common import check_evidence
import pytest

def test_all_denominator():
 m=binary_metrics([(True,True),(True,None),(False,False),(False,True)])
 assert m['accuracy_all']==.5 and m['coverage']==.75
 assert m['recall']==.5

def test_no_leak():
 with pytest.raises(ValueError):check_evidence({'ground_truth':'hidden'})
 check_evidence({'recent_1h':[['2026-01-01T00:00:00+08:00',25.0]]})

def test_output_validation():
 assert validate({'anomaly':True,'explanation':'measured rise'},'anomaly')
 assert not validate({'anomaly':'false','explanation':'x'},'anomaly')
 assert validate({'overall_condition':'normal','overall_trend':'stable','predicted_mean':24.1},'forecast')
 assert parse('```json\n{"anomaly":true}\n```')=={'anomaly':True}

def test_macro():
 assert macro_f1([('normal','normal')],['normal'])==1
