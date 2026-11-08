# Where testing results are saved

For any `--run-id RUN_NAME`, files are saved locally under:

`llm_testing/outputs/model_selection/RUN_NAME/`

| File | What it records |
|---|---|
| `predictions_<model>.jsonl` | Every case response, model decision, evidence checksum, tool trace, latency, exception |
| `experiment_configuration.json` | Identical frozen selected cases, model list, prompt, seed and evidence hashes |
| `anomaly_model_comparison.csv` | Overall per-model metrics (Accuracy, Recall, F1, Coverage, tool errors, latency) |
| `case_results.csv` | One row per model & case with Ground Truth, prediction, TP/TN/FP/FN/INVALID |
| `errors.csv` | All invalid responses and tool errors, categorised by OOM, timeout, JSON etc. |
| `model_selection_report.md` | Summary for reading and subsequent academic interpretation |

Every case is appended and flushed immediately into its model's JSONL. Summary reports
are generated only after the requested model(s) finish and scoring runs. A crash may
leave partial JSONL files, with no CSV reports. Avoid reusing the same Run ID; there is
no automatic resume.

Ground Truth is **not** used by the inference tools, and is only attached to case_results.csv
when the scoring stage begins, after all inference has been saved. These output files
are excluded from Git, and must not be committed to a public/private repository without
review of data sharing permissions.

## Example

From `llm_testing`:

```powershell
git pull origin experiment/digital-twin-llm-testing
python anomaly_model_selection.py --run-id anomaly_4models_100_v2 --limit 100 --models qwen3:1.7b qwen3:4b llama3.2:3b gemma4:e4b
Import-Csv outputs/model_selection/anomaly_4models_100_v2/anomaly_model_comparison.csv | Format-Table -AutoSize
Import-Csv outputs/model_selection/anomaly_4models_100_v2/errors.csv | Format-Table model,case_id,category,error -AutoSize
```

To generate the new reports for an already-completed run created by the earlier code,
use `--score-only` with its **exact** prior model list, limit, seed and run ID.
No inference is repeated. Do not accidentally reuse final-test scores for iterative tuning.
