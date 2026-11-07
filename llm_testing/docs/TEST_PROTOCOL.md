# Test protocol

## Isolation
- Inference takes only the input-only Dataset v4 and an `as_of` cutoff.
- Evaluation keys never enter the Ollama prompt, examples or retrieval tools.
- A split must group anomalies by **fault event**, not by overlapping sensor reading window.
- Forecast backtests must exclude history after forecast origin (including weeks crossing origin).

## Stage 1: Validate agent
Use six mixed anomaly/normal examples to confirm tool usage, schema validity and semantic sensor units. Three forecast cases validate forecast tool use and numeric output. Smoke results are not a model ranking.

## Stage 2: Four-model comparison
Keep case IDs, evidence, prompt, retrieval, temperature, context policy and scoring fixed. Model feature differences (thinking and tool calling) must be logged. Model comparisons should only include comparable configurations, with unsupported reported separately.

## Stage 3: Ablations
Within each model compare mandatory historical evidence, autonomous tools and hybrid evidence plus tools. Test thinking ON/OFF separately for models supporting it. Avoid accessing final blind labels to tune prompts.

## Metrics
Anomaly: Accuracy, Precision, Recall, F1, specificity, FPR/FNR, coverage, invalid rate, latency and tool errors. Original criterion is **accuracy strictly greater than 85%**, with coverage reported.
Forecast: MAE, RMSE, WAPE per sensor unit, trend/condition macro F1, warning precision/recall, valid output rate and latency. Do not invent weekly numerical ground truth.

## Deployment
Keep local PostgreSQL/SQLite and Ollama local. The GitHub branch stores code, not private datasets or runtime outputs.
