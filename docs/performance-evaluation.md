# Simulation, synchronisation latency and AI evaluation

> Current source update: the default is now the [calibrated hybrid generator](hybrid-simulator.md), which creates new readings with virtual weather and holidays. Dataset replay remains a separate testing mode (`SIMULATOR_MODE=replay`). The same HTTP/SSE transport is reused; earlier replay latency numbers do not benchmark the hybrid generator.


## Current status and source boundary

The PoC uses synthetic data only. No physical building feed is connected. The former
Live twin / replay / what-if / comfort panel is removed from the overview. The theme
toggle remains in the header. Browser-random source controls are removed; the normal
website receives the Python HTTP stream. Decorative weather changes no sensor values.

The supplied `people_driven_v3.0` dataset is now audited and replayed by
`tools/dataset_replay/replay.py`. The ZIP contains generated files, not the original
generator code. See [dataset replay setup](dataset-replay.md) and
[HTTP + SSE architecture](http-sse-architecture.md). The old SOP generator is a legacy
reference. Exact sensor numeric values and missing observations are preserved, with
synthetic fault annotations excluded from inference. Maintain the IFC demonstration aliases.

The source adapter is `POST /api/sensor-readings`. It accepts `readings` containing
`sensor_id`, `room_id`, `sensor_type`, `unit`, `timestamp` and numeric `value` (or NULL with `quality_flag: missing`). The
registry in `shared/sensorRegistry.json` defines valid identities and aliases. Preserve
dataset/simulation timestamps. For same-computer timing add top-level:

```json
{
  "producer": "name-and-version-of-simulator",
  "clock_domain": "same_host",
  "generated_at_utc": "wall-clock ISO timestamp recorded when releasing the replay batch",
  "sequence": 1,
  "readings": []
}
```

The timestamp above is a placeholder format description, not a payload to submit.
Do not mark remote clocks `same_host`; synchronize clocks independently before any
cross-machine timing test. The API's `/api/live-status` includes the last producer
declaration; that declaration is provenance information, not independent authentication.

## Run the bundled simulator

```bash
TWIN_STORAGE=memory npm run dev
```

By default this starts one 18-point Python batch every five real seconds, while each
batch advances simulated time by one minute. A five-second delivery interval is not
a measured five-second transport/render latency. The launcher writes generated outputs
under ignored `runtime/simulator`, leaving the older tracked CSV/JSON files alone.

For deterministic injected scenarios use `SIM_FAULT_MODE=demo` before starting. For
sparse seeded fault injection use `SIM_FAULT_MODE=live`; this name refers to a simulator
mode, not real sensors. Keep `normal` for baseline-only generation. For a supplied
external simulator disable the bundled process with `SIMULATOR_AUTOSTART=false` and
start the teammate's adapter separately. Do not run two publishers simultaneously.

The existing PostgreSQL setup remains available. Use it for the final persistence test;
temporary-memory measurements do not establish PostgreSQL performance.

## Source-to-twin latency test

1. Start the selected simulator, API and browser on the same computer. Record commit,
   hardware, OS, browser, storage mode, sampling interval, sensor count and background load.
2. Open Simulator and click **Start new measurement run** after the page subscribes.
3. Leave one tab visible until at least 30 complete batches (540 readings). Prefer at
   least 60 batches at the normal five-second cadence for a repeatable acceptance trial.
4. Download latency results. Run multiple trials, including PostgreSQL, ordinary viewer
   interaction, missing batches/reconnection and representative machine load. A background
   tab throttles animation frames; report it separately rather than hiding slow samples.
5. Report count, missing acknowledgements, invalid clocks, median, p95, maximum, and the
   number/fraction within 5,000 ms. A missing/incomplete run is not a pass.

Measurement stages:

- Source wall-clock timestamp is recorded before `engine.step()`.
- The API timestamps receipt and successful transaction/memory commit.
- SSE carries a trace ID and expected batch size; the browser waits until all points
  in the batch have reached React state, then two animation frames before acknowledging.
- The API timestamps acknowledgement receipt using its own clock. This includes the
  return network hop and is therefore a conservative upper bound after a paint
  opportunity. It does not instrument GPU completion or prove the BIM geometry rendered.

Browser clock values are not subtracted from server clock values. Simulation timestamps
are never used as transport timing. Model inference is measured separately. Empty timing
metadata, negative clock differences and pending acknowledgements remain visible.

The run assessment requires all instrumented batches completed and at least 30 batches.
It reports the observed run only; it cannot establish performance on another computer,
storage configuration or load. Do not call a short localhost test a scalability result.

CLI export on the same host as the API:

```bash
python3 scripts/export_latency_report.py --output runtime/latency-report.json
```

## Meaning of the 85% AI criterion

The supplied brief says **anomaly detection accuracy ≥85% against logged maintenance
events**. Sensor display correctness, unit-test success and fluent explanations do not
measure this criterion. Synthetic injection labels can support development evaluation;
using them instead of reviewed maintenance events requires an agreed evaluation basis
with the supervisor/client. No measured 85% result is claimed by this change.

