# Chatbot Improvement Tasks

Status: [ ] Pending · [x] Completed
Add your name beside a task when starting it.

## Priority 1 — Critical Validation Fixes

- [ ] Preserve leak alerts even when the model returns invalid JSON, fails validation or becomes unavailable.
- [ ] Separate sensor/rule alerts, model validity and required operator action in the API response.
- [ ] Validate numerical claims by room, sensor, statistic, value, unit and time window.
- [ ] Prevent sample counts from being accepted as sensor measurements.
- [ ] Require calculated evidence for claims about increases, decreases and differences.
- [ ] Block unsupported equipment diagnoses and claims about sensors that are not installed.
- [ ] Replace the broad “Numerical claims: verified” label with wording that explains exactly what was checked.

## Retrieval and Evidence

- [ ] Identify the question type before retrieving evidence.
- [ ] Retrieve both rooms at a common cutoff for cross-room comparisons.
- [ ] Include the actual comfort score, formula, penalties and sensor coverage when explaining comfort.
- [ ] Calculate comparisons and derived values in backend code.
- [ ] Represent missing sensors explicitly instead of omitting them.
- [ ] Distinguish “not installed”, “unavailable”, “stale” and “reporting”.
- [ ] Add per-sensor freshness checks with a configurable age limit.
- [ ] Select historical comparison days before limiting individual readings.
- [ ] Verify historical retrieval works consistently across different sampling frequencies.
- [ ] Report baseline coverage separately for each sensor.
- [ ] Return a specific limitation when the requested evidence cannot be retrieved.

## Prompt Design

- [ ] Remove conflicting instructions about autonomous tool use and backend-prefetched evidence.
- [ ] Match source descriptions to live, replay and what-if data.
- [ ] Explicitly prohibit interpreting missing measurements as normal conditions.
- [ ] State that PIR occupancy indicates presence, not an exact headcount.
- [ ] Require hypotheses to be distinguished from confirmed observations.
- [ ] Require clear abstention when evidence is insufficient.
- [ ] Test baseline, concise and few-shot prompts with identical evidence and model settings.
- [ ] Keep a versioned record of each prompt and its evaluation results.

## Model Selection

- [ ] Make the model configurable across the backend, Python bridge and interface.
- [ ] Make prompt selection configurable for controlled experiments.
- [ ] Keep Qwen3 1.7B as the current comparison baseline.
- [ ] Evaluate Qwen3 4B, Llama 3.2 3B and Gemma 3 4B where hardware permits.
- [ ] Record model digest, quantisation, context size, temperature and thinking setting.
- [ ] Compare models using identical questions, evidence and output schemas.
- [ ] Measure unsupported claims, correct abstention, schema validity and response latency.
- [ ] Compare against a template-only baseline for summaries and comfort explanations.
- [ ] Select the model using measured results rather than answer fluency alone.

## Regression Tests

- [ ] Test a meeting-room summary when no leak sensor is installed.
- [ ] Test an explicit leak question in a room without a leak sensor.
- [ ] Test comfort-score explanations against the dashboard calculation.
- [ ] Test occupancy questions that request exact headcounts.
- [ ] Test cross-room CO₂ comparisons.
- [ ] Test a false temperature claim whose number matches the sample count.
- [ ] Test unsupported increases, decreases and causal explanations.
- [ ] Test positive leak readings combined with malformed model output.
- [ ] Test missing sensors and stale readings.
- [ ] Test dense historical data spanning multiple comparison days.
- [ ] Test attempts to override evidence or request fabricated conclusions.
- [ ] Retain the existing 23 Python tests and add the reproduced failure cases.

## Evaluation and Team Handover

- [ ] Create a shared evaluation set with expected facts, acceptable abstentions and forbidden claims.
- [ ] Separate development cases from the final held-out evaluation set.
- [ ] Change one component at a time when comparing model, retrieval and prompt variants.
- [ ] Save the question, evidence snapshot, configuration, raw output and published answer for each test.
- [ ] Report retrieval correctness separately from answer correctness.
- [ ] Track unnecessary review escalations as well as missed alerts.
- [ ] Record median and p95 response latency on the same hardware.
- [ ] Document remaining limitations and avoid claiming validated anomaly-detection performance prematurely.

## Completed

- [x] Conducted five live chatbot tests.
- [x] Ran the existing 23 Python tests successfully.
- [x] Reproduced additional validation and retrieval failures using controlled inputs.

## Handover Notes

- Live testing found unsupported leakage statements and an incorrect comfort-score explanation.
- Existing tests pass but do not cover the reproduced failures.
- Alternative models have not yet been benchmarked.
- The fixes above have not yet been implemented.

----------
Emily write to do list
1. weather is not attached to real yet/ should weather be attached to sensor
2. need actual simulator
3. latency
