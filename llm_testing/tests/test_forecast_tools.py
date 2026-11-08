import unittest
from forecast_agent.tools import ForecastTools
from forecast_agent.runner import validate

class ForecastToolsTests(unittest.TestCase):
 def sample(self):
  return {'case_id':'H_TEST','as_of_date':'2026-01-01','sensor':{'sensor_type':'rain'},'forecast_input':{'last_90d_mean':'12'},
      'daily_history':[{'date':'2025-12-31','mean':'12'}],
      'weekly_history':[{'week_start':'2025-12-22','mean_daily_value':'11'}]}
 def test_tool_names(self):
  t=ForecastTools(self.sample());self.assertGreaterEqual(len(t.specifications()),5)
  self.assertEqual(t.execute('get_sensor_metadata',{})['task'],'forecast_90_day')
  self.assertEqual(t.execute('get_historical_summary',{})['mean'],12)
 def test_cutoff(self):
  p=self.sample();p['daily_history'].append({'date':'2026-01-01','mean':'100'})
  with self.assertRaises(ValueError):ForecastTools(p)
 def test_unknown_tool(self):
  with self.assertRaises(ValueError):ForecastTools(self.sample()).execute('read_answer_keys',{})
 def test_schema(self):
  p={'predicted_mean':None,'overall_condition':'watch','overall_trend':'stable','explanation':'x',
     'evidence':[],'weekly_outlook':[{'week':i} for i in range(1,14)]}
  self.assertTrue(validate(p));p['weekly_outlook'].pop();self.assertFalse(validate(p))

if __name__=='__main__':unittest.main()
