# One-month Qwen3 LLM-only sensor projection and accuracy evaluation

The active TwinLabs website on branch `llm_integration` now offers **+1 month only** for the temperature, humidity and CO₂ sensors. Longer horizons are rejected at the Express API and Python forecasting function. The existing `/api/assistant/ask` validated room analysis, chat history and resizable panel remain unchanged.

## How the projection works

`POST /api/assistant/predict` sends one canonical sensor, a timezone-aware cutoff, live connected HTTP readings and `horizon_months:1`. The Python bridge prepares pre-cutoff monthly trends from normal synthetic history; **Qwen3 1.7B alone supplies the projected value and low/high scenarios**. Output checks validate the structured response and plausible sensor bounds, not the accuracy of the future value. No forecasting model is trained. Requires a recent valid HTTP reading plus at least 14 distinct historical dates in a month (normal SQLite or long-term HTTP data).

## Evaluate against 2025 ground truth on your Mac

1. Update the branch and start/enable Ollama:

   ```bash
   git switch llm_integration
   git pull --ff-only origin llm_integration
   ollama pull qwen3:1.7b
   # Open Ollama.app or start ollama serve
   export LLM_HISTORY_DB="$PWD/storage/digital_twin.sqlite"
   ```

   Point `LLM_HISTORY_DB` at the existing full 2023–2025 synthetic normal SQLite file if it is in another directory. **Do not commit the historical database.**

2. Run a short smoke test **against the real LLM**:

   ```bash
   python3 scripts/evaluate_llm_one_month.py \
     --db "$LLM_HISTORY_DB" \
     --sensors CO2-L03-MEET-01 \
     --limit-cases 1
   ```

3. Run the full **one-month, 2025 rolling-origin backtest** for all three meeting-room sensors. The default uses origins on the 15th at 14:00, beginning in Dec 2024 and ending in Nov 2025, whose +1 calendar-month targets are in Jan–Dec 2025:

   ```bash
   python3 scripts/evaluate_llm_one_month.py \
     --db "$LLM_HISTORY_DB" \
     --sensors TEMP-L03-MEET-01,RH-L03-MEET-01,CO2-L03-MEET-01 \
     --target-year 2025 \
     --origin-from 2024-12 --origin-to 2025-11 \
     --origin-days 1,8,15,22 --origin-hours 14 \
     --mode rolling
   ```

   This runs **up to 48 cases per sensor**, requiring up to 144 real Qwen responses. Each origin sees only readings dated at or before that origin. Earlier 2025 records may legitimately enter later 2025 predictions, but **future target readings never enter the LLM input**. All records are synthetic normal data; this does not demonstrate accuracy with physical building sensors. For a stricter, narrower test with no 2025 inputs at all, use `--mode strict --origin-from 2024-12 --origin-to 2024-12`.

4. Read the results in `reports/llm_one_month_eval/`:

   - `summary.json`: Sensor-level MAE, RMSE, bias, WAPE, defined accuracy score, skill versus persistence, successful-prediction rate and uncalibrated scenario containment.
   - `cases.csv`: Each cutoff, projected value, later ground-truth reading and error.
   - `protocol.json`: Model, cutoff and data-provenance details.
   - `cases.partial.jsonl`: Progressive case backup, useful if a long run is interrupted.

5. Restart `npm run dev` if required, open **Building Overview → Room assistant → One-month backtest accuracy**, and click **Refresh** to load the score for sensors in the selected room. Before step 3, the website correctly shows **Not evaluated**; it never invents accuracy metrics.

## Accuracy definition and research reporting

The main evaluation measures are **MAE** and **RMSE** (sensor units). We also report:

- **Accuracy score (%)** = `max(0, 100 − WAPE%)`, where `WAPE% = 100 × sum(abs(prediction − actual)) / sum(abs(actual))`. This is a descriptive, unit-normalized *index*, **not classification accuracy**, and should never be used alone. Lower MAE/RMSE is better.
- **Persistence comparison**: a no-training baseline predicts the last reading observed at the cutoff. Skill (%) = `100 × (1 − MAE_Qwen / MAE_persistence)` on identical valid cases. Positive is better, negative means Qwen is worse than persistence.
- **Prediction success rate (%)** = the percentage of cases with available ground truth that produced a valid numerical Qwen projection. Missing output is not silently excluded from reporting.
- **Bias** = mean(prediction − ground truth). The LLM's low/high scenario ranges are **not** calibrated confidence intervals.

For the FYP, **do not quote measured numerical accuracy until you run the real Qwen experiment**. Prompt/model tuning after observing 2025 results would compromise treating 2025 as an untouched holdout. The `--mode rolling` option is legitimate prequential/rolling-origin evaluation, rather than a permanently frozen 2023–2024 context.

## Automated checks (without Ollama)

```bash
node --test tests/roomPrediction.test.mjs tests/roomAssistantUX.test.mjs \
  tests/oneMonthEvaluationEndpoint.test.mjs tests/oneMonthEvaluationUI.test.mjs
python3 -m unittest discover -s tests -p 'test_room_prediction.py' -v
python3 -m unittest discover -s tests -p 'test_evaluate_llm_one_month.py' -v
npm run build
```

These automated unit and smoke tests use mocked LLM outputs; they do not constitute a real measured accuracy score.
