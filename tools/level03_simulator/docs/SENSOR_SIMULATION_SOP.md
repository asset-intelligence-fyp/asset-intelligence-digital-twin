# Level 03 — Normal and Abnormal Sensor Behaviour SOP v1.5

**Scope:** Stage 1, four monitored rooms + one virtual power point, 18 virtual sensor points, 7 types. No physical sensors, no MQTT. One simulated minute per tick; elapsed real time between ticks set with `--interval-seconds`. Timezone: Asia/Kuching.

**Status:** Implemented illustrative rules, not a physically calibrated model. The weather profile, room volumes, event occurrence probability, cooling response, ventilation and loads are **PROJECT ASSUMPTIONS**. They are not measurements of the BIM4LCA building.

## A. Normal sensor behaviour

| Type (location) | Behaviour Python implements | Parameter/reference distinction |
|---|---|---|
| Temperature (Open Office, Meeting) | A stateful thermal response approaches setpoint + room/occupancy offset while AC is on (weekday 08:00–18:00), and an indoor unconditioned equilibrium when off. The off equilibrium is influenced by—but does **not equal**—outdoor temperature. At the assumed reference weather, typical evenings/nights remain about 26–28°C; no artificial hard cap. | 24°C setpoint; tau 55/240 min; indoor base 26.2°C, outdoor coupling 0.18 are assumptions. DOSH 23–26°C is an occupied-office *reference*, not a hard clamp or fault classifier. |
| Humidity (Open, Meeting, WC) | Stateful gradual response toward conditioned target or a damp-service-room target, with small sensor noise. Different room targets. | 56% conditioned, WC target 67.5%, tau 100 min are assumptions. DOSH reference 40–70% RH. |
| CO₂ (Open, Meeting) | Well-mixed approximate balance: `new_ppm = previous + persons * emission_L_per_min * 1000 / volume_m3 - ACH/60 * (previous-background)`. Different room volumes, simulated persons and ventilation. | Volume: Open 210m³, Meeting 115m³; emission 0.30 L/person/min; occupied ACH 2.0, unoccupied 0.7; background 430ppm. All assumptions. DOSH 1,000ppm is an indicator, not an equipment fault threshold. |
| Occupancy (four rooms) | Binary PIR-like reading from internal room use. Workday open-office occupancy, day-to-day variable meeting sessions, short WC/cleaning visits. A binary PIR is not a people counter. | Weekday schedules and durations are assumptions. Sensor placement and false negatives not physically calibrated. |
| Light (four rooms) | Ambient daylight + artificial illumination when occupied; five-minute switch-off delay. Office artificial component 390 lux, service room 250 lux, distinct daylight contribution. | Assumed lighting geometry/output; task-lighting around 300–500 lux is contextual, not a universal room rule. |
| Power (one floor virtual point) | Instantaneous demand = idle + estimated unmonitored-floor baseline + estimated monitored-room lighting + per-person plug load + optional activity loads. | `kW`, not `kWh`; all load coefficients assumed. Meter scope: **illustrative whole Level 03 including estimated unmonitored baseline**, not an actual electrical board. |
| Water leakage (WC, Cleaning) | Binary dry (0); only event injection changes it to wet (1) for a persistent interval. | Dry/wet state only; no plumbing failure inferred. |

**Cross-sensor context:** Internal simulated people count influences CO₂ and power; occupancy changes light and power. AC status influences temperature and humidity. Room readings maintain state across ticks. Time/weekday and seeded room-specific scheduling drive a daily profile. The website receives simulated observations, **not injected fault labels**.

## B. Abnormal event SOP

| Type | Scenario | Applied disturbance | Duration | Preconditions |
|---|---|---|---|---|
| Temperature | Sustained high temperature | Raise conditioned temperature target by **5.5–7.5°C** (gradual response) | 60–180 min | Open/meeting office, occupied hours |
| Humidity | Excessive humidity | Raise WC humidity target to **78–85% RH** | 60–180 min | WC |
| CO₂ | Reduced ventilation | Lower ACH to **0.08–0.25/hour**, with people present | 45–150 min | Open/meeting office, occupied hours |
| Occupancy | PIR stuck ON | Force published PIR state to `1`, internal room-use state unchanged | 30–120 min | Room with PIR (may not be obviously abnormal throughout) |
| Light | Insufficient lighting | Reduce artificial component to **15–35%** | 15–90 min | Occupied office/meeting room |
| Power | Unexpected after-hours demand | Add **1–3 kW** load | 30–180 min | Floor virtual meter, after 18:00 |
| Water leakage | Water detected | Persistent `1` for event duration | 10–90 min | WC/cleaning room |

