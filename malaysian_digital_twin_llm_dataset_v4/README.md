# Malaysian office Digital Twin — 7-year LLM research dataset v4

## What was generated

This package contains **simulated** time-series data for a *single configured office building* in Kuching, Sarawak, Malaysia. The dataset was designed for evaluating **pretrained LLM time-series anomaly detection and 90-day condition forecasting WITHOUT model training, fine-tuning or a vector-embedding store**. It supplies evidence, historical context and *hidden* evaluation targets; it does **not** itself create or prove any LLM predictions.

**Normal history:** 2019-01-01 to 2025-12-31, five-minute intervals, 19 sensor channels: original 18 + `RAIN-EXT-01` rooftop rain-intensity sensor. 2019–2025 contains 2,557 days, 736,416 five-minute timestamps, **13,991,904 sensor readings**. Timezone Asia/Kuching / UTC+08:00. Raw sensor data are partitioned into seven year-specific folders.

**Fault evaluation:** 2026-01-01 to 2026-03-31, separate from normal history, with approximately 200 injected fault events across 10 scenario types. The `.csv` labels are stored only in this holdout folder and must never be supplied to the detector/LLM during evaluation.

**Three-month forecast evaluation:** 2019–2025 contains enough seasonal cycles for a meaningful *synthetic-data* investigation of 90-day forecasts. `forecast_90day_inputs.csv` contains chronological as-of inputs and permissible future calendar/climate normals; `forecast_90day_targets_HIDDEN.csv` contains the actual 90-day synthetic outcomes to score predictions later. **The presence of seven years is not proof that an LLM can forecast accurately for 90 days.** Use rolling-origin backtesting and simple baselines.

### Weather provenance

**IMPORTANT:** This distributed dataset has **climatology-calibrated synthetic weather**. It was not possible to download NASA POWER files in the generation environment. Its seasonal reference statistics come from the WMO World Weather Information Service for Kuching (1971–2000 climate normals). Refer to: https://worldweather.wmo.int/en/city.html?cityId=80 and https://www.met.gov.my/en/pendidikan/iklim-malaysia/ . Both references indicate wetter northeastern monsoon months and a wetter January than July. Daily rain storms, exact dates and all five-minute weather are simulated.

A *local* rooftop rain gauge is also **simulated**. It follows regional weather broadly but can differ because regional grid estimates cannot determine precise rooftop rain. The `RAIN-EXT-01` measurement is local rainfall *rate in mm/h*, so `rain_wet` is derived from it and need not be a separate sensor. This corresponds to an *assumed quantitative gauge*; a cheap binary raindrop switch would supply only wet/dry information.

**When you obtain true NASA POWER files:** use `fetch_nasa_power.py` locally with network access; regenerate with `--nasa-json-dir`. NASA hourly weather is a grid-cell estimate (not a true 5-minute station observation) and the local rain gauge and building readings remain synthetic.

## Malaysian/Sarawak holidays

`data/holidays_sarawak_2019_2025.csv` includes dates compiled from the Sarawak government 2019 holidays, historical government/employer sources for other years, and the user's 2024–2025 CSV, plus **assumed office closures** on selected overlap dates (4 June 2024 and 4 June 2025). The file includes a **reference** field and `holiday_type` to show source and assumption; its last six dates cover **January–March 2026** for the held-out test period. A few observed/compensatory holidays vary by employer, government and specific proclamation. Confirm individual dates and your office's actual closure policy before real deployment. `2026` Q1 closure dates are included **only for the synthetic anomaly-holdout calendar**, based on the Sarawak holiday portal.

Sources: https://www.nreb.gov.my/web/subpage/webpage_view/398 ; https://www.kabinet.gov.my/akta-dan-warta/ ; https://talikhidmat.sarawak.gov.my/talikhidmat/web/home/list_holiday/ .

Holidays/weekends reduce ordinary attendance and meeting bookings; synthetic policy also reduces 2020/21 attendance to represent pandemic-like periods **without asserting exact real legal restriction dates**. Employees have pseudonymous ID, work team, assigned seat, WFH probabilities, sick/leave chance, arrival, lunch and departure times.

## Core data flow and physical relationships

```text
Synthetic employees / WFH schedules / calendar / badge events / meeting bookings
                 -> room headcount, PIR, artificial lighting, power
Regional weather (WMO synthetic, optionally NASA historical grids)
                 -> outdoor air temperature / humidity / regional rain
Simulated rooftop rain gauge  -> rain_wet / local rain amount
Outdoor heat, rainfall, occupant moisture, AC operation -> room temperature/RH
Occupancy and ventilation/room volume -> room CO₂
Room AC, occupancy and light load -> one floor-level electricity sensor
                 -> sensor_history.csv + room training_features.csv
```

The CO₂ model uses a simplified mass-balance dependence on **headcount, room volume and ventilation rate**; humid conditions and rain influence the indoor RH gradually. AC dehumidification attenuates weather-driven RH changes. The model includes noise, rare missing measurements, room-specific behaviour and variable schedules. These are **heuristic engineering approximations, not calibrated first-principles building physics or measured conditions**. Correlation tests are provided in `quality_report.json`.

