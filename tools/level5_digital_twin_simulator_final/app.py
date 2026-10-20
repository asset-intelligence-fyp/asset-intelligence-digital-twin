#!/usr/bin/env python3
"""Replay the validated Level 5 historical CSV to the Digital Twin's MQTT broker.

The replay uses the sample's measurements but current UTC publication times.
Original historical time is kept in source_timestamp. This publisher does not
send AI ground-truth labels into the MQTT telemetry stream.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from flask import Flask, Response, jsonify
import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parent
REGISTRY = json.loads((ROOT / "config" / "level5_points.json").read_text(encoding="utf-8"))
POINTS = REGISTRY["points"]
MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_QOS = int(os.getenv("MQTT_QOS", "1"))
INTERVAL = float(os.getenv("SIM_INTERVAL_SECONDS", "2"))
DATASET = Path(os.getenv("SIM_DATASET", str(ROOT / "data/generated/level5_normal_wide.csv"))).expanduser()
if not DATASET.is_absolute():
    DATASET = (ROOT / DATASET).resolve()

app = Flask(__name__)
lock = threading.RLock()
stop_event = threading.Event()
runner_thread = None
running = False
row_index = 0
sequence = 0
last_values = {}
last_error = None
dataset_rows = 0


def load_dataset():
    if not DATASET.is_file():
        raise FileNotFoundError(
            f"Historical CSV not found: {DATASET}. "
            "Generate it using generate_historical.py or set SIM_DATASET."
        )
    df = pd.read_csv(DATASET)
    missing = ["timestamp"] + [p["point_code"] for p in POINTS if p["point_code"] not in df]
    # Drop the timestamp entry when the column is present.
    missing = [column for column in missing if column not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required CSV columns: {', '.join(missing)}")
    if df.empty:
        raise ValueError("Cannot replay an empty dataset")
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="raise")
    return df


def publish_row(client, row):
    global sequence
    published_at = datetime.now(timezone.utc).isoformat()
    original_time = pd.Timestamp(row["timestamp"]).isoformat()

    for point in POINTS:
        code = point["point_code"]
        value = row[code]
        if pd.isna(value):
            continue
        number = int(round(float(value))) if point["measurement_type"] == "Fan Status" else round(float(value), 2)

        with lock:
            sequence += 1
            event_sequence = sequence

        payload = {
            "timestamp": published_at,
            "source_timestamp": original_time,
            "asset_id": point["asset_id"],
            "sensor_id": point["sensor_id"],
            "point_code": code,
            "reading_type": point["measurement_type"],
            "value": number,
            "unit": point["unit"],
            "sequence": event_sequence,
            "quality": "simulated",
            "generation_mode": str(row.get("source_mode", "historical_replay")),
        }
        result = client.publish(point["topic"], json.dumps(payload, separators=(",", ":")), qos=MQTT_QOS, retain=False)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            raise ConnectionError(f"MQTT publish failed for {code}, rc={result.rc}")
        with lock:
            last_values[code] = payload


def run_loop():
    global running, row_index, last_error, dataset_rows
    client = None
    try:
        df = load_dataset()
        with lock:
            dataset_rows = len(df)
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="level5-historical-replay")
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        client.loop_start()
        with lock:
            running = True
            last_error = None
        while not stop_event.is_set():
            with lock:
                idx = row_index % len(df)
            publish_row(client, df.iloc[idx])
            with lock:
                row_index = (row_index + 1) % len(df)
            stop_event.wait(INTERVAL)
    except Exception as error:
        with lock:
            last_error = str(error)
        app.logger.exception("Level 5 simulator could not publish")
    finally:
        if client is not None:
            client.loop_stop()
            client.disconnect()
        with lock:
            running = False


def start_runner():
    global runner_thread
    with lock:
        if running or (runner_thread and runner_thread.is_alive()):
            return False
        stop_event.clear()
        runner_thread = threading.Thread(target=run_loop, daemon=True)
        runner_thread.start()
    return True


HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Level 5 Digital Twin Simulator</title>
<style>
body{font:15px system-ui,-apple-system,sans-serif;max-width:1100px;margin:28px auto;padding:0 18px}
button{padding:9px 15px;margin:4px 6px 4px 0;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:15px}
th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}
.ok{color:#087a36}.error{color:#a31b22}
</style></head><body>
<h1>Level 5 Historical MQTT Replay</h1>
<p>Historical CSV → MQTT → Node.js → PostgreSQL → BIM viewer</p>
<button id="start">Start replay</button><button id="stop">Stop</button><button id="reset">Reset to first row</button>
<p id="status">Loading…</p>
<table><thead><tr><th>Point</th><th>Asset</th><th>Value</th><th>Unit</th><th>Published UTC</th></tr></thead><tbody id="rows"></tbody></table>
<script>
async function send(url,method="GET"){const res=await fetch(url,{method});if(!res.ok)throw Error("HTTP "+res.status);return res.json();}
async function refresh(){
 try{
  const data=await send("/api/status");
  const status=document.getElementById("status");
  status.className=data.error?"error":"ok";
  status.textContent=(data.running?"RUNNING":"STOPPED")+" | CSV row "+data.row_index+"/"+data.dataset_rows+
    " | MQTT "+data.mqtt_host+":"+data.mqtt_port+" | "+data.dataset+(data.error?" | "+data.error:"");
  const body=document.getElementById("rows");
  body.replaceChildren();
  for(const entry of Object.values(data.last_values).sort((a,b)=>a.point_code.localeCompare(b.point_code))){
   const tr=document.createElement("tr");
   for(const key of ["point_code","asset_id","value","unit","timestamp"]){
    const td=document.createElement("td");td.textContent=String(entry[key]??"");tr.append(td);
   }
   body.append(tr);
  }
 }catch(error){document.getElementById("status").textContent=String(error);}
}
for(const action of ["start","stop","reset"]){
 document.getElementById(action).addEventListener("click",async()=>{await send("/api/"+action,"POST");refresh();});
}
setInterval(refresh,1500);refresh();
</script></body></html>"""


@app.get("/")
def home():
    return Response(HTML, mimetype="text/html")


@app.get("/api/status")
def status():
    with lock:
        return jsonify({
            "running": running,
            "row_index": row_index,
            "sequence": sequence,
            "dataset_rows": dataset_rows,
            "dataset": str(DATASET),
            "mqtt_host": MQTT_HOST,
            "mqtt_port": MQTT_PORT,
            "interval_seconds": INTERVAL,
            "last_values": last_values,
            "error": last_error,
        })


@app.post("/api/start")
def start():
    return jsonify({"started": start_runner()})


@app.post("/api/stop")
def stop():
    stop_event.set()
    return jsonify({"stopping": True})


@app.post("/api/reset")
def reset():
    global row_index, sequence
    with lock:
        row_index = 0
        sequence = 0
    return jsonify({"reset": True})


if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "8001"))
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
