# Monitoring workspace and simulation controls

The default presentation is now light and neutral with restrained teal accents. The
atmosphere toolbar has been removed from Building overview. X-ray, its wall shading
slider, floor cuts, sensor selection and heatmap remain. Architectural materials and
X-ray shading use neutral colours. A separate dark preference is still available.

## Six sidebar destinations

| Page | Use |
| --- | --- |
| Building overview | Observe the twin and current readings. Asset register is a tab. Weather is read-only. |
| Sensors & trends | Sensor table and building charts, grouped as tabs. Aggregate power replaces the illustrative comfort-score panel. |
| Events | Open a record, inspect its retained reading snapshot and current available trend, acknowledge it, or navigate to its sensor. |
| AI assistant | Shared full-page/floating building evidence conversation, defaulting to the whole building. |
| Simulation lab | Apply weather/calendar and operating inputs, pause/resume, change simulation pace and inject a sensor fault. |
| System status | See connected components, implemented features and unverified acceptance targets. Benchmark controls are here. |

Settings remain in the running API when changing pages. Returning to the lab loads the
requested inputs; **Currently applied** reports settings actually received in a generated
batch. Changes do not rewrite stored history. API restart clears requested controls;
CLI simulation configuration still applies at startup. Return inputs to normal restores
automatic weather/calendar, attendance ×1, scheduled AC, 24 °C setpoint, ventilation ×1,
no manual fault, an unpaused run and a five-second simulation step. The wall-clock release
interval is still configured by SIM_INTERVAL_SECONDS.

## Weather affects readings

The lab's weather choices are generator inputs, not cosmetic scene switches. Rain changes
the generated outdoor rainfall, humidity, temperature and solar context. These values
enter the fitted indoor response models. The twin scene follows the generated weather.
Indoor conditions respond gradually in simulated time, and sensors react according to
their role: rainfall alone does not create a water-leak flag.

A deterministic paired check (seed 41, 08:00 Malaysia start on 5 November 2026,
five-minute simulation steps, six simulated hours, final two-hour average) gave:

| Office channel | Clear | Rain |
| --- | ---: | ---: |
| Temperature | 25.74 °C | 25.14 °C |
| Humidity | 63.24 %RH | 66.31 %RH |
| Light | 486.45 lux | 383.45 lux |
| Aggregate power | 3.45 kW | 3.30 kW |

These are simulation test outcomes for this seed and configuration, not measured building
responses or a guarantee that every weather change moves every channel in that direction.
Use the accelerated five-minute step to inspect responses without waiting real hours.

Attendance scales the calendar's generated attendance. Closed days still have zero
scheduled attendance. AC can follow its learned schedule or be explicitly forced on/off.
Setpoint modifies the thermal target of an active AC zone; ventilation changes the CO₂
excess target above the assumed 420 ppm background. Added setpoint/ventilation power terms
are explicit simplified simulation assumptions, not calibrated plant-control equations.

## Manual abnormal conditions

Choose a sensor, compatible fault, duration and offset in Simulation lab:

- Drift ramps toward an offset during the selected simulated duration.
- Spike holds an offset for that test duration.
- Stuck freezes the reported measurement.
- Missing reports NULL/unavailable.
- Leak sets a leakage sensor's flag; it is not a weather inference.

Each Start creates a unique one-shot request. Applying other building conditions retains
that ID, so it does not restart the fault. The measurement returns to its latent generated
value after expiry; the normal latent dynamics are not contaminated. Bounds still apply.
Fault labels remain in private local logs. CLI scheduled demo faults, if enabled separately,
are independent of a manual test; use SIM_FAULT_MODE=normal for lab-only experiments.

Create a test event records the selected sensor's current reading and simulation timestamp.
It does not claim automatic AI detection. The event preserves this snapshot even as current
readings change. Existing events without snapshots show only their available metadata.
Event charts show the currently retained history, not a reconstructed historical event window.
Acknowledgement and investigation are separate controls.

## Building assistant scope

The full page and floating assistant share one mounted conversation across navigation.
Choose Whole building, a location or a sensor. A backend endpoint retrieves only scoped
stored readings and computes current values, missing coverage and available 15/60/240-minute
statistics. The UI currently uses a 60-minute available-history window. Current generated
weather, calendar and applied operating settings are additional evidence.

When local qwen3:1.7b is available, it selects relevant evidence IDs from a constrained list.
The displayed evidence text and numerical summaries are rendered by the backend; invented
IDs are rejected. This version deliberately does not expose unrestricted model-written
fault diagnoses as verified results. When Qwen is unavailable or its selection is rejected,
the UI explicitly labels the response **backend evidence lookup**. That fallback is not
presented as an AI-generated answer. Follow-up questions are independent evidence queries;
the UI transcript is retained across navigation, not across a browser reload.

The earlier room-only bridge route remains for compatibility, but the new workspace uses
`/api/assistant/building`. The model is not trained by this UI change. This does not establish
≥85% anomaly accuracy, root-cause diagnosis or an automatic alert-to-event pipeline.

## Verification

Meaningful tests exercise real HTTP ingestion, complete SSE batches, operating-control
bounds, one-shot fault IDs, fault expiry, hidden-label separation, seeded weather/indoor
responses, local-only assistant access and constrained evidence selection/fallback. Existing
navigation/floor-cut/X-ray tests remain. Browser checks verified six destinations, removal
of the atmosphere bar, rain applied to the generated source, full-page cross-room evidence,
test-event snapshots and navigation back to the selected sensor.

The managed preview does not provide WebGL 2 or Ollama. Full 3D appearance and live local
model inference need verification on the Mac. Earlier replay latency results do not certify
this workspace; five-second latency and AI accuracy remain explicitly unverified.
