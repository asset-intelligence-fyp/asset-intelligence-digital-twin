import unittest,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('evaluation',Path(__file__).parents[1]/'scripts/evaluate_room_ai.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MetricsTests(unittest.TestCase):
 def test_abstention_is_not_removed_from_accuracy(self):
  r=m.metrics([1,0,1,0],[True,False,None,True])
  self.assertEqual(r['accuracy_all_cases'],.5);self.assertEqual(r['coverage'],.75);self.assertEqual(r['recall_all_positive_cases'],.5)
 def test_all_normal_classifier_does_not_hide_missed_faults(self):
  r=m.metrics([0]*90+[1]*10,[False]*100)
  self.assertEqual(r['accuracy_all_cases'],.9);self.assertEqual(r['balanced_accuracy'],.5);self.assertEqual(r['recall_all_positive_cases'],0)
 def test_empty_test_has_no_accuracy(self):self.assertIsNone(m.metrics([],[])['accuracy_all_cases'])
if __name__=='__main__':unittest.main()
