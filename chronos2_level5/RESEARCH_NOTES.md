# Research protocol and interpretation

## Objective and scope

Project: **Asset Intelligence: Transitioning Physical Entities to AI-Driven Digital Twins**.

Evaluate the pretrained, frozen Amazon Chronos-2 model as a zero-shot multivariate forecaster for all 11 Level 5 numerical channels. Compare its p50 forecasts against last-value persistence, then against the teammate's TFT under the exported common protocol. No local Chronos training, fine-tuning, anomaly classification, website or presentation is part of this experiment.

The original HRU507 three-target study has a different dataset and protocol. Its original script, documentation, notebook and results are preserved. Do not pool its scores with Level 5 scores or transfer its hybrid-data provenance without evidence.

## Dataset identity and audit

Use the three supplied partitions directly, with no new split:

| Partition | Global rows [start,end) | Time range | SHA256 |
|---|---|---|---|
| train | [0,367878) | 2018-01-01 01:00 to 2018-09-13 12:17 | ed258fb7540d3b238ed4e07af2e4fbffe3da330dd05f7d5b9bb97451d198ef0b |
| validation | [367878,446709) | 2018-09-13 12:18 to 2018-11-07 06:08 | 37602a9e2b6aa7aaff3ef39e7d3e66aa104f74c83700a3cc2a9223d4592667f9 |
| final test | [446709,525540) | 2018-11-07 06:09 to 2018-12-31 23:59 | 24d15ea360348691a6543e7cf03046221312f493284dc1f8cab52aa905d50678 |

The concatenated timeline contains 525,540 rows and 525,539 one-minute intervals. Timestamps have no declared timezone. No missing values, duplicate timestamps or repeated full rows were observed. The audit is strict: it reports and rejects invalid sensor values and timeline discontinuities rather than silently cleaning data. Extra columns are excluded from model input regardless of numerical type.

Implemented physical checks are humidity [0,100], fan {0,1}, and nonnegative airflow, pressure and CO2. Temperatures are audited numerically, with no unsupported equipment-specific bounds. Observed DP-504 ranges from 0 to 100; the CSV does not establish whether the units are Pa or a transformed measure. Airflow units are also unverified. Temperature as degrees Celsius, humidity as %RH and CO2 as ppm are assumptions from names/ranges, marked as inferred in the schema.

Airflow/DP nonnegativity is an explicit screening assumption that these channels encode magnitudes. Differential pressure can be signed under other measurement conventions; without the source dictionary, exported DP range-violation counts are assumption-based diagnostics, not independently confirmed physical impossibilities.

All rows declare source_mode=lbnl_fault_free, scenario=normal and is_anomaly=0. These declarations do not prove raw measured provenance, generation rules, sensor calibration or real deployment performance. occupancy_507 has four observed values and is excluded. The old HRU507 CSV's known simulation labels are not sufficient evidence to classify these different channels.

## Frozen model and input/output

Official package: chronos-forecasting 2.3.2; model: amazon/chronos-2, revision 29ec3766d36d6f73f0696f85560a422f50e8498c. The cached model has 119,477,664 parameters. Weight SHA256: ddcda3c7508bf2528087723e98a20707cc04b7f370ae275a9fd88078ddba4f42.

The loader enforces CPU placement, float32, evaluation mode and requires_grad=False on all parameters. Inference uses torch.inference_mode(). No fit, optimizer, backpropagation, model selection on test or weight update is performed. The context length is fixed at 60 for the common comparison, rather than selected from the old study's 60/180 candidates. Random seed is 42; deterministic PyTorch algorithms are enabled.

Input is [B,11,60], in exported sensor order. Each task groups the 11 channels, with cross_learning=False across origin tasks. The CLI batch size counts tasks; the official API budget counts variates, so one task uses an internal budget of 11. The installed official dataset adapter is tested to verify identical within-task group IDs, different between-task group IDs, no future targets and all-NaN internal future covariates.