**Important:** All abnormal amounts/durations are **project-defined synthetic test parameters**, NOT regulatory fault thresholds. The fault event may be active while the reading is still near baseline (thermal onset), or the reading may remain elevated during recovery after the event stops.

### Event modes

- `normal`: all 18 streams generated, **no deliberate injection**. Natural high values are still possible in principle.
- `demo`: original repeatable regression demo preserved: eight designated points have a fixed injection window `[fault_start_minute, fault_start_minute + fault_duration_minutes)`. For CO₂ demo, an extended meeting is simulated so reduced ventilation is observable. This mode is intentionally not a realistic fault prevalence model.
- `live`: Continuously generates 18 sensor readings with occasional controlled random abnormal events. Each simulated day independently schedules 0–3 abnormal events according to the following project-defined probabilities: 40% for zero events, 40% for one event, 17% for two events, and 3% for three events.

 Event timing, duration, severity, and sensor selection follow the predefined scenario constraints. Different sensors may experience overlapping abnormal events when their scheduled time intervals naturally coincide. Multiple independent overlapping events on the same sensor are not permitted.

  The simulator does not deliberately force simultaneous events; overlapping events occur naturally through independently scheduled event windows. Consecutive days without abnormalities are allowed. The random seed ensures reproducibility.

  These occurrence probabilities are project-defined simulation assumptions and do not represent measured building fault frequencies.

### Ground truth and AI evaluation

`ground_truth_labels.csv` provides, per sensor/minute: `timestamp`, `sensor_id`, `room_id`, `fault_active`, `scenario`, `event_id`. `ground_truth_events.csv` records live-mode event start/end/severity/seed. Labels are never in HTTP payload or `sensor_history.csv`. **A label indicates injection, not guaranteed visible anomaly.** Compare model predictions against separately stored labels after inference, and consider a recovery-window label in future experiments.

### Validation

1. Exactly 18 readings per tick: 2 temperature, 3 humidity, 2 CO₂, 4 PIR, 4 lux, 1 kW, 2 leakage.
2. No gaps/duplicates for the same sensor timestamp; all sensor values have valid unit/type and stable room mapping.
3. Weekday/weekend and startup/shutdown profiles behave plausibly. Temperature does not jump directly to outdoor temperature; CO₂ varies with volume, occupancy and ventilation.
4. Event windows, severity, and eligible room/sensor combinations must follow the defined abnormal scenarios. Live Mode shall support 0–3 events per simulated day, allow overlapping abnormalities across different sensors, and prevent overlapping independent events on the same sensor. Each event shall have a unique Event ID, and simultaneous events shall be correctly recorded in the ground-truth files. Runs using the same seed, start time, and configuration shall be reproducible.
5. Synthetic readings are available to HTTP backend; separate ground truth is not shared as predictions.
6. Website latency measured from real `generated_at_utc` to browser render, **not simulated timestamp**. Under 5 seconds remains an integration acceptance test, not a guarantee.

## C. External reference sources (not sources of every coefficient)

- Malaysia DOSH, *Industry Code of Practice on Indoor Air Quality 2010*: https://dosh.gov.my/en/pengurusan-kimia/
- ASHRAE, *Position Document on Indoor Carbon Dioxide*: https://www.ashrae.org/file%20library/about/position%20documents/pd-on-indoor-carbon-dioxide-english.pdf
- Office lighting task guidance: https://warwick.ac.uk/services/healthsafetywellbeing/guidance/officelighting/
- ASHRAE Handbook occupant-centric sensing: https://handbook.ashrae.org/Handbooks/A23/IP/A23_Ch65/a23_ch65_ip.aspx
- LBNL FDD data collections: https://faultdetection.lbl.gov/data/ — useful for time-series and ground truth examples, **not directly used to fit these seven series**.

Numerical parameters must be recalibrated if real room dimensions, weather, sensor specifications, electrical metering scope or measured baselines become available.
