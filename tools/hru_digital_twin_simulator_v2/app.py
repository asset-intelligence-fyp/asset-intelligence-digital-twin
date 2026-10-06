from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
import paho.mqtt.client as mqtt

from simulator.engine import SimulationEngine
from historical.generate_history import generate as generate_history

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
GENERATED = ROOT / "data" / "generated"

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
engine = SimulationEngine()

cfg = engine.config
mqtt_cfg = cfg["mqtt"]
MQTT_HOST = mqtt_cfg.get("host", "localhost")
MQTT_PORT = int(mqtt_cfg.get("port", 1883))
BASE_TOPIC = mqtt_cfg.get("base_topic", "dt")
PUBLISH_INTERVAL = float(cfg.get("publish_interval_seconds", 2.0))

mqtt_connected = False
mqtt_error = None
running = True

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="hru-simulator-v2")


def on_connect(client, userdata, flags, reason_code, properties):
    global mqtt_connected, mqtt_error
    mqtt_connected = reason_code == 0
    mqtt_error = None if mqtt_connected else f"MQTT connect failed: {reason_code}"


def on_disconnect(client, userdata, disconnect_flags, reason_code, properties):
    global mqtt_connected, mqtt_error
    mqtt_connected = False
    if reason_code != 0:
        mqtt_error = f"MQTT disconnected: {reason_code}"


client.on_connect = on_connect
client.on_disconnect = on_disconnect

try:
    client.connect_async(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()
except Exception as exc:
    mqtt_error = str(exc)


def publisher_loop():
    global running
    while True:
        if running:
            records = engine.step()
            for rec in records:
                # Ground-truth labels are intentionally stripped from the main
                # telemetry message. The AI/backend should infer anomalies.
                payload = {
                    "timestamp": rec["timestamp"],

                    "asset_id": rec["asset_id"],

                    # One real BIM sensor
                    "sensor_id": rec["physical_sensor_id"],

                    # One of its measurement channels
                    "point_code": rec["point_code"],

                    "reading_type": rec["reading_type"],
                    "value": rec["value"],
                    "unit": rec["unit"],
                    "sequence": rec["sequence"],

                    "quality": "simulated"
                }

                topic = (
                    f"{BASE_TOPIC}/"
                    f"{rec['asset_id']}/"
                    f"{rec['point_code']}"
                )
                client.publish(topic, json.dumps(payload), qos=0, retain=False)

                # Optional separate test-only ground truth topic.
                truth_topic = (
                    f"{BASE_TOPIC}/test/groundtruth/"
                    f"{rec['asset_id']}/"
                    f"{rec['point_code']}"
                )
                truth_payload = {
                    "timestamp": rec["timestamp"],
                    "asset_id": rec["asset_id"],
                    "sensor_id": rec["physical_sensor_id"],
                    "point_code": rec["point_code"],
                    "ground_truth_state": rec["ground_truth_state"],
                    "ground_truth_anomaly_type": rec["ground_truth_anomaly_type"],
                }
                client.publish(truth_topic, json.dumps(truth_payload), qos=0, retain=False)

        time.sleep(PUBLISH_INTERVAL)


threading.Thread(target=publisher_loop, daemon=True).start()


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/status")
def status():
    return jsonify({
        "mqtt_connected": mqtt_connected,
        "mqtt_error": mqtt_error,
        "mqtt_host": MQTT_HOST,
        "mqtt_port": MQTT_PORT,
        "publish_interval_seconds": PUBLISH_INTERVAL,
        "running": running,
    })


@app.get("/api/state")
def state():
    return jsonify(engine.get_state())


@app.get("/api/scenarios")
def scenario_list():
    return jsonify(json.loads((ROOT/"config/scenarios.json").read_text(encoding="utf-8"))["scenarios"])


@app.post("/api/scenarios/trigger")
def trigger_scenario():
    body = request.get_json(force=True)
    sid = body.get("scenario_id")
    duration = float(body.get("duration_seconds", 60))
    severity = float(body.get("severity", 1.0))
    try:
        engine.trigger_scenario(sid, duration, severity)
        return jsonify({"ok": True})
    except KeyError:
        return jsonify({"error": "Unknown scenario"}), 404


@app.post("/api/scenarios/clear")
def clear_scenarios():
    engine.clear_all()
    return jsonify({"ok": True})


@app.post("/api/sensors/<sensor_id>/override")
def sensor_override(sensor_id):
    body = request.get_json(force=True)
    try:
        engine.set_sensor_override(
            sensor_id=sensor_id,
            mode=body.get("mode", "normal"),
            severity=float(body.get("severity", 1.0)),
            duration_seconds=float(body["duration_seconds"]) if body.get("duration_seconds") else None,
            fixed_value=float(body["fixed_value"]) if body.get("fixed_value") is not None else None,
        )
        return jsonify({"ok": True})
    except KeyError:
        return jsonify({"error": "Unknown sensor"}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/live/<action>")
def live_action(action):
    global running
    if action == "start":
        running = True
    elif action == "stop":
        running = False
    else:
        return jsonify({"error": "Use start or stop"}), 400
    return jsonify({"ok": True, "running": running})


@app.post("/api/history/generate")
def history_generate():
    body = request.get_json(force=True)
    days = max(1, min(int(body.get("days", 30)), 365))
    interval = max(10, min(int(body.get("interval_seconds", 60)), 3600))
    seed = int(body.get("seed", 42))
    files = generate_history(days, interval, seed, GENERATED)
    return jsonify({
        "ok": True,
        "files": {k: f"/download/{Path(v).name}" for k, v in files.items()}
    })


@app.get("/download/<path:name>")
def download(name):
    return send_from_directory(GENERATED, name, as_attachment=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8001, debug=True, use_reloader=False)