The official predict_quantiles API returns a list of [11,15,3] tensors for requested quantiles [0.1,0.5,0.9], plus a list of [11,15] point outputs. The installed source returns median in the slot historically named mean. The program checks equality to p50 and uses that p50 explicitly. It rejects wrong task counts, wrong dimensions, nonfinite forecasts, crossed quantiles or a point output that is not p50.

## Origin definition and leakage safeguards

Let t be the final observed row. Context is t-59..t; targets are t+1..t+15. Eligible origins for supplied segment [a,b) are max(59,a-1)..b-16, inclusive. Select unique integer linspace indices over that interval. All forward targets remain within their evaluation partition.

The first validation context may use train history, and the first test context may use validation history. At later origins, already observed earlier test readings are valid history under rolling evaluation. This is neither teacher forcing with future targets nor a single long open-loop forecast.

Only the sensor history array crosses the inference boundary. Metadata, labels and future sensor values never enter model inputs. A mutation test changes every row after an origin and confirms identical input and output. Training statistics are independently checked by mutating all later partitions. Origin boundaries, sensor order and grouping are also tested.

32 validation and 64 test origins form the verified initial sample. For denser final reporting, increase both counts in a fresh output folder and provide the new common origin file to TFT. The first/last indices remain deterministic; samples for different counts are not necessarily nested. Counts cannot exceed the number of eligible origins.

## Metrics

Persistence predicts x(t+h)=x(t) for every sensor and h. Evaluate all exact horizons 1..15; the primary comparison is at 5, 10 and 15. Per-sensor MAE=mean(abs(predicted-actual)); RMSE=sqrt(mean(error squared)). A separate sensor summary pools all 15 forecast steps per sensor. This pooling is not used to conceal exact-horizon results.

Training-only scale s_j is the population standard deviation (ddof=0) of sensor j in the supplied train file. Macro normalized MAE is mean_j(MAE_j/s_j). Macro normalized RMSE is mean_j(RMSE_j/s_j), **not** the square root of a pooled multi-sensor squared error. Every included sensor receives equal weight, including fan status. Raw physical-unit errors are never averaged across sensors.

If s_j <= 1e-8, normalized scores are unavailable and that sensor is excluded from the normalized macro only; raw errors remain. A sensor is marked near-constant in train if std <= 0.001*max(1,abs(train_mean)). This descriptive threshold is fixed, uses train only and does not remove a channel from inference. Exact constant contexts and unchanged targets are counted separately.

MAE skill is 1-MAE_model/MAE_persistence; RMSE skill is analogous. Aggregate skill uses the ratio of aggregate normalized errors, not an average of per-sensor skill. A zero persistence denominator produces an unavailable score.

Empirical interval coverage is mean(p10<=actual<=p90). Width is mean(p90-p10) in each sensor's unit; normalized interval widths can be macro-averaged. p10-p90 is nominally 80%; observed coverage is a diagnostic, not a calibration guarantee. Persistence quantiles and interval metrics are intentionally unavailable.

Fan status is retained as a numerical forecasting channel. Its raw p50 contributes to regression metrics; for an additional status interpretation, classify p50>=0.5 and export TP/TN/FP/FN, accuracy, precision, recall and F1. p50 is not a Bernoulli probability. No clipping or claim of probabilistic classification calibration is made.

## Transition-event diagnostic

For each sensor and exact horizon h, calculate the 98th percentile of |x(t+h)-x(t)| using pairs entirely inside train. At shared validation/test origins, label an event if the observed absolute change exceeds max(training_threshold_h,1e-8). The strict inequality prevents unchanged sensors from becoming events when the training threshold is zero.

Event labels use future observations **only for post-hoc scoring**, never model inputs, origin sampling or tuning. Diagnostics use the same primary origins; there is no separate outcome-selected model run. Export every sensor/horizon/split combination, including n_event_origins=0 with unavailable scores. Report event support and avoid significance claims from tiny subsets. This is a transition forecast study, not anomaly detection.

