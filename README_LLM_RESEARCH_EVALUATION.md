# FYP: Qwen3 one-month forecasting + blind anomaly evaluation

This evaluation is for the `llm_integration` branch. It uses the **existing**
production Qwen3 1.7B predictor and `llm_service.validated_room.analyse_validated`.
It does **not** train a model, change model behavior or introduce other forecasting
horizons. The scripts require Python 3.9+; the anomaly runner uses Python standard
library plus the repo's existing Ollama client.

## A. One-month point forecasting

This feature already has a rolling-origin, seven-sensor evaluation with unit-wise
MAE, RMSE, WAPE, baseline skills and failure counts. See
`README_ONE_MONTH_EVALUATION.md`. Run on the Mac with the normal SQLite history:

```bash
python3 scripts/evaluate_llm_one_month.py --db storage/digital_twin.sqlite --resume
```

## B. Blind anomaly detection

Generate a **new directory** containing fault-injected readings and separate labels
from the built-in simulator. Use a new random seed for the final held-out test,
**not a seed previously used to tune prompts or rules**. Example short diagnostic
run (increase `--ticks` to capture more diverse event types and days):

```bash
cd tools/level03_simulator
python3 -m simulator.run --fault-mode live --seed 831727 \
  --start-sim-time 2026-10-30T00:00:00+08:00 \
  --ticks 20160 --interval-seconds 0.001 \
  --out-dir outputs/fyp_fault_holdout --quiet
cd ../..
```

Simulator writes `sensor_history.csv` (features only),
`ground_truth_labels.csv` (per-minute injected fault key), and
`ground_truth_events.csv` (event boundaries). If `ground_truth_events.csv`
contains only a header, generate a longer fault run or use `--fault-mode demo`
for an initial smoke test. **Never mix those private labels into model input.**

### 1. Sample blind cases + separate answer key

```bash
python3 scripts/evaluate_llm_anomalies.py prepare \
  --dataset-dir tools/level03_simulator/outputs/fyp_fault_holdout \
  --negatives 100 --positive-per-event 2 --seed 42
```

Creates `reports/llm_anomaly_eval/cases_public.jsonl` with just a case ID,
focus sensor, room and observation timestamp; and
`reports/llm_anomaly_eval/answer_key_PRIVATE.jsonl` with hidden fault flags,
scenarios and event IDs. The latter must **not** be supplied to Qwen. Normal
cases within ±60 minutes of injected events are excluded to reduce recovery
contamination. This is a **balanced diagnostic sample**; its precision does
not approximate deployment prevalence.

If the `run` command says `Blind cases not found`, run step 1 first from the
project root. A previous report cleanup may have deleted the ignored
`reports/llm_anomaly_eval/` directory, including its generated cases.
Re-preparing with the same dataset and seed produces the same case selection.
Do not start inference using the private answer key as a replacement.

### 2. Run actual Qwen3 1.7B, without reading the key

Start Ollama and make sure `qwen3:1.7b` is installed. Use the historical **normal**
SQLite database, already required by the production rule-based analysis.

```bash
ollama pull qwen3:1.7b
python3 scripts/evaluate_llm_anomalies.py run \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --limit 3
```

After checking the three-case smoke test, resume remaining cases:

```bash
python3 scripts/evaluate_llm_anomalies.py run \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --resume
```

`predictions.jsonl` is appended and fsynced after each case. The `run` command
has **no** answer-key argument and rejects case files containing labels. The
inputs contain **only a single focus sensor** and its previous 60 minutes of
readings, so this is a sensor-isolated experiment, *not* the full room-wide
multi-sensor user experience. Historical normal references are obtained from
SQLite with a strict pre-cutoff filter. The source is correctly labeled
`historical_replay`, not falsely represented as an actual HTTP measurement.

### 3. Score using the private key after inference

```bash
python3 scripts/evaluate_llm_anomalies.py score
```

Output: `reports/llm_anomaly_eval/summary.json`. Compare **five distinct
outputs** on identical test cases:

- `llm_raw`: Qwen's unmodified `needs_investigation` boolean (even if later rejected).
- `llm_validated`: Qwen's decision only if schema, numeric claims and narrative agree.
- `historical_rule`: the current backend's historical threshold or binary-leak rule.
- `validated_hybrid`: final `alert` / `no_alert`; review/insufficient/invalid **abstain**.
- `operational_triage`: `alert` or `review_required` means *inspect*, not *confirmed fault*.

The summary includes TP/FP/FN/TN, scored-case accuracy, balanced accuracy,
precision, scored-case recall and F1,
**abstention count**, coverage, recall across *all* positive cases, per-scenario
metrics, sampled-event recall/delay, output validation and inference latency.
`false_alarms_per_1000_scored_normals` is only for sampled controls; do **not**
interpret this as false alarms per sensor-day or operational precision.

Fault-active ground truth means **an intervention was injected**. Early in an
injection or during sensor recovery, the reading need not visibly depart from
normal. Report this limitation. Event delay is only the earliest sampled case
that detected the event, not minute-by-minute detection latency. For defensible
operational false alarms per day, test a separate continuous chronological stream.

## C. Explanation quality and combined summary

```bash
python3 scripts/evaluate_llm_explanations.py template
# Fill reviewer_id and score each dimension 0, 1 or 2, blinded to fault labels.
python3 scripts/evaluate_llm_explanations.py score \
  --reviews reports/llm_anomaly_eval/explanation_review.csv
python3 scripts/build_llm_evaluation_report.py
```

The explanation review rubric rates numerical grounding, causal restraint,
and actionable checks. Two independent raters, with agreement assessment, are
preferable; a single rater is preliminary. Numeric-output validation is not
itself proof that explanations or diagnoses are correct.

The combined `reports/llm_research_evaluation.json` references both distinct
experiments **without averaging errors across different sensor units or
combining forecasting MAE with classification F1**. Missing or partial outputs
are explicitly marked. All generated reports and keys remain local and ignored
by Git. Never commit normal-history SQLite or the private answer key.

## Offline checks

```bash
python3 -m unittest discover -s tests -p 'test_evaluate_llm_anomalies.py' -v
python3 -m unittest discover -s tests -p 'test_llm_evaluation_reports.py' -v
python3 -m unittest discover -s tests -p 'test_evaluate_llm_one_month.py' -v
```

Mock/unit tests validate methodology and data isolation only. **No measured
forecasting or anomaly accuracy is claimed until real Qwen inference is run**.