Accuracy = (TP + TN) / all predeclared cases. Also report fault recall, precision, F1,
balanced accuracy, case counts, model coverage/abstentions, and a confidence interval.
An all-normal predictor on 90 normal and 10 fault cases gets 90% accuracy while missing
every fault; the companion recall is zero. Hence accuracy alone is insufficient.

Define one **room + one-hour observation window + cutoff** per case, matching the current
assistant's evidence window. Freeze these choices before evaluating:

- Eligible assets and anomaly types; the scorer evaluates room-window classification,
  not per-sensor root-cause diagnosis or the correctness of every sentence.
- Reviewed fault onsets, repair boundaries, uncertain/warm-up exclusions and normal
  comparison windows. An injected fault's start is not necessarily its observable onset.
- One preselected window per independent event (and per normal comparison group).
  Do not inflate counts using hundreds of overlapping windows from the same event.
- Independent development/test dates, seeds/event groups, historical reference, model
  version/quantisation, prompt, thresholds and matching policy. Fit/tune on development
  data only. Reference history must precede the cutoff and must not contain test labels.

The inference input is a frozen JSON request with only `question`, `room_id`, `room_name`,
`source: "http"`, `as_of`, `points`, `history`. Use canonical simulator room IDs in the
Python request and corresponding registry points. Include prior normal observations or
configure the appropriate training-only normal-history SQLite reference. Never include
`fault_active`, scenario labels, event descriptions or expected answers in the request.

## Evaluation runner

Copy `evaluation/cases-template.csv` into an ignored directory such as
`runtime/evaluation/test-cases.csv`. Fill it with the independently reviewed cases:

| Column | Meaning |
| --- | --- |
| case_id | Unique case identifier |
| request_file | Frozen input JSON path relative to the manifest |
| y_true | 1 for an eligible fault window; 0 for a reviewed normal window |
| split | `test` only; do not tune using these cases |
| event_group | Unique independent event/normal group |
| label_source | `synthetic_injection` or `reviewed_maintenance`; separate runs |

With Ollama and the current Qwen model available:

```bash
python3 scripts/evaluate_room_ai.py \
  --manifest runtime/evaluation/test-cases.csv \
  --run \
  --history-db /absolute/path/to/training-only-normal-history.sqlite \
  --output runtime/evaluation/results.json
```

Omit `--history-db` only if the auto-discovered normal reference is the intended one, or
if missing-reference behaviour is deliberately part of the frozen test. The tool calls
the actual current Python analysis path; it does not create favourable predictions.
The manifest labels are kept outside the request passed to the model. Errors are retained.

To rescore saved responses, use `--predictions path/to/results.predictions.jsonl` instead
of `--run`. A missing response counts as an abstention, not an excluded case. The report
separates raw scorable model decisions from operational triage (`review_required` is a
positive escalation there, not a confirmed fault). Invalid/insufficient-evidence cases
reduce all-case accuracy and coverage. An 85% result requires both classes and complete
model coverage for the tool's numeric-target flag. Synthetic results are still not
maintenance-event validation. The Wilson interval assumes independent cases.

The runner scores classification; separately audit grounding, numerical claims,
explanations, unsupported diagnoses and operator usefulness. Prior known validator
limitations remain outstanding. A favourable classification score would not fix them.

## Deliverable status

- Intended teammate simulator/dataset: **awaiting delivery**.
- Latency: instrumentation implemented; repeat on the final Mac/PostgreSQL configuration.
- AI accuracy: evaluator implemented; **not measured** without labelled held-out cases.
- Physical data integration: not used; simulation-only wording and overview updated.

## Recorded preview smoke test, 4 November 2026

The saved trace is `docs/benchmarks/2026-11-04-preview-latency.json`: 40 complete
18-point batches (720 readings), normal five-second delivery, temporary memory.
Median source-to-browser-ack upper bound: 1.708 s; p95: 5.392 s; maximum: 6.037 s;
37/40 upper bounds were ≤5 s. This does **not** establish the five-second acceptance
criterion. The conservative return hop and cloud browser scheduling are included; an
upper bound above five seconds does not identify the actual paint time. Source-to-commit
was at most 489 ms, so the unisolated remainder lies in transport/browser/return timing.
Repeat on the final Mac/PostgreSQL setup with the viewer active and the intended
simulator, including representative AI load. No AI accuracy percentage was measured.

## Supplied dataset replay update (2026-11-05)

The teammate dataset is now supplied and audited. The default launcher now uses exact
CSV replay, not the earlier SOP generator. For current setup and the missing-value/label
boundary see [dataset-replay.md](dataset-replay.md). The source timing boundary is now
**batch release**, because generating the historical CSV occurred offline. See
[HTTP + SSE architecture](http-sse-architecture.md) for the implemented stages and current
research. Earlier generator-specific commands/results above are retained as historical
context, not the current dataset's measured performance.
