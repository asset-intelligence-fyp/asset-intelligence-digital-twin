# Changes relative to teammate's simulator + HTTP latency plan

## Source packages actually inspected

1. `independent_3hru_live.zip`: original `scripts/simulate_live.py`, `independent_hvac_core.py`, `mqtt_contract.py` and CSV/JSON outputs.
2. `independent_3hru_live_updated.zip`: Malaysia temperature `scripts/malaysia_room_core.py`, `reference/malaysia_room_assumptions.json`, `scripts/simulate_malaysia_room.py`.

## Exact adaptation mapping

| Teammate implementation | This new package | Treatment |
|---|---|---|
| `scripts/simulate_live.py` | `simulator/run.py` | **Adapted:** CLI tick loop, atomic `latest.json` writer, append-only CSV, ground-truth separate. Reworked multi-sensor, HTTP POST, tracking acknowledgement time. |
| `scripts/independent_hvac_core.py` | `simulator/core.py` | **Replaced:** 3-HRU machinery logic removed; seven sensor types with shared occupancy/environment model. |
| `scripts/malaysia_room_core.py` | `simulator/core.py` | **Adapted concept:** exponential `follow` thermal inertia, AC on/off schedule, setpoint, tropical illustrative temperature profile. Not a byte-for-byte copy of module. |
| `reference/malaysia_room_assumptions.json` | `config/simulation.json` | **Adapted assumptions:** outdoor hourly values and example setpoint; adds humidity/CO2/event parameters. |
| `scripts/mqtt_contract.py`, `scripts/malaysia_mqtt_contract.py` | **None** | **Removed dependency:** no MQTT broker/topics/qos/paho-mqtt needed. |
| Old HRU point list | `config/sensors.json` | **Replaced:** room-oriented virtual sensor assignment; 7 distinct types, 13 demo points. |
| Old `telemetry_history.csv` | `outputs/sensor_history.csv` | **Changed schema:** one row per sensor reading (long format), not nine HRU columns. |
| Old `ground_truth_labels.csv` | `outputs/ground_truth_labels.csv` | **Adapted:** row-wise event flag per sensor; exclude labels from live payload. |
| Old MQTT publish call | `--http-url` option | **New:** optional JSON batch HTTP POST to teammate's backend. |

No modifications have been made to the teammate's Express/React website; backend integration is a contract proposal, not a completed deployed feature.

## Suggested JSON POST contract

`POST http://localhost:3001/api/simulated-readings` (EXAMPLE path only; your teammate must implement or agree on exact endpoint)

Header: `Content-Type: application/json`

Body:
```json
{
  "sequence": 1,
  "generated_at_utc": "2026-10-30T08:00:00.100+00:00",
  "simulated_time": "2026-10-30T16:00:00+08:00",
  "source": "synthetic_demo",
  "readings": [
    {"sensor_id":"TEMP-L03-OPEN-01", "room_id":"L03-OPEN-01", "sensor_type":"temperature", "timestamp":"2026-10-30T16:00:00+08:00", "value":25.1, "unit":"°C", "source":"simulated"}
  ]
}
```
`simulation_context` is optional internal context **not** equipment fault evidence. The program currently includes it in JSON and POST for transparent debugging; backend may ignore.

**Recommended backend steps:** validate `source`, IDs and numeric values; persist batch in PostgreSQL transaction; use server push SSE `/api/events` or WebSocket to connected React clients; update sensor/room overlays in BIM. The site's existing MQTT subscriber must not be the sole ingestion mechanism. Remove/disable frontend independent random `nextValues()` to avoid competing data streams. Server should acknowledge only after DB commit if acknowledging persisted data.

## <5 second latency: crucial distinction

- **Simulated sampling interval:** one simulated minute each tick. `--interval-seconds 1` accelerates demonstration: 60 simulated minutes per real minute. This does not mean sensor data is stale.
- **Generation time:** `generated_at_utc` uses **real UTC wall time**. Never use `simulated_time` for latency calculations; it can be historic/future or deliberately accelerated.
- **Sender-to-server time:** measured as `http_ack_ms`, saved in `delivery_log.csv`. This is NOT browser latency.
- **Browser-received latency:** in React, after receiving the SSE message, calculate `Date.now() - Date.parse(batch.generated_at_utc)` in milliseconds. This requires system clocks reasonably synchronized; use NTP, or server-side monotonic spans for improved reliability.
- **Render latency:** measure after React state/DOM update (e.g. requestAnimationFrame following state update); log `rendered_at_utc`, `sensor_id/sequence`, and total latency. Batch may include several points.
- **Required acceptance:** run real backend + database + frontend, send >=100 ticks, check p95 and maximum displayed latency <5000ms. (If a single failure matters, also examine every delivery/timeout.) Zero server URL means **NO end-to-end latency test**. Set HTTP timeout to 2s as a target bound for request attempt, not a guarantee of browser display.
- **Reliable delivery:** example currently logs HTTP failures but **does not retry failed batches**. For production-like demo, add bounded retries with stable sequence + idempotent DB inserts; or replay the CSV. Mark failure if any batch is unacknowledged or not rendered.

Suggested React SSE sketch (needs adapting to existing client code):
```js
const es = new EventSource('/api/events');
es.onmessage = ({data}) => {
  const batch = JSON.parse(data);
  const now = Date.now();
  const ms = now - Date.parse(batch.generated_at_utc);
  console.log('sensor data received latency ms=', ms, 'seq=', batch.sequence);
  // Update displayed sensor data; then measure DOM commit/render.
};
```

## Commands

From the package root:
```bash
python -m unittest discover -s tests -v
python -m simulator.run --ticks 10 --interval-seconds 0.2
python -m simulator.run --ticks 400 --interval-seconds 0.01 --fault-mode demo --out-dir outputs/demo
python -m simulator.run --interval-seconds 60 --http-url http://localhost:3001/api/simulated-readings
```
**Note:** Python version 3.9+ required. No pip packages, no MQTT. Set room and circuit mapping before actual website integration. Test `--fault-mode demo` separately from normal.