The floor-level power meter `PWR-L03-PWR-POINT-01` is repeated in the open-office and meeting-room context for convenience: **never sum repeated copies as if they were two independent meters.**

## Directory layout

```text
malaysian_digital_twin_llm_dataset_v4/
  generate.py                   # synthetic building generator
  build_holidays.py             # reproducible holiday compilation
  fetch_nasa_power.py           # optional REAL regional weather import
  derive.py                     # daily/weekly condition tables and 90-day evaluation
  quality_check.py              # test generated physical relationships
  data/
    holidays_sarawak_2019_2025.csv
    user_holidays_2024_2025.csv
  generated/
    normal_by_year/{2019,...,2025}/
      sensor_history.csv        # timestamp × sensor_id, 19 channels
      training_features.csv     # two occupied rooms, context per 5 minutes
      training_features_open_office.csv
      headcount.csv
      weather_5min.csv
      room_bookings.csv / meeting_attendees.csv
      employees.csv / rooms.csv / calendar.csv / badge_events.csv
      hvac_state.csv / hvac_events.csv
      run_manifest.json / final_state.json
    llm_reference/
      daily_sensor_conditions.csv
      weekly_sensor_conditions.csv
      forecast_90day_inputs.csv
      forecast_90day_targets_HIDDEN.csv
      quality_report.json
    anomaly_eval_2026_q1/
      sensor_history.csv / training_features.csv / weather_5min.csv ...
      ground_truth_events.csv / ground_truth_labels.csv
```

**Example schemas:**
- `sensor_history.csv`: `timestamp, sensor_id, room_id, sensor_type, value, unit, source, sequence, quality_flag`.
- `training_features.csv`: `timestamp, room_id, headcount, occupancy_ratio, temperature_c, humidity_pct, co2_ppm, pir_occupied, light_lux, floor_power_kw, power_scope, ac_on, ac_setpoint_c, ventilation_level, meeting_booked, rain_wet, local_rain_mm_h, regional_rain_mm_h, outdoor_temp_c, outdoor_humidity_pct, solar_w_m2, rain_3h_mm, holiday, working_day, hour, day_of_week, weather_source, data_source`.
- `forecast_90day_inputs.csv` and `_targets_HIDDEN.csv` are distinct. **Only inputs go to the LLM**.

## Mac instructions

Extract the ZIP and open Terminal in the folder. Python 3.10+ standard library is sufficient for the generator:

```bash
cd ~/Desktop/FYP/malaysian_digital_twin_llm_dataset_v4
python3 --version
python3 build_holidays.py
```

To recreate all normal years while carrying state across New Year boundaries and maintaining unique sensor sequences, run:

```bash
python3 generate.py --start 2019-01-01 --end 2020-01-01 --out generated/normal_by_year/2019 --seed 211027
python3 generate.py --start 2020-01-01 --end 2021-01-01 --out generated/normal_by_year/2020 --seed 211027 --sequence-offset 105120 --initial-state generated/normal_by_year/2019/final_state.json
python3 generate.py --start 2021-01-01 --end 2022-01-01 --out generated/normal_by_year/2021 --seed 211027 --sequence-offset 210528 --initial-state generated/normal_by_year/2020/final_state.json
python3 generate.py --start 2022-01-01 --end 2023-01-01 --out generated/normal_by_year/2022 --seed 211027 --sequence-offset 315648 --initial-state generated/normal_by_year/2021/final_state.json
python3 generate.py --start 2023-01-01 --end 2024-01-01 --out generated/normal_by_year/2023 --seed 211027 --sequence-offset 420768 --initial-state generated/normal_by_year/2022/final_state.json
python3 generate.py --start 2024-01-01 --end 2025-01-01 --out generated/normal_by_year/2024 --seed 211027 --sequence-offset 525888 --initial-state generated/normal_by_year/2023/final_state.json
python3 generate.py --start 2025-01-01 --end 2026-01-01 --out generated/normal_by_year/2025 --seed 211027 --sequence-offset 631296 --initial-state generated/normal_by_year/2024/final_state.json
python3 derive.py --root generated/normal_by_year --out generated/llm_reference
python3 quality_check.py --root generated/normal_by_year --output generated/llm_reference/quality_report.json
```

For independent synthetic faults:

```bash
python3 generate.py --start 2026-01-01 --end 2026-04-01 \
  --out generated/anomaly_eval_2026_q1 --faults --events-per-type 20 \
  --seed 211028 --sequence-offset 736416 \
  --initial-state generated/normal_by_year/2025/final_state.json
```

### Switch to NASA POWER historical weather (if internet is available)

```bash
python3 fetch_nasa_power.py --start-year 2019 --end-year 2025 --out data/nasa_power_hourly
python3 generate.py --start 2019-01-01 --end 2020-01-01 \
  --nasa-json-dir data/nasa_power_hourly \
  --out generated/nasa_weather_by_year/2019 --seed 211027
```

