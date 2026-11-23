"""Regression tests for the website Agentic RAG integration, without Ollama."""
import unittest
from unittest.mock import patch
from llm_service import agentic_twin as a

POINTS=[
 {"code":"TEMP-L03-MEET-01","sensorType":"temperature","unit":"°C","simulatorRoomId":"L03-MEET-01"},
 {"code":"CO2-L03-MEET-01","sensorType":"co2","unit":"ppm","simulatorRoomId":"L03-MEET-01"},
]
def req():
    return {
      "sensor_id":"TEMP-L03-MEET-01","room_id":"L03-MEET-01",
      "as_of":"2026-11-23T09:00:00Z","question":"What changed?",
      "points":POINTS,
      "history":[
        {"point_code":"TEMP-L03-MEET-01","timestamp":"2026-11-23T08:50:00Z","value":24.1},
        {"point_code":"TEMP-L03-MEET-01","timestamp":"2026-11-23T08:55:00Z","value":24.7},
        {"point_code":"TEMP-L03-MEET-01","timestamp":"2026-11-23T09:00:00Z","value":25.0},
        {"point_code":"TEMP-L03-MEET-01","timestamp":"2026-11-23T09:05:00Z","value":100.0},
        {"point_code":"CO2-L03-MEET-01","timestamp":"2026-11-23T09:00:00Z","value":850},
      ],
      "simulation":{"name":"calibrated_hybrid_v1","simulation":{
       "kind":"hybrid",
       "weather":{"timestamp":"2026-11-23T09:00:00Z","scene":"rain","rainfall_mm_per_h":4},
       "operation":{"ac_mode":"on","setpoint_c":24,"ventilation":0.6},
       "calendar":{"day_type":"workday","is_workday":True},
       "simulated_headcounts":{"L03-MEET-01":12},
       "fault":{"kind":"drift","sensor_id":"TEMP-L03-MEET-01"},
       "ground_truth_label":"anomaly"
      }},
    }

class TestAgenticTwin(unittest.TestCase):
    def test_future_observations_not_retrieved(self):
        cutoff,points,target,indexed=a.prepare(req())
        current=a.recent_evidence(indexed,target,cutoff)
        self.assertEqual(current["whole_available_window"]["latest"],25)
        self.assertEqual(current["whole_available_window"]["count"],3)
        self.assertEqual(current["last_15_min"]["change"],0.9)

    def test_context_is_temporally_bounded_and_has_no_fault_key(self):
        r=req()
        cutoff,points,target,indexed=a.prepare(r)
        context=a.context_evidence(r,points,target,cutoff)
        self.assertEqual(context["headcount"],12)
        self.assertEqual(context["operation"]["ventilation"],0.6)
        self.assertNotIn("fault",context.get("operation",{}))
        self.assertNotIn("ground_truth",str(context))
        r["simulation"]["simulation"]["weather"]["timestamp"]="2026-11-20T09:00:00Z"
        self.assertIsNone(a.context_evidence(r,points,target,cutoff)["weather"])

    def test_history_requires_real_reference(self):
        with patch.object(a,"resolve_history_path",return_value=""):
            history=a.historical_evidence("TEMP-L03-MEET-01",a.parse_time(req()["as_of"]),{})
        self.assertFalse(history["available"])

    def test_agent_returns_grounded_information_even_if_model_is_offline(self):
        with patch.object(a,"_llm",side_effect=RuntimeError("offline")), \
             patch.object(a,"resolve_history_path",return_value=""):
            result=a.investigate(req(),{"model":"qwen3:1.7b"})
        self.assertEqual(result["status"],"investigation")
        self.assertFalse(result["llm_used"])
        self.assertIn("25.0",result["finding"])
        self.assertEqual(result["trace"][0]["tool"],"recent")

    def test_one_month_projection_is_marked_exploratory_on_short_history(self):
        projected={"projected_value":25.3,"lower_scenario":23.0,"upper_scenario":27.5,
                   "direction":"stable","explanation":"Illustrative continuation only",
                   "assumptions":["Similar operating conditions"]}
        with patch.object(a,"_llm",return_value=object()), \
             patch.object(a,"ask_json",return_value=projected), \
             patch.object(a,"resolve_history_path",return_value=""):
            out=a.forecast_one_month(req(),{"model":"qwen3:1.7b"})
        self.assertEqual(out["status"],"exploratory_scenario")
        self.assertEqual(out["target_time"],"2026-12-23T09:00:00Z")
        self.assertEqual(out["projected_value"],25.3)

    def test_invalid_forecast_cannot_be_displayed(self):
        projected={"projected_value":150,"lower_scenario":20,"upper_scenario":170,
                   "direction":"increasing","explanation":"test","assumptions":[]}
        with patch.object(a,"_llm",return_value=object()), \
             patch.object(a,"ask_json",return_value=projected), \
             patch.object(a,"resolve_history_path",return_value=""):
            out=a.forecast_one_month(req(),{"model":"qwen3:1.7b"})
        self.assertEqual(out["status"],"unavailable")
        self.assertNotIn("projected_value",out)


    def test_qwen4b_forecast_model_is_recorded_separately(self):
        projected={"projected_value":24.5,"lower_scenario":22.2,"upper_scenario":26.2,
                   "direction":"stable","explanation":"Exploratory estimate",
                   "assumptions":["Similar occupancy"]}
        with patch.object(a,"_llm",return_value=object()) as llm, \
             patch.object(a,"ask_json",return_value=projected), \
             patch.object(a,"resolve_history_path",return_value=""):
            out=a.forecast_one_month(req(),{"model":"qwen3:4b"})
        self.assertEqual(out["model"],"qwen3:4b")
        self.assertEqual(out["horizon_months"],1)
        llm.assert_called_once_with({"model":"qwen3:4b"})

    def test_unapproved_forecast_model_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"Only Qwen3"):
            a._llm({"model":"unknown:model"})

if __name__ == "__main__":
    unittest.main()
