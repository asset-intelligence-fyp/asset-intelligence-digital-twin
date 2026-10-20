# Chronos-2 Level 5 completion report

Completed 21 October 2026 (Asia/Kuala_Lumpur). The agreed initial **32-validation / 64-test origin experiment ran successfully with the real pretrained model on CPU, jointly forecasting all 11 channels**. All required research outputs are present. There was no training, fine-tuning, source-dataset modification, GitHub push or new data split.

## Execution and checks

| Check | Actual result |
|---|---|
| Safe backup | Original code/docs/requirements/test saved before edits in backups/pre_level5_20261021; root folder is not a Git repository |
| Environment | PowerShell 7.6.5, Windows build 26200, Python 3.11.9 |
| Dependencies | Existing torch 2.14.1+cpu, chronos-forecasting 2.3.2; pip check: no broken requirements |
| Syntax | py_compile passed for main.py, legacy_hru507.py, verify_results.py and both test files |
| Pytest | **27 passed in 20.49 seconds**, including four original HRU507 tests and the installed official adapter grouping test |
| Data audit | 525,540 rows in existing 367,878 / 78,831 / 78,831 partitions; no missing values, duplicate rows/timestamps or time gaps |
| Real-data baseline | 32 validation and 64 test origins; standalone baseline finished in 9.98 seconds |
| Real-model smoke | One validation and one test origin, all 11 targets; completed in 27.02 seconds |
| Full real-model run | 32 validation and 64 test origins, all 11 targets; completed in 40.36 seconds |
| Independent verification | Passed: source/output hashes, dataset identities, real labels, scales, origins, shapes, per-horizon metrics, intervals, fan interpretation, event counts and 12 nonblank plot images |
| Smoke reproducibility | First test origin p50s match the full run exactly (maximum absolute difference 0.0) |
| Baseline comparability | Standalone baseline and full run exported identical shared origins |
| Preservation | All **21** protected original dataset/output/notebook hashes unchanged; original script preserved byte-for-byte in legacy_hru507.py |

Offline/mock tests validate logic only. They are distinct from the successful real pretrained smoke and full inference runs.

## Model and resources

Official model amazon/chronos-2, revision **29ec3766d36d6f73f0696f85560a422f50e8498c**; 119,477,664 frozen parameters. Weight SHA256: ddcda3c7508bf2528087723e98a20707cc04b7f370ae275a9fd88078ddba4f42.

The existing Hugging Face weight cache was reused; no installation, model download or dataset duplication was required. About 28.6 GB disk was available at the first check. About 20.33 GB was free at the end of the full run; disk space is system-wide and can change independently of the experiment. All new outputs including audit, baseline and smoke runs total about **17.15 MB**.

Full run measured resources:

- Wall time: **40.3553 s**, including audit, persistence baseline, model loading, inference, scoring, CSV export and plotting; interpreter startup and independent post-run verification excluded.
- Model loading: **11.3467 s**.
- Validation inference: **4.1479 s** for 32 tasks.
- Test inference: **8.1546 s** for 64 tasks.
- Process CPU time: **75.75 s**; average utilization **187.71% of one core**, approximately 1.88 CPU cores averaged over the measured run.
- Peak sampled process RSS: **1,040,494,592 bytes = 1.040 GB (0.969 GiB)**.
- Minimum sampled system available RAM: **63,979,520 bytes**; the machine was under substantial memory pressure.
- CPU inference only, float32, batch size **1 complete 11-channel task**, 4 intra-op threads and one inter-op thread. No dedicated GPU required.

RSS/system memory are sampled every 0.2 seconds; instantaneous peaks may be missed. Resource results describe this execution, not a universal memory or timing guarantee.

## Measured forecasting results

Primary exact-horizon test comparison uses equal-sensor training-standard-deviation-normalized MAE. This avoids averaging incompatible raw units.

| Horizon | Chronos normalized MAE | Persistence normalized MAE | MAE improvement | Macro p10-p90 coverage |
|---:|---:|---:|---:|---:|
| 5 minutes | 0.021615 | 0.024131 | **10.43%** | 80.26% |
| 10 minutes | 0.034919 | 0.039444 | **11.47%** | 80.26% |
| 15 minutes | 0.050274 | 0.055949 | **10.14%** | 78.98% |

15-minute per-sensor test results are below. Temperature, humidity and CO2 unit labels are inferred; airflow and DP units are unverified native values.

