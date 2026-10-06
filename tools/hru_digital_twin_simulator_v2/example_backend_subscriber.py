import json
import paho.mqtt.client as mqtt

def on_message(client, userdata, msg):
    # Ignore test-only ground truth in the real ingestion path.
    if msg.topic.startswith("dt/test/groundtruth/"):
        return

    reading = json.loads(msg.payload.decode("utf-8"))

    required = {"timestamp", "asset_id", "sensor_id", "reading_type", "value", "sequence"}
    missing = required - reading.keys()
    if missing:
        print("Rejected:", missing)
        return

    print(
        f"{reading['timestamp']} "
        f"{reading['asset_id']} "
        f"{reading['sensor_id']} = "
        f"{reading['value']} {reading.get('unit','')}"
    )

    # Next steps in the Digital Twin backend:
    # 1. validate sensor_id -> asset_id mapping
    # 2. store observation in PostgreSQL
    # 3. calculate source-to-twin timing
    # 4. run AI preprocessing/inference
    # 5. publish current state to frontend using WebSocket

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_message
client.connect("localhost", 1883, 60)
client.subscribe("dt/+/+")
client.loop_forever()
