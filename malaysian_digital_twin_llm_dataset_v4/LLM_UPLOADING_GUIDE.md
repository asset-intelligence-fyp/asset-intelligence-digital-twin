# Safe file-selection guide for blind zero-shot LLM evaluation

This dataset has **no model outputs** and does **not** itself measure the LLM's accuracy.

## For anomaly detection

Give the LLM numeric data from `generated/anomaly_eval_2026_q1/sensor_history.csv`, the corresponding past-only context from `training_features.csv`/`weather_5min.csv`, and `sensor_registry.csv` / `room_metadata.csv`. Supply recent 1h–24h windows rather than 3 months of raw samples per prompt. Trigger obvious urgent alerts using normal deterministic rules, then ask the LLM to analyse trend and context.

**DO NOT attach** `ground_truth_events.csv` or `ground_truth_labels.csv` to the LLM being evaluated. Use them only in the scoring program after responses are recorded.

## For 90-day forecasting

Give the LLM the historical `daily_sensor_conditions.csv` and `weekly_sensor_conditions.csv` up to the selected origin, a row from `forecast_90day_inputs.csv` and known future calendar/climatology from `future_known_inputs_2026_q1.csv`. Ask the LLM for a 13-week forecast of **normal/watch/warning and stable/improving/deteriorating/uncertain** plus supporting numerical reference ranges. Never give it actual future rainfall, occupancy, sensor readings or fault labels.

**DO NOT attach** `forecast_90day_targets_HIDDEN.csv` when generating forecasts. Score results after inference.

## For the 60 counterfactual 90-day tests

For each `case_id`, give `forecast_cases_history_VISIBLE.csv` filtered to that case and matching rows from `forecast_cases_future_known_VISIBLE.csv`. Ask for a 90-day condition trend and warning onset estimate. Score against `forecast_cases_truth_summary_HIDDEN.csv` and `forecast_cases_future_HIDDEN.csv` after receiving predictions.

**DO NOT attach** the Python generator code or the hidden case manifest during a blind test: the generator source intentionally contains scenario construction rules, and could leak the answer.

## Metric suggestions

Numerical reference error: MAE, RMSE, and sensor-specific deadband squared error `max(0, abs(actual-predicted)-epsilon)^2`. Operational metrics: balanced accuracy, macro F1, warning recall, false-alert rate, trend F1, anomaly detection latency and warning lead time. Calibrate all thresholds and deadbands on reference history, not held-out labels.

All data in the provided packages are synthetic or scenario-based. Independent real-building validation remains necessary.
