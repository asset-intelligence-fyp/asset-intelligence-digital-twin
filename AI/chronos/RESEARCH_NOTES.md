# Research method, source mapping and limitations

## Research question
Can a pretrained Chronos-2 model forecast **temperature, relative humidity, and CO₂ jointly** from historical signals in the HRU507/S-L5-008 hybrid Digital Twin prototype, and how does it compare to a persistence baseline and a custom-trained Transformer at exact 5, 10 and 15-minute forecast horizons?

## Primary model references (consulted 18 October 2026)

1. Amazon Science / AWS, [chronos-forecasting official repository](https://github.com/amazon-science/chronos-forecasting). Provides `Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map=...)` and a `predict_df` example. Version 2.0+ of `chronos-forecasting` is required.
2. Amazon Science, [official Chronos-2 pipeline source](https://github.com/amazon-science/chronos-forecasting/blob/main/src/chronos/chronos2/pipeline.py). The `predict()` API accepts a `[batch, n_variates, history_length]` tensor, and `predict_quantiles(...)` returns a list of `[n_variates, forecast_steps, n_quantile_levels]` values plus its **median**, which the implementation names `mean`. This notebook uses the median (`p50`).
3. Ansari, A. F. et al., [*Chronos-2: From Univariate to Universal Forecasting*](https://arxiv.org/abs/2510.15821), arXiv:2510.15821, 2025. The paper describes group attention, univariate/multivariate/covariate tasks, and zero-shot inference. Its benchmark claims are **not** results measured on this dataset.
4. Google Research, [TimesFM official repository](https://github.com/google-research/timesfm). **Fallback / optional further research**, not used here. It has its own package APIs and model licensing; do not assume it is interchangeable with Chronos-2 or claim experiments not run. As of August 2026 the repo announces TimesFM 3.0; pretrained weights have a noncommercial license restriction.

## How the uploaded class materials informed this experiment

| Uploaded material | Adapted best practice | What does not transfer directly |
|---|---|---|
| `regression.ipynb` + `W2 - Practice.docx` | Continuous-value regression targets, clean missing values, descriptive statistics, MAE/RMSE, train/test separation, normalization awareness | Its random tabular train/test split would create future leakage for chronological forecasting; here **time order is retained**. |
| `overfit_and_underfit.ipynb` | Honest validation selection, caution about model complexity, held-out performance | This experiment does **not** train a network or use early stopping; it compares 2 context lengths on validation only. |
| `transfer_learning.ipynb` + `W6 - Practice Questions.docx` | Explicit pretrained/target domain distinctions; negative-transfer possibility; distinguish using frozen pretrained weights from fine-tuning | Classification/image tasks do not justify claiming good performance on these sensors. |
| `Data_loading.ipynb` | Read selectively and avoid loading unrelated image/tensor data; reproducible preprocessing | Google Colab Drive mounting, image generators, image normalization and shuffled image labels are **not used**. |
| `classification.ipynb`, `SVM_classification.ipynb`, `W3`, `W4`, `W5` | Help distinguish forecasting regression from classification metrics and architecture choices | No accuracy/F1/softmax/SVM hinge loss, CNN or image processing in this numerical forecasting pipeline. |
| `temp.pptx` | Its polynomial/activation examples illustrate nonlinear responses; reinforces difference between continuous regression and classification | No polynomial, two-layer dense network or polynomial-regression assumption is fitted to the data here. |

## Dataset facts from uploaded CSV

- `HRU507_S-L5-008_1min_aligned.csv`: **525,540** consecutive one-minute observations from **2018-01-01 01:00** through **2018-12-31 23:59**; one asset `HRU507`, one sensor `S-L5-008`.
- No absent timestamps, duplicate timestamps or null entries for three targets in the supplied file at inspection.
- Metadata: `temperature_provenance=source_ZONE_TEMP_1_assumed_F`; `humidity_provenance=synthetic_physical_mass_balance`; `co2_provenance=synthetic_physical_mass_balance`; `dataset_type=HYBRID_OBSERVED_PROXY_AND_SIMULATED`.
- **Observed/proxy temperature is not verified physical sensor ground truth.** The assumed original unit conversion must be recorded as a source uncertainty; unusual high observed proxy temperatures may be artifacts or source-condition behavior.
- Occupancy mode and synthetic occupant scenario are *not given as inputs* to the base model. They can encode simulation generation rules and confound independent forecasts.

## Design choices

1. **Chronological partitions:** 70% historical train (used for data audits, variability scales, event thresholds; **no Chronos training**), 15% validation (choose 60 or 180-minute context), 15% untouched final test. No random shuffling.
2. **Origin definition:** a forecast origin `t` is the latest recorded observation. At model input, only rows `[t-context+1,...,t]` are available. An origin is eligible only if the entire forward 15-minute target horizon belongs to the validation or test segment.
3. **Joint multivariate input:** histories in physical units (°C, %RH, ppm) are passed together as shape `[batch, 3, context]`. Official Chronos-2 internally handles the neural scaling and forecasting; no manual mean/std normalization is applied to model inputs. **Training-only standard deviations** are used *only to fairly combine validation errors* across different units.
4. **Direct multi-step forecast:** predict an entire 15-minute path; evaluate points at steps 5/10/15, not just the first step repeated.
5. **Probabilistic output:** p10, p50, p90; p50 is the point-estimate. We also report empirical p10–p90 coverage as a diagnostic, without claiming interval calibration.
6. **Comparable persistence baseline:** for each origin and each horizon, forecast the last known value. No parameter fitting needed. MAE, RMSE and relative MAE skill shown for both.
7. **Post-hoc transition evaluation:** threshold from training-only 98th percentile of observed |value(t+15)-value(t)|; find test events and score separately. The event scan uses test future targets only to *label which cases changed*, never as features nor for context tuning. Results are diagnostic and may overrepresent hard transitions.
8. **Reproducibility:** input SHA256, split positions, contexts, random seed, inference device/model ID, and outputs exported. `test_origins` default samples evenly across test timeline; **do not misrepresent these as full-population errors**.

## Suggested report language

> We evaluated Amazon Chronos-2 as a pretrained, zero-shot, multivariate time-series forecasting foundation model for temperature, relative humidity and CO₂ in an HRU-associated prototype. Forecasts used only measurements available up to each prediction origin. Context length was selected on a chronological validation period, and an untouched temporal test period was used for final reported performance. The study compared per-variable 5-, 10-, and 15-minute MAE/RMSE against a last-value persistence baseline. Relative humidity and CO₂ were simulated; temperature was a proxy based on an assumed source unit, so these results establish feasibility on a hybrid dataset rather than accuracy on real building instrumentation.

## Why not just call Chronos-2 'a different Transformer'?

Chronos-2 still belongs to the neural attention / Transformer family, so it is **not an algorithm from an unrelated family**. The independent contribution is its **pretrained time-series foundation-model approach** vs a **custom Transformer fitted from scratch**. If assessment rules literally require a *non-Transformer architecture*, select a different method such as LightGBM lagged-feature regression, gradient-boosted trees or statistical forecasting; Chronos-2 alone would not satisfy that stricter interpretation.
