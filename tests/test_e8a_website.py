"""Offline E8-A website adapter tests: no Ollama, DuckDB, or labels needed."""
import unittest
from llm_service.e8a_website import normalise_e8a_request

POINTS = [
    {"code": "TEMP-L03-OPEN-01", "assetId": "L03-OPEN", "sensorType": "temperature"},
    {"code": "CO2-L03-OPEN-01", "assetId": "L03-OPEN", "sensorType": "co2"},
]
CUTOFF = "2026-11-24T09:20:35+08:00"


class E8AWebsiteAdapterTests(unittest.TestCase):
    def setUp(self):
        self.request = {
            "sensor_id": POINTS[0]["code"], "points": POINTS, "as_of": CUTOFF,
            "history": [
                {"point_code": POINTS[0]["code"], "timestamp": "2026-11-24T09:15:00+08:00", "value": 24.1, "quality": "simulated"},
                {"point_code": POINTS[0]["code"], "timestamp": "2026-11-24T09:16:01+08:00", "value": 24.2, "quality": "simulated"},
                {"point_code": POINTS[0]["code"], "timestamp": "2026-11-24T09:20:11+08:00", "value": 25.6, "quality": "simulated"},
                {"point_code": POINTS[0]["code"], "timestamp": "2026-11-24T09:20:49+08:00", "value": 999, "quality": "simulated"},
                {"point_code": POINTS[1]["code"], "timestamp": "2026-11-24T09:20:06+08:00", "value": 850, "quality": "simulated"}
            ],
        }

    def test_bucketed_values_use_only_actual_latest_observations(self):
        rows, target, at, cutoff = normalise_e8a_request(self.request)
        self.assertEqual(target, POINTS[0]["code"])
        self.assertEqual(at, "2026-11-24T01:20:00Z")
        self.assertEqual(cutoff, "2026-11-24T01:20:35+00:00")
        focused = [r for r in rows if r[1] == target]
        self.assertEqual([r[3] for r in focused], [24.2, 25.6])
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(t.tzinfo is None for t, _, _, _ in rows))

    def test_truth_labels_cannot_enter_retriever(self):
        self.request["history"][0]["ground_truth"] = True
        with self.assertRaisesRegex(ValueError, "Unlabelled"):
            normalise_e8a_request(self.request)

    def test_future_readings_and_missing_quality_do_not_enter_as_evidence(self):
        self.request["history"][2]["quality"] = "missing"
        rows, _, at, _ = normalise_e8a_request(self.request)
        self.assertEqual(at, "2026-11-24T01:15:00Z")
        self.assertNotIn(25.6, [r[3] for r in rows])
        self.assertNotIn(999, [r[3] for r in rows])

    def test_requires_canonical_target_sensor_and_offset(self):
        self.request["sensor_id"] = "FAKE-99"
        with self.assertRaisesRegex(ValueError, "canonical sensor"):
            normalise_e8a_request(self.request)
        self.request["sensor_id"] = POINTS[0]["code"]
        self.request["as_of"] = "2026-11-24T09:20:35"
        with self.assertRaisesRegex(ValueError, "UTC offset"):
            normalise_e8a_request(self.request)

    def test_no_current_readings_abstains(self):
        self.request["history"] = []
        with self.assertRaisesRegex(ValueError, "No valid target"):
            normalise_e8a_request(self.request)


if __name__ == "__main__":
    unittest.main()
