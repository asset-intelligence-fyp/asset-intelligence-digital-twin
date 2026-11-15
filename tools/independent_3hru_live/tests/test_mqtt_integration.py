"""Contract tests for independent three-HRU simulation -> MQTT -> BIM."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from mqtt_contract import MQTT_POINTS, make_messages

class MQTTIntegrationTests(unittest.TestCase):
    def test_publish_contract_and_no_fault_truth(self):
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "simulate_live.py"),
            "--ticks", "2", "--interval-seconds", ".001", "--quiet", "--fault-mode",
            "sensor_spike", "--initial-fault-after-minutes", "0", "--out-dir",
            str(Path(self._tmp.name))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        snapshot = json.loads((Path(self._tmp.name) / "latest.json").read_text())
        events = make_messages(snapshot)
        self.assertEqual(len(events), 9)
        self.assertEqual(len({topic for topic, _ in events}), 9)
        self.assertEqual({e[1]["point_code"] for e in events}, {x[0] for x in MQTT_POINTS})
        for topic, msg in events:
            self.assertEqual(topic, "dt/" + msg["asset_id"] + "/" + msg["point_code"])
            self.assertEqual(msg["sensor_id"], msg["point_code"])
            self.assertEqual(msg["quality"], "simulated")
            self.assertEqual(msg["sequence"], 2)
            self.assertEqual(msg["source_timestamp"], snapshot["simulated_time"])
            for forbidden in ("event_type", "event_id", "ground_truth", "active", "severity"):
                self.assertNotIn(forbidden, msg)
        fan = next(msg for _, msg in events if msg["point_code"] == "FS-501A")
        self.assertIn(fan["value"], (0, 1))

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self._tmp.cleanup()

    def test_reject_missing_or_invalid_values(self):
        example = {"published_at": "2026-10-21T02:00:00+00:00",
            "sequence": 1, "simulated_time": "2026-07-01 10:00:00",
            "values": {"timestamp": "2026-07-01 10:00:00",
                **{key: 21.0 for key, *_ in MQTT_POINTS}}}
        example["values"]["FS-501A"] = 1
        self.assertEqual(len(make_messages(example)), 9)
        example["values"]["SAT-501A"] = float("nan")
        with self.assertRaises(ValueError):
            make_messages(example)
        example["values"].pop("SAT-501A")
        with self.assertRaises(KeyError):
            make_messages(example)


if __name__ == "__main__":
    unittest.main()