For 2020–2025 repeat in chronological order with `--initial-state` from prior year and correct `--sequence-offset`, writing to `generated/nasa_weather_by_year/<year>`. **Do not mix synthetic-climatology and NASA-weather years** into one test dataset. NASA API: https://power.larc.nasa.gov/docs/services/api/temporal/hourly/ . Only the hourly regional meteorological inputs change; rooftop gauge, occupancy, sensors and building dynamics are still synthetic.

If NASA returns missing parameters/sentinel values or boundary-hour gaps, the generator should stop; never backfill unknowingly and then claim genuine recorded weather.

## Additional 90-day condition-deterioration benchmark

`make_deterioration_cases.py` creates 60 deliberately separate **counterfactual** historical/forward case studies: stable operation, cooling deterioration, ventilation deterioration, rain-related moisture intrusion, benign staffing growth, and normal rainy-season patterns. There are 90 days of synthetic **historical evidence** and 90 days of withheld future outcomes per case. Do **not** mistake these synthetic future examples for real future forecasts. Use `forecast_cases_history_VISIBLE.csv` and `forecast_cases_future_known_VISIBLE.csv` for zero-shot LLM inference, and evaluate against `forecast_cases_future_HIDDEN.csv` and `forecast_cases_truth_summary_HIDDEN.csv` afterward. Staffing growth can legitimately worsen CO₂ without a sensor malfunction; rainy seasons are not themselves equipment faults. The 60 scenarios are intentionally controlled and not evidence of operational generalization.

Recreate:

```bash
python3 prepare_experiment.py
python3 make_deterioration_cases.py
```

## How to use for NO-training LLM anomaly detection

At each incoming MQTT reading, store the sensor data, validate and issue immediate deterministic safety alerts (water leakage / missing sensor / clearly extreme values). Aggregate recent 1-hour, 6-hour and 24-hour summaries and the related features (local rain, regional rain, occupancy, AC, holidays). Feed the LLM a compact time series, building context, and relevant historical normal/anomaly examples retrieved using SQL/statistical/DTW similarity, **not embeddings**. Require JSON `{sensor_id, timestamp, anomaly, severity, pattern, evidence, plausible_causes, recommended_checks}`; verify every numerical statement against the evidence.

The LLMAD methodology (Liu et al., KDD 2025) is the reference for in-context, no-fine-tuning anomaly detection. It does not validate 90-day office forecasting.

## How to use for 90-day CONDITION forecasting

1. Use daily/weekly aggregates; do **not** ask for 25,920 consecutive future five-minute values (90 days at five minutes).
2. Use `forecast_90day_inputs.csv` as a sample of 90-day preceding history and *known-at-origin* future calendar/long-term-climatology descriptors. The LLM should classify future condition (`normal/watch/warning`), trend (`stable/improving/deteriorating/uncertain`) and supply reference expected ranges, uncertainty and rationale.
3. **Hide** `forecast_90day_targets_HIDDEN.csv` during inference. After generating outputs, compare to this file. Report condition macro-F1, recall of warning conditions, precision, false-warning rate and trend macro-F1; report numerical MAE, RMSE and tolerance-insensitive loss (sensor-specific pre-registered deadbands).
4. Compare against *nontrained* persistence, same-month historical seasonal median, and a simple rule-based condition baseline. The LLM must demonstrate additional value to warrant its use.
5. Use known future holidays and operating plans, not actual future rainfall, AC state or occupancy. Forecast weather needs climatological scenarios rather than exact day-specific predictions.

### Why 7 years?

2019–2025 covers seven seasonal cycles, festival-date variation and shifts in simulated workplace attendance. It supplies multiple *rolling-origin* 90-day backtests and a final untouched portion of 2025. However it is entirely simulated and its underlying equations are not independent. **The dataset cannot establish how well a 90-day forecast works on a real building**, nor how a generic pretrained LLM compares to physics-based models without evaluation. Recalibrate from real measured data when possible.

### Condition thresholds

The provided `daily_sensor_conditions.csv` uses **research-only heuristic thresholds** (e.g. temperature above 27°C or CO₂ above 1,100 ppm during work hours; RH above 75%). These are not certified Malaysian indoor air quality limits or proof of fault. Validate thresholds against the current DOSH Malaysian IAQ recommendations, sensor accuracy, building operator policy and occupancy context before production use. Rain/wet readings are a contextual factor, **not an anomaly** by themselves.

### Known limitations and caveats

- Sensor readings and local rainfall are simulated; no measured building readings were used.
- Rainfall and humidity associations were engineered to be plausible and should be checked against real data, including rain/indoor humidity delays and AC dehumidification.
- Regional NASA POWER precipitation cannot substitute for an actual site rain gauge; modeled minute rain is not a measured local observation.
- The 2020–2021 occupancy changes are an illustrative scenario, not a reconstruction of Malaysia's actual MCO orders.
- The IFC BIM file was not ingested: room geometries, sensor placement and occupancy policy are hypothetical.
- The hidden fault labels describe **injected synthetic faults**; some events may be difficult to detect depending on timing and sensor noise.
- Seven years of synthetic history contains simulator-induced dependencies. Use alternative model rules, seed sets and ideally real-building data to test generalisation.