| Sensor | MAE | RMSE | MAE skill vs persistence | Coverage |
|---|---:|---:|---:|---:|
| SAT-501A | 0.219669 | 1.168556 | 14.01% | 75.00% |
| AF-501A | 0.154737 | 0.779976 | 11.50% | 89.06% |
| FS-501A | 0.016551 | 0.125096 | -5.92% | 98.44% |
| SAT-504 | 0.237859 | 1.166637 | 8.41% | 75.00% |
| AF-504 | 0.145845 | 0.737075 | 10.59% | 89.06% |
| DP-504 | 0.276931 | 1.333679 | -11.68% | 84.38% |
| SAT-507 | 0.235038 | 1.144824 | 8.72% | 81.25% |
| AF-507 | 0.138538 | 0.695802 | 9.99% | 85.94% |
| S-L5-008-TEMP | 0.030672 | 0.057879 | 13.90% | 64.06% |
| S-L5-008-HUM | 0.133522 | 0.166495 | 2.67% | 65.63% |
| S-L5-008-CO2 | 5.586389 | 7.773875 | 31.57% | 60.94% |

Chronos improves MAE on 9/11 sensors at each primary horizon. Fan-status regression and DP-504 are worse than persistence. Binary fan accuracy is 63/64 (98.4375%) at 5/10/15 minutes, **equal to persistence**; both miss one positive status. This does not establish transition-detection performance.

Constant-context behavior is material: 59/64 test contexts have constant fan status, and 28/64 contexts are constant for each airflow channel and DP-504. All 11 sensors remain in every forecasting task. No channel is globally constant or near-constant under the recorded train-only rule.

At 15 minutes, most event subsets contain only one or two origins, and DP-504 has zero event origins. Empty subsets have explicit zero counts and unavailable errors. Raw forecasts can go outside assumed bounds and are preserved, rather than clipped. Sensor-specific coverage, especially CO2, is substantially below the nominal 80% even when aggregate coverage looks close.

## Files changed and created

Modified:

- main.py: complete Level 5 CLI, strict audit, fixed supplied partitions, CPU loading, frozen inference, exports and plots.
- tests/test_main.py: new leakage, ordering, shape, origin, metrics, degenerate-scale, audit, CLI and preservation tests.
- requirements.txt: exact CPU PyTorch/core API versions; no mandatory Jupyter packages.
- README.md and RESEARCH_NOTES.md: exact commands, schemas, methodology, results, provenance and limitations.
- .gitignore: excludes source datasets, generated outputs, caches and backups.

Created:

- legacy_hru507.py: original implementation, byte-for-byte.
- tests/test_legacy_hru507.py: original four tests redirected to the preserved legacy module.
- pytest.ini: scopes discovery to the intended tests directory, avoiding nested project/backups.
- verify_results.py: independent output verification script.
- COMPLETION_REPORT.md: this report.
- backups/pre_level5_20261021/: original files and preservation manifest.
- outputs_level5/: the complete primary results, plus separately labelled audit/baseline/smoke subfolders.

Required primary artifacts are all present inside outputs_level5:

- dataset_audit.json, sensor_schema.json, shared_experiment_config.json, evaluation_origins.csv.
- chronos2_validation_metrics.csv and chronos2_test_metrics.csv: **165 rows each** (11 sensors x 15 exact horizons).
- chronos2_test_forecast_paths.csv: **10,560 real forecast rows** (64 x 11 x 15).
- chronos2_validation_forecast_paths.csv: **5,280 real forecast rows** (32 x 11 x 15).
- chronos2_event_metrics.csv: **330 rows**, including empty event subsets.
- chronos2_experiment_metadata.json: real model revision/weight hash, source/result hashes, packages, CPU/RAM and stage times.
- Baseline forecast paths/metrics; per-sensor summaries; normalized aggregates; fan interpretation; sensor-behavior diagnostics.
- plots/: **12 PNGs**, including all-11-sensor actual/predicted panels and horizon comparisons.
- verification_report.json: independent check results.

## Commands and remaining limits

The complete PowerShell commands actually used, fresh-output rerun syntax, optional larger-sample syntax and Linux equivalents are in **README.md**. To inspect the existing completed run without repeating inference:

```powershell
.\.venv\Scripts\python.exe -X utf8 verify_results.py --output outputs_level5
```

For an identical fresh rerun:

```powershell
.\.venv\Scripts\python.exe -X utf8 main.py --device cpu --batch-size 1 --validation-origins 32 --test-origins 64 --output outputs_level5_recheck
```

No mandatory execution steps remain blocked. The agreed first run is complete. Linux syntax is documented but was not executed on this Windows host. Larger evaluation counts are supported but were not run. Sensor unit/provenance confirmation still requires the teammate's source documentation. These normal-only, sparsely sampled forecasting results cannot establish anomaly-detection accuracy or real-building deployment generalization.

For TFT comparison, reuse outputs_level5/shared_experiment_config.json, sensor_schema.json and evaluation_origins.csv with the exact source CSV hashes and definitions. Treat this as the verified initial sample, not an exhaustive final statistical study.

