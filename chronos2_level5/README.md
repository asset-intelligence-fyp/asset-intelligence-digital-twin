# Asset Intelligence: Level 5 Chronos-2 experiment

This is a real, completed CPU inference experiment with the frozen official Amazon Chronos-2 model. It forecasts all 11 Level 5 numerical sensor channels jointly, using 60 observed one-minute readings to predict the next 15 minutes. No weights are trained or fine-tuned.

The verified first run used 32 validation and 64 final test origins. Results are in `outputs_level5/`. See `COMPLETION_REPORT.md` for execution evidence and findings, and `RESEARCH_NOTES.md` for the scientific protocol. These are sampled forecasting results; they do not establish anomaly-detection accuracy.

## Preserved experiment

The original main script is preserved byte-for-byte as `legacy_hru507.py`. Original code, documentation, requirements and tests were backed up to `backups/pre_level5_20261021/` before edits. The original CSV, all existing `outputs/` files, original notebook and nested repository were left untouched. The preservation manifest verifies the hashes of 21 original files.

The existing notebook is an archived record of the **three-sensor** study and still imports its historical `main` API; do not execute it against the new Level 5 module. The current experiment requires standalone Python scripts only. The old standalone implementation remains runnable, using a fresh output folder to preserve old results:

```powershell
.\.venv\Scripts\python.exe legacy_hru507.py --device cpu --batch-size 1 --output outputs_hru507_recheck
```

That legacy rerun command is provided for historical use; it was not needed or executed during the Level 5 completion.

## Environment and installation

Executed here: Windows build 26200, PowerShell 7.6.5, Python 3.11.9, CPU-only PyTorch 2.14.1+cpu and chronos-forecasting 2.3.2. This laptop has 16 logical CPU cores and 16.54 GB physical RAM. The experiment used 4 intra-op CPU threads, one inter-op thread and one complete forecasting task per batch.

The existing environment and cached weights were reused: **no dependency installation or model download was necessary**. About 28.6 GB free disk was observed initially. System available memory was very low during execution; use the existing batch size of 1. No CUDA, GPU or Jupyter installation is needed.

### Windows / VS Code PowerShell

Open the project folder in VS Code and select `.venv\Scripts\python.exe` with **Python: Select Interpreter**. These commands use the interpreter explicitly, so PowerShell activation or execution-policy changes are unnecessary.

For a **new environment only**:

```powershell
Get-PSDrive C | Select-Object Name,Free
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

The installation syntax is supplied for reproduction; installation was not performed because the installed packages already met the requirements. The CPU wheel index is also declared in requirements.txt, with the exact CPU build pinned. Core runtime and model API dependencies are pinned; installed versions are recorded in each run's metadata. Transitive libraries and platform floating-point behavior can still differ between machines.

**Commands actually executed successfully here:**

```powershell
.\.venv\Scripts\python.exe -X utf8 main.py --help
.\.venv\Scripts\python.exe -m py_compile main.py legacy_hru507.py verify_results.py tests/test_main.py tests/test_legacy_hru507.py
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -X utf8 main.py --audit-only --output outputs_level5/audit
.\.venv\Scripts\python.exe -X utf8 main.py --baseline-only --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5/baseline
.\.venv\Scripts\python.exe -X utf8 main.py --smoke-test --device cpu --batch-size 1 --output outputs_level5/smoke
.\.venv\Scripts\python.exe -X utf8 main.py --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5
.\.venv\Scripts\python.exe -X utf8 verify_results.py --output outputs_level5
```

Existing result directories deliberately refuse overwrite. Re-running help, compilation, pytest and the verifier is safe. To repeat inference, use a **fresh** directory, for example:

```powershell
.\.venv\Scripts\python.exe -X utf8 main.py --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5_recheck
.\.venv\Scripts\python.exe -X utf8 verify_results.py --output outputs_level5_recheck
```

For larger deterministic research samples:

```powershell
.\.venv\Scripts\python.exe -X utf8 main.py --device cpu --batch-size 1 --validation-origins 128 --test-origins 256 --output outputs_level5_128_256
```

The larger run was not executed. Changing the sample size changes the shared origins; give the TFT teammate the files from that exact run. Counts above the number of eligible origins are capped to all eligible origins, and actual counts are exported and printed.

### Linux Python 3.11 equivalents

The scripts use portable pathlib, NumPy, pandas, psutil and PyTorch APIs. These are Linux Bash equivalents; **Linux execution was not available here and was not tested**. Do not run PowerShell virtual-environment paths in Bash.

```bash
df -h .
python3.11 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python -m pip check
./.venv/bin/python -m py_compile main.py legacy_hru507.py verify_results.py tests/test_main.py tests/test_legacy_hru507.py
./.venv/bin/python -m pytest -q
./.venv/bin/python -X utf8 main.py --help
./.venv/bin/python -X utf8 main.py --audit-only --output outputs_level5_linux/audit
./.venv/bin/python -X utf8 main.py --baseline-only --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5_linux/baseline
./.venv/bin/python -X utf8 main.py --smoke-test --device cpu --batch-size 1 --output outputs_level5_linux/smoke
./.venv/bin/python -X utf8 main.py --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5_linux/full
./.venv/bin/python -X utf8 verify_results.py --output outputs_level5_linux/full
```

First execution on another machine requires internet if the pinned weights are not cached. Existing Hugging Face caches are checked first, then the workspace `.cache/huggingface/` cache. Before downloading, the script requires at least 2 GiB free disk. It downloads only the needed model through the official loader, not datasets or duplicate model copies. Loading errors are recorded in metadata and raised with their original traceback.

## Inputs and forecasting contract

The program reads these files **in their existing order**:

| Supplied file | Rows | Use |
|---|---:|---|
| data/level5_normal_train.csv | 367,878 | Training-only statistics and event thresholds; no Chronos training |
| data/level5_normal_validation.csv | 78,831 | Validation evaluation with fixed context |
| data/level5_normal_live_holdout.csv | 78,831 | Final held-out test evaluation |

Together they span 2018-01-01 01:00 to 2018-12-31 23:59 with consecutive one-minute intervals. The audit found no missing values, duplicate timestamps, duplicate rows or violations of the implemented physical checks. No rows were dropped, filled, interpolated, shuffled or re-split.

Exact target order:

```text
SAT-501A, AF-501A, FS-501A, SAT-504, AF-504, DP-504,
SAT-507, AF-507, S-L5-008-TEMP, S-L5-008-HUM, S-L5-008-CO2
```

`occupancy_507`, `source_mode`, `scenario`, `is_anomaly` and any other non-target columns are excluded. Timestamp is used for indexing and audit, not given as a model covariate.

Origin t is the last observed row. The model sees rows t-59 through t, in shape [batch,11,60], and forecasts t+1 through t+15. Validation/test targets stay entirely within their respective supplied files. The first origin may take its past context entirely from the preceding partition. Later rolling origins can use any observations already available at their timestamp, including earlier test observations.

Official `predict_quantiles` returns one [11,15,3] quantile tensor and one [11,15] median tensor per task. The code verifies task count, dimensions, finite values, ordered quantiles and equality of the point output with requested p50. No future covariates are supplied. `cross_learning=False` separates different origin tasks while preserving the 11-channel group within each task.

The CLI's batch size counts **complete forecasting tasks**. Chronos counts individual variates internally, so the adapter passes 11 times the CLI batch size to the official API. A test exercises the installed official dataset adapter to verify actual group IDs and absent future targets.

Only `--device cpu` is accepted. Default seed is 42. `--smoke-test` always evaluates one validation and one test origin with all 11 channels; its outputs and metadata are explicitly marked as smoke results. Default audit/baseline/smoke folders are children of outputs_level5; the full default run writes at the root. Each directory must otherwise be fresh. `--data-dir` selects an alternative directory containing the same three filenames; `--threads` changes CPU thread count.

## Outputs and TFT handoff

All filenames below are within the run's output directory. The completed primary run is `outputs_level5/`.

| Artifact | Meaning |
|---|---|
| dataset_audit.json | All CSV headers/types, timestamps, intervals, missingness, duplicates, ranges, metadata, plateaus, hashes and provenance limits |
| sensor_schema.json | Fixed sensor order, asset mapping, units, evidence and excluded metadata |
| shared_experiment_config.json | Common task, supplied partitions, train-only scales, thresholds, seed, quantiles and comparison rules |
| evaluation_origins.csv | 96 shared origin IDs with global indices, context boundaries and target timestamps |
| chronos2_validation_metrics.csv / chronos2_test_metrics.csv | 165 rows each: 11 sensors x exact horizons 1..15, including 5/10/15 |
| chronos2_validation_forecast_paths.csv | 5,280 real prediction rows |
| chronos2_test_forecast_paths.csv | 10,560 real prediction rows |
| chronos2_*_sensor_summary.csv | 11 sensor summaries pooling all 15 steps; per-sensor units retained |
| chronos2_*_aggregate_metrics.csv | Dimensionless macro errors, skill, coverage and interval widths for each exact horizon |
| chronos2_event_metrics.csv | 330 diagnostic rows on the shared validation/test origins; empty subsets explicitly reported |
| chronos2_*_binary_fan_metrics.csv | Thresholded fan-status confusion counts and metrics, distinct from anomaly detection |
| chronos2_*_sensor_behavior.csv | Constant contexts, training variability, unchanged targets and raw forecast range violations |
| baseline_* | Matching real-data persistence artifacts with identical schemas; quantiles intentionally blank |
| chronos2_experiment_metadata.json | Completion state, packages, frozen weights/revision/hash, CPU/RAM, timings, source and result hashes |
| verification_report.json | Independent result and preservation checks |
| plots/ | 12 PNG charts: all-11-sensor example paths, per-sensor horizon errors and dimensionless comparisons for both models/splits |

Forecast-path primary key: (split, model, origin_id, sensor, horizon_minutes). Columns also give the origin global index, origin/target timestamps, sensor_index, units, actual, predicted, p10, p50, p90 and persistence. Baseline prediction intervals are unavailable; they are not fabricated.

Per-horizon metric rows use exact lead time, not cumulative windows. MAE and RMSE remain in each sensor's unit. The normalized aggregate is the equal-sensor mean of MAE/training_std or RMSE/training_std at each horizon. Training standard deviation uses ddof=0. Zero training scale produces unavailable normalized scores and an explicit excluded-sensor count. Skill is 1 - model_error/persistence_error; zero persistence error produces an unavailable skill.

Give the TFT teammate the **same** configuration, sensor schema, origin CSV, dataset hashes and scoring definitions. TFT may fit only the train file and tune only validation. It must use the same 60-minute history, all 11 targets and the same target timestamps, without future observed sensors or excluded metadata. Disclose a different point-estimation rule if TFT does not produce p50. Its model capacity and training cost should be reported separately from Chronos inference cost.

## Interpretation limits

Temperature, humidity and CO2 unit labels are inferred from names and numerical values, not confirmed by a supplied unit dictionary. Airflow and pressure are explicitly kept in unverified native units. source_mode=lbnl_fault_free does not independently prove calibrated physical measurements; this Level 5 dataset has no supplied generation script. No provenance from the old hybrid CSV is silently assigned to it.

The 64 test origins are sparse and deterministic, not exhaustive or a confidence interval. Transition subsets contain very few events for some sensors; a high fan accuracy can reflect unchanged statuses. Nominal 80% intervals have unequal empirical coverage across sensors. Raw forecasts can be slightly negative or exceed binary bounds; they are retained and counted, not clipped. No anomalous examples exist in these supplied normal files, so no anomaly accuracy, anomaly recall or false-alarm claim is made.

Primary model references: [official Amazon repository](https://github.com/amazon-science/chronos-forecasting), [official Chronos-2 API source](https://github.com/amazon-science/chronos-forecasting/blob/main/src/chronos/chronos2/pipeline.py), [model card](https://huggingface.co/amazon/chronos-2), [Chronos-2 paper](https://arxiv.org/abs/2510.15821).