## Measured findings from the completed first run

The full run completed on CPU with 32 validation and 64 test origins. The reported run timer was 40.355 seconds including audit, baseline, model loading, inference, scoring and plots. It excludes interpreter startup and post-run independent verification. Validation inference took 4.148 seconds; test inference took 8.155 seconds. Peak sampled process RSS was 1,040,494,592 bytes; process CPU time was 75.75 seconds. Resource sampling is every 0.2 seconds and can miss instantaneous peaks. Low minimum system available RAM (63,979,520 bytes) means the OS was under memory pressure; successful completion is not a general memory guarantee.

| Exact test horizon | Chronos normalized MAE | Persistence normalized MAE | MAE skill | Macro interval coverage |
|---:|---:|---:|---:|---:|
| 5 min | 0.021615 | 0.024131 | 10.43% | 80.26% |
| 10 min | 0.034919 | 0.039444 | 11.47% | 80.26% |
| 15 min | 0.050274 | 0.055949 | 10.14% | 78.98% |

At these three horizons, Chronos improved MAE on 9 of 11 sensors, while fan-status regression and DP-504 were worse. CO2 MAE at 15 minutes was 5.586389 inferred ppm versus persistence 8.1640625, a 31.57% improvement; its interval coverage was only 60.94%. The macro coverage can therefore conceal weak coverage for a particular channel.

Fan binary accuracy was 63/64=98.4375% at all three primary horizons, **equal to persistence**. Of 64 test histories, 59 had completely constant fan readings across the entire 60-minute context. One observed switching case was missed; this is insufficient evidence for reliable transition anticipation. Airflow/DP each had 28 constant test contexts. No sensor was globally constant or near-constant under the training rule.

At the 15-minute horizon, DP-504 had zero labelled events among sampled test origins. Other sensor event subsets contained only 1 or 2 origins. Those results are exploratory and cannot support broad claims of transition performance.

Raw p50s sometimes violate physical ranges. In the test paths, airflow minimums were approximately -0.0740, -0.0663 and -0.0617 native units; DP-504 minimum was -0.1782 and maximum 104.1151; fan ranged from -0.01576 to 1.04115. Many additional negative values on zero contexts are around floating-point scale. The predictions remain unmodified and violations are exported. There is no declared upper DP physical bound, so 104.1151 is outside the observed training maximum, not an independently established physical impossibility.

## Fair TFT comparison and scientific limits

Use the exact hashes, order, context, forward labels and shared origin CSV. TFT fits train only and tunes validation only. Do not retrospectively select a Chronos sample or change context to improve test scores. If a larger sample is needed, predeclare the sample size and use it for both models. Any repeated test inspection should be disclosed.

The primary study measures forecasting performance on the supplied normal-condition dataset. It does not establish anomaly-detection sensitivity, specificity or fault diagnosis; anomalous examples and an independently defined detection rule are absent. Generalization to calibrated real building sensors, other buildings, or future operating regimes requires additional evidence. Sparse deterministic origins do not provide independent random sampling or uncertainty estimates. No causal relation between sensors is established.

## Primary sources checked for implementation

- Amazon Science, [Chronos repository](https://github.com/amazon-science/chronos-forecasting).
- Amazon Science, [Chronos-2 pipeline source](https://github.com/amazon-science/chronos-forecasting/blob/main/src/chronos/chronos2/pipeline.py); installed 2.3.2 source was also inspected directly for input shapes, batch semantics and median output.
- Amazon Science, [official model card](https://huggingface.co/amazon/chronos-2).
- Ansari et al. (2025), [Chronos-2: From Univariate to Universal Forecasting](https://arxiv.org/abs/2510.15821).

Upstream benchmark claims are not treated as evidence for this dataset. Local findings above come only from exported real pretrained outputs.

