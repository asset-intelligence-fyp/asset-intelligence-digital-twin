# Stage 1 — BIM / Backend Handoff (provisional mapping)

| Proposed room/location ID | BIM area to select | Expected virtual sensors | Count |
|---|---|---|---:|
| `L03-OPEN-01` | One selected Level 03 open office | `TEMP-L03-OPEN-01`, `RH-L03-OPEN-01`, `CO2-L03-OPEN-01`, `PIR-L03-OPEN-01`, `LUX-L03-OPEN-01` | 5 |
| `L03-MEET-01` | One Level 03 meeting room | `TEMP-L03-MEET-01`, `RH-L03-MEET-01`, `CO2-L03-MEET-01`, `PIR-L03-MEET-01`, `LUX-L03-MEET-01` | 5 |
| `L03-WC-01` | One Level 03 toilet / WC | `PIR-L03-WC-01`, `LUX-L03-WC-01`, `RH-L03-WC-01`, `LEAK-L03-WC-01` | 4 |
| `L03-CLEAN-01` | One Level 03 cleaning room | `PIR-L03-CLEAN-01`, `LUX-L03-CLEAN-01`, `LEAK-L03-CLEAN-01` | 3 |
| `L03-PWR-POINT-01` | Virtual marker near a suitable service/core location | `PWR-L03-PWR-POINT-01` | 1 |
| **Total** | Four selected rooms and one virtual power point | | **18** |

IDs are placeholders; **use actual IFC GlobalId/room mapping once your teammate confirms the specific spaces**. Do not imply the virtual power point is an existing physical meter. The current power reading is a simplified assumed floor-level load related to simulated activity, not a verified electrical circuit measurement.

## For the simulator owner

1. Edit `config/sensors.json` only if rooms/types/IDs change; the seven sensor generators are already present in `simulator/core.py`.
2. Run the 10-tick test and the unit tests; confirm each tick has 18 unique IDs and seven types.
3. Run one full day and inspect each sensor's trend, especially occupancy-dependent CO2, temperature with AC ON/OFF, and cleaning-room use. Dataset remains synthetic.
4. Change `config/simulation.json` only when you deliberately change calibrated/project assumptions; maintain documentation in the SOP.

## For the BIM / backend owner

1. Decide exact 4 BIM rooms and virtual power marker; map each proposed `room_id` to the correct IFC room GlobalId / model element.
2. Add 18 sensor markers or a grouping UI that exposes 18 separate sensor IDs.
3. Implement/confirm `POST /api/simulated-readings` in Express. It accepts a JSON object containing `sequence`, `simulated_time`, `generated_at_utc`, and `readings` (18 entries). Validate IDs/types, save to PostgreSQL, and emit via existing SSE (`/api/events`). **This endpoint does not exist merely because Python supports the `--http-url` flag.**
4. Disable frontend `Math.random()` values for the production demo, or explicitly switch the frontend to backend-fed mode.
5. Measure browser-render latency by comparing `generated_at_utc` to render time using synchronized clocks and tracking both average/P95 and maximum. `http_ack_ms` alone cannot establish the <5 s requirement.
6. Don't send labels to the live site: `ground_truth_labels.csv` is evaluator-only ground truth, not input for the detector.

## SOP and scenario caveat

Original `docs/SENSOR_SIMULATION_SOP.md` documents general behavioural rules. The Stage 1 changes are only placement/scheduling, not a claim of calibration to real conditions. Fault mode has a shared event window, intended for demonstration; improve separate, varied event windows before rigorous AI model evaluation.
