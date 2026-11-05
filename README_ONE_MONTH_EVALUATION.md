# One-month Qwen3 evaluation: multi-sensor rolling-origin backtest

This is the **one-calendar-month-ahead point-reading** evaluation for the existing
Qwen3 1.7B prediction feature in branch `llm_integration`. It is **not** a
forecast of all readings throughout the next month. The model itself and its
one-month-only API contract remain unchanged in this update.

## Run on the machine with the historical SQLite database

The database is local and is **not** stored in GitHub. Start Ollama and load the
model before evaluating.

```bash
git switch llm_integration
git pull --ff-only origin llm_integration
ollama pull qwen3:1.7b
export LLM_HISTORY_DB="$PWD/storage/digital_twin.sqlite"
```

Smoke test to verify that one LLM call succeeds:

```bash
python3 scripts/evaluate_llm_one_month.py --db "$LLM_HISTORY_DB" \
  --sensors CO2-L03-MEET-01 --limit-cases 1
```

**A smoke-test score is not a reliable model-accuracy result.** The report
records `partial_run` and `evaluation_scope` so that the dashboard
can visibly distinguish it from a completed benchmark.

Full default backtest across every supported temperature/humidity/CO₂ sensor
in `shared/sensorRegistry.json`:

```bash
python3 scripts/evaluate_llm_one_month.py --db "$LLM_HISTORY_DB"
# same as:
python3 scripts/evaluate_llm_one_month.py --db "$LLM_HISTORY_DB" \
  --sensors all --target-year 2025 \
  --origin-from 2024-12 --origin-to 2025-11 \
  --origin-days 1,8,15,22 --origin-hours 14 --mode rolling
```

**Expected schedule:** 12 target months × 4 days × number of registered
temperature/humidity/CO₂ sensors (currently **7**, so **336 scheduled cases**).
Actual eligible cases and valid forecasts may be fewer because missing or
stale input, unavailable ground truth, or failed LLM output are recorded as
failures rather than fabricated scores. The 18-point registry also contains
occupancy, lighting, leakage, and power sensors **not supported** by this
forecast endpoint; they are intentionally excluded.

This entails up to 336 sequential *real Qwen3 calls*. Run a limited subset
first if you need to check setup, and do not treat its metrics as final. You may
still select sensors explicitly with `--sensors CODE1,CODE2`
or select times with `--origin-hours 10,14`. The local target-year
ground truth comes from normal synthetic readings within ±30 minutes of the
forecast target. It does **not** validate accuracy on installed sensors.

## Outputs

All are written to `reports/llm_one_month_eval/` (regenerated per run).

- `cases.csv`: each scheduled origin, predicted/actual reading, LLM errors,
  and three no-training baseline predictions/errors.
- `summary.json`: existing schema-v1 dashboard fields plus per-sensor
  median and p90 absolute errors, truth coverage, recent-mean and seasonal-naive
  baseline MAE/skill, pooled **counts only**, and `by_target_month` metrics.
- `protocol.json`: provenance, cutoff, matched truth tolerance, selected
  sensor IDs, configured/finished case counts, and baseline definitions.
- `cases.partial.jsonl`: each completed case appended as the run progresses.

The dashboard is under **Building Overview → Room assistant → One-month
backtest accuracy**. It labels partial runs, shows valid/planned counts and
baselines, and continues to use an accuracy *index* rather than claiming
classification accuracy.

## Methodology and interpretation

For each origin, only good-quality normal synthetic records timestamped at
or before that origin reach the production prediction function. Future target
values are read **after** the LLM call, separately. Rolling mode permits earlier
2025 observations for later forecasts, but never the target or a later value.
Strict mode with `--origin-from 2024-12 --origin-to 2024-12` keeps the
entire input before 2025 and evaluates only January 2025 targets.

Three baselines are calculated from the **same pre-cutoff history**:

1. **Persistence**: the latest observed value at the origin.
2. **Recent mean**: the mean of available readings during the seven days
   preceding the origin.
3. **Seasonal naïve**: the latest reading available before the origin with the
   same weekday and clock time (±30 minutes) as the target.

Per-sensor metrics include MAE, RMSE, median absolute error, p90 absolute
error, signed bias, WAPE, an index `max(0, 100 − WAPE%)`, and skill
`100 × (1 − LLM_MAE/baseline_MAE)`. **Skills compare the LLM and each
baseline on identical valid origins**; baseline MAE of zero yields no defined
skill. The generated low/high scenarios are **not calibrated intervals**.
Errors from °C, %RH and ppm must **not** be averaged as raw units across
sensors. The report pools only valid-case and coverage counts.

The model is not trained or tuned by this script. Do not change prompts based
on the test-year outcome and then present the same year as an untouched
holdout; use a separate development year for prompt/model selection. Compare
the current Qwen-only method against the baselines before adding a different
trained forecasting system.

## Automated checks (no Ollama necessary)

```bash
python3 -m unittest discover -s tests -p 'test_evaluate_llm_one_month.py' -v
python3 -m unittest discover -s tests -p 'test_room_prediction.py' -v
node --test tests/oneMonthEvaluationEndpoint.test.mjs tests/oneMonthEvaluationUI.test.mjs
npm run build
```

These tests exercise contract logic with mocked output; they do not prove
real-world accuracy. The historical SQLite and a working local Ollama instance
are required to generate the actual multi-case performance report.
