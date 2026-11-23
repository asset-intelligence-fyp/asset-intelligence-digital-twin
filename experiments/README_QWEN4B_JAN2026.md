# Qwen3 4B — historical-data to one-month forecasting

## Scope and time split

This experiment is independent of the TwinLabs website and the group's anomaly detection.

The version-4 Malaysian Digital Twin research dataset contains 60 counterfactual synthetic cases. Each case has:
- Historical evidence: 90 days, 3 October–31 December 2025.
- Test period: 31 days, 1–31 January 2026.
- Future calendar and climate normals that would have been known in advance.
- Actual January conditions kept in a separate HIDDEN file and read only by the scorer.

This is **in-context forecasting**, NOT training/fine-tuning. Qwen3's pretrained weights are not updated. The older 90 days are summarized as historical evidence in its prompt.

The targets are monthly averages of four daily readings: daily peak temperature (°C), daily mean humidity (%RH), daily peak CO2 (ppm), and daily electricity use (kWh/day). This is a one-month **aggregate forecast**, not a five-minute prediction for a single timestamp and not a full series of 31 daily forecasts.

Qwen's prompt includes 13 weekly historical summaries, the last seven daily observations, 31- and 90-day historical means, observed occupancy/AC/rain, and future planning calendar plus climatology. The model never sees future actual readings, headcount, AC operation, or fault labels.

## Set up without changing your working TwinLabs website

Because the original research dataset branch is large, create a SPARSE WORKTREE in a parallel folder. From the terminal currently inside your TwinLabs Git repository:

~~~bash
git fetch origin
git worktree add --no-checkout ../TwinLabs-Forecast -b qwen4b-forecast origin/experiment/qwen4b-january-forecast-20261123
cd ../TwinLabs-Forecast
git sparse-checkout init --no-cone
git sparse-checkout set \
  '/experiments/' \
  '/malaysian_digital_twin_llm_dataset_v4/generated/llm_reference_visible/forecast_cases_history_VISIBLE.csv' \
  '/malaysian_digital_twin_llm_dataset_v4/generated/llm_reference_visible/forecast_cases_future_known_VISIBLE.csv' \
  '/malaysian_digital_twin_llm_dataset_v4/generated/llm_reference_hidden/forecast_cases_future_HIDDEN.csv'
git checkout HEAD
~~~

Only the relevant three research CSV files (each less than 1 MB) and experiment scripts are checked out. Your TwinLabs website branch stays untouched.

## Step 1 — Prepare and score naive historical baselines (no Ollama)

~~~bash
python3 experiments/qwen4b_one_month_backtest.py prepare
python3 experiments/qwen4b_one_month_backtest.py baselines
~~~

The script prepares 60 frozen, time-safe prompt cases and produces a real baseline report.

## Step 2 — Run actual Qwen3 4B locally

Start Ollama if needed, in another Terminal:

~~~bash
ollama serve
~~~

If the Ollama app is already serving, do not launch a second server. In the forecast Terminal:

~~~bash
ollama pull qwen3:4b
python3 experiments/qwen4b_one_month_backtest.py run --model qwen3:4b --limit-cases 3
python3 experiments/qwen4b_one_month_backtest.py score --model qwen3:4b
~~~

This is a 3-case SMOKE TEST, not reliable model accuracy. If it works, extend to the remaining cases without losing or duplicating your initial results:

~~~bash
python3 experiments/qwen4b_one_month_backtest.py run --model qwen3:4b --limit-cases 0 --resume
python3 experiments/qwen4b_one_month_backtest.py score --model qwen3:4b
~~~

To compare the smaller 1.7B model on the same frozen cases:

~~~bash
ollama pull qwen3:1.7b
python3 experiments/qwen4b_one_month_backtest.py run --model qwen3:1.7b --limit-cases 0
python3 experiments/qwen4b_one_month_backtest.py score --model qwen3:1.7b
~~~

The models' result files are separate. The script uses structured Qwen JSON output, temperature 0, 4096 context and a local Ollama endpoint.

## Results

Saved in experiments/outputs/jan2026:
- manifest.json — 60 cases, input hashes, causal split.
- requests.jsonl — historical-only prompt requests, no future true values.
- summary_baseline.json — baseline MAE, RMSE and WAPE on all 60 cases.
- predictions_qwen3_4b.jsonl / predictions_qwen3_1_7b.jsonl — REAL Ollama responses and latency.
- summary_qwen3_4b.json / summary_qwen3_1_7b.json — evaluation and relative skill.
- scores_qwen3_4b.csv / scores_qwen3_1_7b.csv — actual versus predicted, per case.

### Already computed baseline results

These are **not Qwen results**. They were computed directly from the 60 dataset cases using only historical values as predictors, then scored on the January future.

| Metric | Last-31-days MAE | Last-90-days MAE | Weekday-matched MAE |
|---|---:|---:|---:|
| Temperature | 0.132 °C | 0.213 °C | 0.213 °C |
| Humidity | 0.877 %RH | 1.368 %RH | 1.381 %RH |
| CO2 | 28.970 ppm | 38.942 ppm | 38.866 ppm |
| Energy | 1.117 kWh | 0.822 kWh | 0.777 kWh |

Qwen3 4B needs to improve on these simple predictors for genuine numerical forecasting benefit.

## How to interpret results

The summary reports MAE, RMSE, WAPE, signed bias, valid predictions and skill versus the last-31-day historical mean. Results are only comparable on the **same test cases**. No averaging of raw errors across °C, %RH, ppm and kWh.

The 60 cases represent alternative synthetic scenarios, not 60 independent buildings, and share the same month. Do not generalize the results to measured buildings. The prediction target is a January MONTHLY MEAN of DAILY metrics; it is distinct from the current website's one-month-ahead single-value forecast. Future work can evaluate a 31-day daily sequence, longer historical context and rolling-origin splits.

## Offline CI

GitHub Actions verifies Python syntax, chronological no-leakage data preparation, real baseline calculations and the model-output scoring contract **without pretending to run Qwen3 4B**. The actual 4B metrics only exist after local Ollama inference.

Run offline tests yourself with:

~~~bash
python3 -m unittest discover -s experiments -p 'test_qwen4b_one_month_backtest.py' -v
~~~
