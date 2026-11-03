# Level 03 Stage 1 — 18 Virtual Sensor Points

Adapted from the previous 13-point seven-sensor simulator (itself based on teammate’s HRU simulation loop). **No MQTT**. Requires Python 3.9+ with zoneinfo and a suitable timezone database; Python 3.11+ recommended.

## Quick start (from the project root)

```powershell
python -m simulator.run --ticks 10 --interval-seconds 1 --out-dir outputs/stage1_test
python -m unittest discover -s tests -v
```

Expected: `sensors=18` per tick. Open `outputs/stage1_test/latest.json` and `sensor_history.csv`.

For a full simulated day starting at 00:00:

```powershell
python -m simulator.run --start-sim-time 2026-10-30T00:00:00+08:00 --ticks 1440 --interval-seconds 0.001 --out-dir outputs/full_day_stage1
```

For controlled abnormal events (begins after 180 simulated minutes):

```powershell
python -m simulator.run --ticks 350 --interval-seconds 0.001 --fault-mode demo --out-dir outputs/stage1_fault_demo
```

For continuous one-minute sampling: `python -m simulator.run --interval-seconds 60 --out-dir outputs/live_stage1`.

Optional HTTP publishing, **only after teammate has installed the receiver endpoint**:

```powershell
python -m simulator.run --interval-seconds 60 --out-dir outputs/live_stage1 --http-url http://localhost:3001/api/simulated-readings
```

The proposed POST endpoint is **not implemented in the website by this ZIP**. Backend should accept a JSON batch, persist 18 readings, and use existing SSE to update React. `http_ack_ms` measures only HTTP response time: confirm under-five-second latency with website render timestamps.

## Stage 1 allocation

| Location | Sensor types | Count |
|---|---|---:|
| Open Office 01 | Temperature, Humidity, CO2, Occupancy, Light | 5 |
| Meeting Room 01 | Temperature, Humidity, CO2, Occupancy, Light | 5 |
| WC 01 | Occupancy, Light, Humidity, Water Leakage | 4 |
| Cleaning Room 01 | Occupancy, Light, Water Leakage | 3 |
| Floor Virtual Power Point | Power (kW) | 1 |
| **Total** | **Seven sensor types** | **18** |

These are **provisional IDs, not confirmed IFC/BIM IDs**. Coordinate with BIM teammate and edit `config/sensors.json` before integration.

## Modified files relative to the 13-point ZIP

- `config/sensors.json` — changes 4 illustrative locations / 13 points to 5 Stage 1 locations / **18 points**, including Light+Occupancy in WC and Cleaning Room.
- `simulator/core.py` — adds short cleaning-room presence windows; leak events now cover both wet-area sensors; normal seven-sensor generation and temperature AC model are retained.
- `tests/test_simulator.py` — asserts 18 points, exact per-type distribution, unique IDs, and cleaning-room occupancy.
- `README.md` — Stage 1 instructions, limitations, HTTP/SSE handoff.
- `docs/STAGE1_BIM_HANDOFF.md` — mapping for teammate and implementation steps.

Unchanged: `simulator/run.py` (loop, JSON, CSV, HTTP), `config/simulation.json` (AC, weather, ventilation assumptions), original general SOP and integration notes.

**Limitations:** example weather/load/CO2 parameters are not calibrated; PIR is a binary approximation, not people counter; sampled floor power is an assumed aggregate. The simulation does not prove physical building fidelity. `--start-sim-time` and `--interval-seconds` represent simulation clock and real-time delivery cadence respectively.

## SOP v1.4 update — three modes (implemented)

This version follows `docs/SENSOR_SIMULATION_SOP.md` and preserves **both all-normal and all-scenario demo generation**. It additionally supports occasional random faults in the `live` mode.

```powershell
# Everything normal (no deliberately injected events)
python -m simulator.run --fault-mode normal --ticks 1440 --interval-seconds 0.001 --start-sim-time 2026-10-30T00:00:00+08:00 --out-dir outputs/v14_normal

# Repeatable scenario tests (the original eight affected sensor points)
python -m simulator.run --fault-mode demo --ticks 350 --interval-seconds 0.001 --out-dir outputs/v14_demo

# Live behaviour with occasional deterministic random anomalies; sample a full week
python -m simulator.run --fault-mode live --ticks 10080 --interval-seconds 0.001 --start-sim-time 2026-10-30T00:00:00+08:00 --seed 437119 --out-dir outputs/v14_live_week

# Actual one batch per 60 real seconds (18 readings per batch; no HTTP until backend is ready)
python -m simulator.run --fault-mode live --interval-seconds 60 --out-dir outputs/v14_live
```

`--interval-seconds` affects **real time between batches**; simulated timestamps always advance **one minute per batch**. `--fault-mode live` means **occasional** anomalies and can run several simulated days with no faults. To reliably demonstrate anomalies use `demo`. The previous `normal` mode is unchanged in purpose. Do not reuse an output directory when repeating a run: CSV files append.

Files: `sensor_history.csv` (18 readings/tick), `latest.json` (latest batch), `ground_truth_labels.csv` (separate fault-injection answer key), `ground_truth_events.csv` (live-mode scheduled events), `delivery_log.csv` (HTTP ack if enabled).

**What changed in v1.4:**
- `config/simulation.json`: adds indoor thermal equilibrium, humidity, CO₂ source, lighting, live fault probability and per-scenario validity/length/severity.
- `config/sensors.json`: includes *assumed* room volumes and virtual unmonitored floor baseline; same 18 sensor IDs preserved.
- `simulator/core.py`: CO₂ balance now depends on room volume; nighttime temperature target no longer equals outdoor temperature; room-use schedules vary by day; lighting has switch-off delay; live scenario planner chooses valid random events; demo CO₂ is observable.
- `simulator/run.py`: retains the teammate-derived CSV/JSON loop and optional HTTP POST with **no MQTT**, adds `live` choice and event metadata CSV.
- `tests/test_simulator.py`: adds tests for normal, live reproducibility and the CO₂ demo.
- `docs/SENSOR_SIMULATION_SOP.md`: defines implemented v1.4 normal and abnormal rules and clearly labels assumptions.

**Note on low latency:** HTTP POST is optional, and the Express receiving endpoint in your teammate's Website repository must still be implemented/connected to PostgreSQL and SSE. The generator's `http_ack_ms` is **not** browser-render latency. No measured <5s guarantee is claimed.
