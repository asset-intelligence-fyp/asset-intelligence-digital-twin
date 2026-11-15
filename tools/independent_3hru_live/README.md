# Independent three-HRU live simulator (MQTT)

This is the independent stateful synthetic simulator from the supplied `PPT_LBNL_Independent_3HRU_Live.zip`, adapted to publish to the existing Level 5 website's MQTT ingestion path. It does **not** replay historical LBNL rows and is **not** a physical building feed. It produces 9 BIM-linked sensor points plus 5 supporting variables (supporting variables are written locally, not sent to MQTT). The simulator uses outdoor-weather statistics fitted from an offline training split; thermal/control assumptions are illustrative, not field-validated.

## Important: stop ALL previous simulator processes

On your Mac, press `Ctrl+C` in any terminal running
`tools/hru_digital_twin_simulator_v2/app.py` or
`tools/level5_digital_twin_simulator_final/app.py`. Git pull removes
the repository files, **not the running processes**. If you cannot find
the terminal, inspect the process list with `ps aux | grep '[p]ython'`;
stop only the PID for the obsolete simulator, using `kill <PID>`.
Leave Mosquitto running.

Old topics `S-L5-008-HUM` and `S-L5-008-CO2` must never become
new active PostgreSQL points. No need to delete historical rows or
recreate the database.

## One-time setup

From the project root, install Node dependencies (`npm install`) and configure PostgreSQL. Apply the nine-point migration if it has not been applied already (back up the existing database first):

```bash
pg_dump -Fc -d digital_twin -f digital_twin_before_mqtt.backup
psql -X -v ON_ERROR_STOP=1 -d digital_twin -f database/seed_level5_nine_point_profile.sql
```

Do **not** run `database/postgres_init.sql` against a populated database; it drops tables. Don't start the legacy eleven-point simulator simultaneously.

On macOS install Mosquitto if needed: `brew install mosquitto`.

In separate terminals (all commands from repository root):

```bash
# Terminal 1: MQTT broker (or use a broker already listening on port 1883)
mosquitto -v

# Terminal 2: Node API + Vite website
npm run dev

# Terminal 3: Python virtual environment, simulator and MQTT publisher
python3 -m venv tools/independent_3hru_live/.venv
source tools/independent_3hru_live/.venv/bin/activate
python -m pip install -r tools/independent_3hru_live/requirements.txt
python tools/independent_3hru_live/scripts/simulate_live.py --mqtt --interval-seconds 5
```

Open http://localhost:5173/simulator and http://localhost:5173/sensor-data or /bim-viewer. At the above rate, each **simulated minute** is advanced every 5 real seconds. For real-minute pacing, set `--interval-seconds 60`. Stop the simulator with Ctrl+C.

For a quick 10-step test without MQTT:

```bash
python tools/independent_3hru_live/scripts/simulate_live.py --ticks 10 --interval-seconds .01 --out-dir /tmp/three-hru-test --quiet
python -m unittest discover -s tools/independent_3hru_live/tests -v
```

The backend subscribes to `dt/+/+`, validates each message against the active `sensor_points` and `sensors` database mapping, inserts into PostgreSQL, then broadcasts an SSE `sensor-reading` event to browsers. The browser's cached readings, monitoring cards, and BIM inspector update without reloading the page. Source time is stored as `source_timestamp` **in the MQTT payload**; PostgreSQL `reading_timestamp` uses UTC publication time. The simulated clock is deliberately different from wall time. The current schema does not persist source time separately, so use the local `telemetry_history.csv` to correlate simulated steps. An MQTT QoS-1 acknowledgement is not proof of a PostgreSQL insert.

## Check live status

The backend exposes `GET /api/live-status`, including MQTT broker connection, last accepted message time, last point and source classification, but **cannot detect whether the Python process itself is running**. Last-message age is the key freshness signal. Watch the backend logs for `[MQTT]` entries or run:

```bash
mosquitto_sub -h localhost -p 1883 -t 'dt/+/+' -v
curl http://localhost:3001/api/live-status
psql -d digital_twin -c "SELECT point_code, reading_value, reading_timestamp FROM sensor_readings ORDER BY reading_timestamp DESC LIMIT 9;"
```

If the server logs report `Rejected unmapped point`, ensure the nine-point migration was applied to the same database the API uses. If no messages appear, ensure the Python publisher and Node API share the same broker, or set `MQTT_HOST`, `MQTT_PORT` for Python and `MQTT_URL` for Node. Optional Python `MQTT_USERNAME`, `MQTT_PASSWORD`, `--mqtt-tls` and Node broker credentials can be configured separately; do not commit secrets.

## Data contract and provenance

Each tick publishes exactly 9 JSON messages to topics of the form `dt/HRU501A/SAT-501A`, with `point_code == sensor_id`, correct `asset_id`, numeric `value`, `unit`, `sequence`, `timestamp` (actual UTC publication), `source_timestamp` (simulated clock), `quality: "simulated"`, and explicit provenance. The auxiliary 5 simulated variables are **not** assigned fictitious database sensor IDs.

Local output under `outputs/` includes `latest.json`, `telemetry_history.csv`, and separately `ground_truth_labels.csv` and `ground_truth_events.csv`. **Fault truth is never sent to the MQTT backend, normal UI, or AI inference stream.** The simulator does not perform trained AI inference or validate Chronos/TFT scores. Generated data and fault labels are ignored by Git.

The physical BIM model and eight original IFC GlobalIds are unchanged; FS-501A is represented as an unlocated HRU-linked point. If the simulator stops, stored readings remain visible but the live status changes to stale.


## Investigating fewer than nine live readings

Check `curl http://localhost:3001/api/live-status`. It returns
`expected_points: 9`, `received_points`, plus a `points` array with
`recent` and `age_seconds` for each point. The site's top-bar label and
Simulator page will show missing coverage rather than claiming full live
status when only 3 points have been received.

Use `mosquitto_sub -t 'dt/+/+' -v` while the independent script runs to
ensure nine topics appear every generated minute. In the Node logs, each
accepted message is logged with `[MQTT]`. If a point never appears in
the broker, check the Python publisher terminal and `MQTT_HOST` /
`MQTT_PORT`. If a point appears in the broker but not in PostgreSQL,
the Node terminal will report whether it was ignored as legacy, was
unmapped, or failed SQL ingestion. Run the nine-point SQL migration
only after making a database backup. The retired simulators are not
required and must not be restarted.

