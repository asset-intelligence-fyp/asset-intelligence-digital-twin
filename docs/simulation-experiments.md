# UI fixes: simulation clock, A/B experiments and BIM visualisation

Development branch: `development/ui-fixes`. This work is isolated from `main` until reviewed.

## Start the app

```bash
git switch development/ui-fixes
git lfs pull
npm ci
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173. The existing 18-channel hybrid Python publisher, API, SSE and optional PostgreSQL modes are unchanged. Use Python 3.10+ and Node.js 22+.

## 1. Simulation clock

In **Simulation lab → Simulation clock**, choose date, time (MYT / UTC+08:00) and day schedule:
- Follow actual date (weekend and reviewed public holidays apply where known)
- Force working day (demo override)
- Force holiday / closed (demo override)

**Start new run** sends `POST /api/simulation/control` with `start_clock` and `calendar_mode`. The Python publisher sees a new `clock_epoch`, creates a fresh `HybridSimulator` at the chosen clock, and publishes using a new `replay_id`. It never rewrites the real OS clock. Existing memory-mode history for the earlier run is cleared on ingestion; PostgreSQL records remain stored under their previous run IDs, but the live view is scoped to the new run.

To demonstrate attendance, choose a weekday, 09:00 MYT, and force working day. The simulated attendance is calibrated from dataset-derived profiles; actual virtual headcounts are not measured people.

**Important:** The existing `Time advanced per batch` selector is independent of wall-clock release rate; a five-minute step per five-second delivery accelerates the simulated clock. All generated timestamps are labelled synthetic.

## 2. Scenario Experiment Workspace

Use **Simulation lab → Scenario Experiment Workspace**. Pick an intervention, canonical sensor and reference start time, then run an A/B comparison. Supported pairs are:
- Clear versus rain
- Typical versus busy attendance
- Working day versus holiday
- AC on versus off
- Normal versus increased ventilation

`POST /api/simulation/experiment` spawns a bounded, isolated Python comparison process. It uses the committed hybrid calibration profile, seed 42, the same starting clock and five-minute steps for one hour. The result includes paired series, generated weather and simulated headcounts. The chart displays both series and their one-hour means and difference (B − A).

The experiment does **not** submit readings, create alerts, alter the running simulator's clock or write history. Differences are synthetic scenario contrasts, **not** measured or causally validated physical effects. A shared seed does not guarantee identical random draws when interventions alter branching state.

## 3. Heatmap

The previous small sensor-disc overlays have been replaced with measured-point colouring of available **IFC room-footprint triangles** from `shared/roomFootprints.json`; sensors without a mapped footprint use a labelled sensor-vicinity disk. The heatmap does not interpolate readings into unsupported spaces.

Switching from whole-building view into Heatmap opens the floor containing the most sensors for the selected metric in **Top view**. Use the floor selector and Colour by to inspect specific rooms/metrics. Non-monitored areas stay neutral. Exact rendering and GPU transparency need manual verification on the target WebGL2 machine.

## 4–5. Synthetic occupants and optional motion

The **People** toggle draws low-poly procedural humanoids inside mapped IFC room footprints, from the validated `simulated_headcounts` data in the hybrid context. Up to four **illustrative proxies** per room are shown, not one mesh per person. The **Walking** toggle adds a bounded short movement within a source footprint triangle; it is not route planning or person tracking.

The synthetic counts are distinct from PIR sensors: PIR remains occupied/vacant, and the demo count is simulated context, not a measured headcount. Both toggles only affect 3D presentation, not generator behaviour or historical data.

## Evidence checks

```bash
npm run build
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

To inspect the endpoint directly on macOS:

```bash
curl -s -X POST http://localhost:3001/api/simulation/experiment \
 -H 'Content-Type: application/json' \
 -d '{"scenario":"rain","point_code":"RH-L03-OPEN-01","start_time":"2026-11-18T09:00:00+08:00"}'
```

Use System status to confirm 18/18 channels and the hybrid producer. Verify three visual states on the Mac: humid room colouring in Top Heatmap, visible people for a weekday 09:00 synthetic run, and walking motion with the toggle enabled.

## Known limits

- Heatmap is selected-sensor colouring, **not** a CFD simulation or a continuous inferred thermal field.
- The human figures are generated visual proxies, not IoT detections or actual room traffic.
- The experiment is not a repeat of the independent anomaly benchmark; it must not be used to claim the 85% target.
- Heatmap and procedural avatar rendering require WebGL2 and cannot be fully verified by headless CI.
- Scenario results do not persist to PostgreSQL unless explicitly exported in a future design.
