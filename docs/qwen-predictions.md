# Qwen classification and forecasting

The building assistant now supports **Evidence**, **Investigate**, **Forecast**, and **Both**. Automatic mode routes obvious prediction questions. Select a prediction sensor and a 5, 15, or 30 simulated-minute horizon. Ordinary building questions retain the existing evidence-selection path. Predictions run through local Ollama `qwen3:1.7b`; Chronos is not called or required.

`POST /api/assistant/building` accepts `task` (`auto`, `evidence`, `anomaly`, `forecast`, `combined`), canonical `point_code`, and `horizon_minutes` (5/15/30) in addition to the existing scope/question/window fields. A predictive request without an unambiguous sensor abstains. The focus must belong to the scope. Prediction modes apply to **one chosen sensor**, not every sensor mentioned in a question. The horizon buttons determine the target time.

## What Qwen does

- **Classification:** Qwen decides whether the current sensor condition needs investigation, using timestamped history and available weather/calendar/operation facts. This is current-condition classification, not prediction of an eventual equipment failure. It may abstain. It supplies evidence IDs, a short hypothesis and human inspection suggestions.
- **Forecast:** Qwen itself estimates a continuous sensor's future value. The backend does not secretly replace this with a trend calculation or Chronos output. Last-value persistence is displayed separately as a comparison. The target timestamp and unit come from the backend.
- **Both:** both outputs refer to the same selected sensor and observation cutoff. Classification is at the cutoff; the numerical estimate is at the future target time.

This is **prompt-based, zero-shot LLM forecasting**, with no project-specific weight training. It may perform poorly. There is no calibrated confidence score or validated prediction interval. Do not claim predictive accuracy before held-out evaluation. Future operating changes cannot be anticipated; forecasts assume current conditions continue. Accelerated simulation changes how quickly fifteen simulated minutes pass on the real clock.

## Checks and abstention

Classification requires a current valid reading and (for continuous sensors) three observations spanning five simulated minutes. Forecasting requires six valid observations spanning fifteen minutes, no gaps exceeding ten minutes, and a valid latest reading within ten minutes of the snapshot cutoff. Binary presence/leak sensors support classification only. At most the last 48 timestamped samples enter the model context, alongside backend summary facts.

Output checks enforce the JSON contract, classification/boolean consistency, existing evidence IDs including the focus's latest reading, finite forecasts within broad plausibility bounds, and no numerical measurements in free-text rationale/actions. These checks **do not independently validate reasoning, forecast error, fault diagnosis or the >=85% target**. Missing history, offline Ollama, and rejected responses yield explicit unavailable results; no fabricated estimate or deterministic forecast fallback is shown. Predictions do not automatically create events, alter simulator controls or operate equipment.

## Evaluate both outputs

Use fresh simulator sessions **not used for prompt development**, including normal operation and independently labelled injected faults. Preserve source CSVs and control schedules. Use separate recording sessions/days/seeds for development and final testing; random adjacent windows from the same run are not independent. Have a teammate review ambiguous labels: an injected change is not necessarily a fault needing investigation. The legacy CSVs currently present in this workspace contain **normal labels only**; they cannot establish anomaly detection accuracy.

The exporter accepts the existing simulator `sensor_history.csv` and `ground_truth_labels.csv` column layouts. It exports continuous-sensor combined cases, with observation histories frozen before the cutoff, a separate private answer key containing fault labels and later readings, and a provenance manifest. It does not export fault names, event IDs or future rows to the model. Future reference readings must be within thirty seconds of the requested horizon. At least one hour separates selected windows for the same sensor, although sensors from one recording can still be correlated. The exporter omits operating context; this is a sensor-history-only benchmark. It does not fully evaluate context-aware website reasoning.

```bash
python3 scripts/prepare_qwen_cases.py \
  --readings tools/level03_simulator/outputs/sensor_history.csv \
  --labels tools/level03_simulator/outputs/ground_truth_labels.csv \
  --out-dir /tmp/qwen-heldout --count 40 --horizon 15

# Keep answer_key_PRIVATE.jsonl private. Start the Ollama application first.
node scripts/evaluate_qwen_predictions.mjs run \
  --cases /tmp/qwen-heldout/public.jsonl --out /tmp/qwen-heldout/predictions.jsonl

# Only the scorer reads the key, after predictions are fixed.
node scripts/evaluate_qwen_predictions.mjs score \
  --results /tmp/qwen-heldout/predictions.jsonl \
  --key /tmp/qwen-heldout/answer_key_PRIVATE.jsonl --out /tmp/qwen-heldout/report.json
```

Inspect the manifest before running: zero positives, too few cases, missing source coverage or ambiguous labels require a better test set. Never use an all-normal accuracy score as proof of anomaly detection. Repeat the study for other horizons using separate output folders. Do not tune prompts on the final cases. Keep private keys outside the repository.

Report **all-case classification accuracy**, TP/TN/FP/FN, abstentions, coverage, and precision/recall/F1 with the documented answered-case denominator. All-case accuracy counts abstentions as unsuccessful. Forecast results use **MAE and RMSE by sensor and horizon**, plus persistence MAE/improvement and completion coverage. Missing/rejected forecasts are counted in coverage, not silently treated as zero error. Do not combine incompatible sensor units or use `100 - MAE` as accuracy. Neither output currently establishes the project's acceptance target.

## Verification performed for this patch

Focused automated tests use mocked model responses to check cutoff isolation, unknown evidence rejection, contradictory classification, numerical bounds, missing data, binary handling, offline abstention and scorer denominators. They verify software behavior, **not Qwen performance**. Production compilation and the existing regression suite are also run. Live Qwen inference is not available in the coding workspace and must be checked on the Mac running Ollama.

```bash
node --test tests/qwenPrediction.test.mjs tests/buildingAssistant.test.mjs
npm test
npm run build
```
