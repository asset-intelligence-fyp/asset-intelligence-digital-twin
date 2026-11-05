# Hybrid live-data simulator — current default

This replaces dataset replay as the default source. It learns aggregate statistical
relationships from the supplied synthetic normal dataset, then creates new, continuously
varying trajectories. It is not a copy of the unavailable people_driven_v3.0 generator,
and it is not a neural network or a physically validated building model.

## Start on the Mac

Pull the updated `feature/velvet-ui` branch after saving unrelated work. The fitted profile
is committed, so **the large dataset ZIP is not needed to run the generator**. In your
existing `.env`, set these values (replace older occurrences rather than adding duplicates):

```dotenv
SIMULATOR_MODE=hybrid
SIM_STEP_SECONDS=5
SIM_INTERVAL_SECONDS=5
SIM_FAULT_MODE=normal
```

```bash
npm ci
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173/. **Overview** displays the virtual weather station;
**Simulator** additionally exposes weather and holiday demonstrations. Five simulated
seconds are advanced per five-second release: nominal 1× time, without catch-up bursts if
requests are slow. Each update creates 18 fresh indoor observations plus four outdoor
context channels. The source time defaults to the current time in Malaysia (UTC+8).

For a progress-check demonstration, advance five simulated minutes per two real seconds:

```dotenv
SIM_STEP_SECONDS=300
SIM_INTERVAL_SECONDS=2
SIM_START_TIME=2026-11-05T08:00:00+08:00
SIM_SEED=42
```

This is explicitly 150× accelerated simulation, not evidence of five-second physical
sampling. Remove SIM_START_TIME to start from now; remove SIM_SEED for a new random seed
at each launch. Fixed seeds reproduce a run only when the profile, time step, start time
and control schedule are also the same. Stop with Control+C. Run one publisher per API.
No pip packages or live weather service are needed for generation.

For PostgreSQL, keep the existing separate database setup and run `npm run db:setup`
before starting without forcing memory mode. The current additive sensor schema is reused.

## What is learned and what is assumed

| Component | Learned from normal 2023–2024 | Explicit simulation assumption |
| --- | --- | --- |
| Occupancy | Per-room hourly headcount mean/variation and probability of occupancy for workdays, weekends and public holidays | Smooth office attendance, a persistent meeting-state process, daily arrival shifts and attendance factors |
| HVAC | Hourly probability of AC operation by room and day type | Scheduled office AC is off on closed days; this is not an essential-services model |
| Outdoor weather | Month/hour wet/dry means and variation for four weather variables; wet/dry transition counts | Stateful stochastic variation, assumed temperature–humidity noise coupling, night solar constraint and scenario interventions |
| Indoor continuous channels | Twelve ridge regressions using weather, occupancy ratio, AC and time-of-day; residual variation and persistence | Bounded mean-reverting room dynamics, per-type response caps and rate limits |
| PIR / leak | Occupancy behaviour informs virtual presence | PIR is binary presence, not a people counter. Normal leakage is zero; leaks require independent fault injection |
| Calendar | Supplied 2023–2025 holiday dates are retained as calendar metadata | Reviewed Sarawak 2026 dates, weekday opening policy, company overrides and demonstration switches |

Regression features are intercept, centered outdoor temperature, centered outdoor humidity,
solar irradiance, occupancy ratio, AC state, and sine/cosine of hour. The calibrator uses
15-minute subsampling of the five-minute normal sensor series to fit 70,176 batches
from 2023–2024. Weather and occupancy aggregates use the available normal fitting-period
samples. Normal 2025 is a separate chronological validation period. The fault-injected
2026 split is never read by calibration. No badge/employee records or fault labels are used.

The fitted profile contains coefficients, statistics and holiday date metadata, **not
sensor observation sequences**. Generation does not open sensor_history.csv. Different
seeds yield different trajectories. A fixed-seed repeat is intentional reproducibility,
not dataset replay.

New readings depend on previous state; they are not independent random numbers. Weather,
attendance and AC enter the room targets together. Lighting uses presence/daylight;
power uses aggregate attendance and AC. The current virtual floor meter remains a single
aggregate, not a sum of copies across rooms. The 18 IFC demonstration aliases are unchanged.

Bounds are simulation assumptions: temperature 15–42 °C, RH 20–100%, CO₂ 420–5,000 ppm,
light 0–1,500 lux and power 0–30 kW. The 420 ppm CO₂ floor is an assumed outdoor background,
not a measured local outdoor CO₂ channel. These broad bounds are not comfort/safety limits.

## Weather sensor versus weather website

A physical weather station observes conditions at its installed site. A weather website
can instead supply a nearby station observation, gridded estimate or forecast; these are
not interchangeable evidence. MET Malaysia documents separate instruments for temperature,
wind, rain and solar radiation [1]. A single indoor temperature sensor cannot measure all
weather variables.

For this simulation-only PoC, the chosen implementation is a **virtual outdoor weather
station**, with these explicit channels:

| Virtual channel | Unit | Role |
| --- | --- | --- |
| Outdoor temperature | °C | Outdoor thermal input |
| Outdoor humidity | %RH | Outdoor humidity input |
| Solar irradiance | W/m² | Daylight / weather context |
| Rainfall rate | mm/h | Wet/dry weather context |

The supplied weather.csv labels its provenance nasa_power_hourly_interpolated; that
provenance has not been independently verified. It is used for offline calibration only.
At runtime there are no calls to NASA, MET Malaysia or any weather website. Wind and
pressure are omitted because the supplied calibration data does not contain them.

The four channels are simulation context, not four additional IFC-linked room sensors.
They are shown separately and carry `virtual_weather_station` provenance and timestamps.
They are retained in current source status / SSE context, not in the indoor sensor table
as if they were real meters. No physical weather station or roof placement is claimed.
For later longitudinal weather benchmarking add a separate context-history table.

**Simulator → Weather input** changes the generator's actual weather scenario: automatic,
clear, cloudy or rain. Indoor response is gradual. Rain does not automatically cause leaks.
A dry sensor during rain is valid. The overview's **Follow virtual weather** checkbox
makes the 3D scene follow the generated conditions. Disable it for a decorative preview;
those scene-only buttons do not alter the Python generator. Night comes from simulation
time, rather than a button pretending to change the observation clock.

## Holidays and attendance

All date decisions use Malaysia time, not the computer's UTC date. The supplied calendar
covers 2023–2025. The separate reviewed 2026 Sarawak calendar includes Gawai, Sarawak Day,
Good Friday, lunar holidays and replacement dates [2], plus the additional March holiday
from the official gazette [3]. A holiday or weekend closes scheduled office attendance and
AC by default while outdoor and indoor environmental dynamics continue.

Lunar holiday dates are **not** copied into future years. For an uncovered year the UI
explicitly warns that only weekends and custom dates are known. Review and extend
holidays.json before relying on a new year's holiday schedule. School-holiday fields in
the provided data are blank, so school holidays are represented as unknown, not fabricated.
No assumption is made that a school break closes an office.

**Simulator → Attendance calendar → Holiday demonstration** overrides the current date
for a demonstration. It is labelled as a manual override, not as a real public holiday.
Return both controls to Automatic after a demo. Overrides reset on API restart.

For company-specific closures or partial attendance, set SIM_CALENDAR_FILE to a local JSON:

```json
{
  "2026-11-06": {"name": "Company closure", "closed": true},
  "2026-11-07": {"name": "Saturday workshop", "closed": false, "attendance_factor": 0.5}
}
```

Keep company-specific files outside source control. Essential staff, equipment running
24/7, real room schedules and measured ventilation rates would require additional rules;
they are not established by the dataset alone.

## Faults and AI evaluation

Normal mode injects no faults. Optional `SIM_FAULT_MODE=demo` injects a meeting-temperature
drift at minutes 25–55, washroom leak at minutes 60–90 and missing meeting CO₂ at minutes
95–105, measured from the simulation start. These are controlled demonstration faults,
not measured failure behaviour or a representative independent acceptance set.

Fault injection changes the reported measurement, not the latent normal state. Private
labels are written locally to `runtime/hybrid/fault_truth_PRIVATE.jsonl`, with size-bounded
rotation (5 MB × 3 files). Labels never enter online observation messages or assistant
history. Archive necessary test evidence before rotation. This log is not a drop-in
replacement for the existing offline evaluator's reviewed-case format.

The fitted generator is distinct from the room-assistant AI. Its regression validation
errors do not measure chatbot/anomaly accuracy. Use held-out cases, normal windows,
false-alarm rates and detection delay. Testing on faults that you designed while tuning
the detector cannot establish an independent ≥85% result.

## Recalibration and reproducibility

Only needed when the input dataset changes:

```bash
npm run simulator:calibrate -- --dataset "/Users/emily/Downloads/generated(1).zip"
```

The standard-library calibrator reads only the normal split's sensor_history, headcount,
hvac_state, rooms, calendar, weather and manifest. ZIP processing is streamed; it does not
extract the archive or retain the full sensor history in memory. The resulting
`tools/hybrid_simulator/profile.json` can be committed after review. The ZIP stays local.

The profile includes per-sensor equilibrium-prediction diagnostics on normal 2025.
For example, held-out RMSE is about 0.61 °C for office temperature, 0.60 °C for meeting
temperature, 58.79 ppm for office CO₂ and 95.33 ppm for meeting CO₂. These evaluate the
regression target under observed inputs, **not** full generated-trajectory fidelity,
physical sensor accuracy, or the anomaly detector. Event timing and extreme behaviour
remain heuristic. More seeds and distribution/temporal comparisons are needed before
claiming that synthetic trajectories faithfully reproduce a physical building.

## Verification and limitations

Tests cover distinct seeds, repeatable runs, eight days of finite bounded outputs,
binary points, midnight solar constraints, holiday effects, weather effects without
spurious leaks, private fault labels, API schema/provenance validation, SSE, retry
idempotency, offline launch without the ZIP and browser weather/calendar controls.
The preview lacks WebGL 2 and Ollama: sensor UI and generated context were verified;
loaded 3D scene performance and live AI accuracy were not established.

HTTP POST + SSE, storage transactions, trace IDs and the latency panel are retained.
Earlier dataset-replay latency numbers are not results for this hybrid generator.
A fresh bounded run on the final Mac is needed for the five-second acceptance criterion.

## References

1. MET Malaysia, Meteorological Instruments. https://www.met.gov.my/en/pendidikan/peralatan-meteorologi/ (reviewed 5 November 2026).
2. Sarawak TALIKHIDMAT, Public Holidays for the State of Sarawak 2026. https://talikhidmat.sarawak.gov.my/talikhidmat/web/home/list_holiday_ajax/ (reviewed 5 November 2026).
3. Official Sarawak additional holiday notification. https://sag.sarawak.gov.my/web/attachment/show/?docid=cjc4MDlNUTZ5aXcvazJQNjVxSTRQUT09OjqnQJkZyskdlU9CUp_IytIN (20 March 2026 when Aidilfitri falls on 21 March).
