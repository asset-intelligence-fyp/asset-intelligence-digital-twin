# Whole-building Qwen3 room assistant — current `llm_integration`

This integration is built for **the live 18-point whole-building website**, not the obsolete nine-point Level 5 demonstration. It preserves the current React/xeokit BIM viewer, HTTP simulator, five room groupings, replay, what-if scenarios and existing Room assistant drawer. The active API is `server/sensorServer.js` on port 3001, which registers `/api/assistant/health` and `/api/assistant/ask`. The legacy `server/index.js` `/api/ai/*` route and `src/components/AssistantPanel.tsx` remain archived reference code; they are **not active** on this website.

## Selected local model and prompt

- **Model:** Ollama `qwen3:1.7b` at `http://127.0.0.1:11434`.
- **Prompt:** the original `llm_service/shared_llm/prompts.py` **P2 `concise`** instructions, with additional whole-building evidence/JSON constraints.
- **Retrieval:** deterministic, read-only room history retrieval in Express, then Python evidence aggregation. The LLM does **not** autonomously choose tools in this integrated path.
- **Verification:** R4.3.1-**style** numeric claim validation, conservative finding/boolean contradiction checks, and human review for rule/model disagreement. This is a new website adapter, not an exact reuse of the research R4.3.1 retrieval code or its F1 results.
- **Sources:** 18 canonical codes in `shared/sensorRegistry.json`; simulator room IDs are demonstration aliases across different IFC floors. Do not infer a physically installed location.

## Run locally on macOS

```bash
cd ~/Desktop/FYP/asset-intelligence-digital-twin
git switch llm_integration
npm ci
ollama pull qwen3:1.7b
# Run the Ollama macOS application, or in another terminal: ollama serve
npm run dev
```

`npm run dev` starts the Python bridge (`llm_service/bridge.py`, port 8011), the active Node backend (port 3001), Vite (port 5173), and the HTTP simulator when `TWIN_STORAGE=memory`. With PostgreSQL configured, use `npm run db:setup`, then run the simulator in another terminal (`npm run simulator`). The browser's random mode and replay/what-if values are labelled **client-supplied synthetic snapshots**.

In `.env` (optional, keep existing database credentials):

```env
OLLAMA_URL=http://127.0.0.1:11434
LLM_BRIDGE_URL=http://127.0.0.1:8011
# Optional explicit override. If unset, the bridge automatically checks:
#   storage/digital_twin.sqlite (this website)
#   ../digital_twin_shared_llm/storage/digital_twin.sqlite
# LLM_HISTORY_DB=/absolute/path/to/digital_twin.sqlite
```

Verify:

```bash
curl http://127.0.0.1:8011/health
curl http://127.0.0.1:3001/api/assistant/health
curl http://127.0.0.1:11434/api/tags
```

Check *actual comparison-day coverage* without invoking Ollama:

```bash
python3 scripts/check_llm_history.py
# To target a specific historical cutoff:
python3 scripts/check_llm_history.py --as-of '2026-11-03T11:30:00+08:00'
```

The diagnostic reports each continuous sensor's number of matching prior normal-history days (minimum five), and exits nonzero if history is missing or incomplete. It does not create data. If your large SQLite file was previously excluded from Git, it **remains on your Mac** and is automatically used read-only when its schema has a `normal` dataset. If it is in another folder, set `LLM_HISTORY_DB` in `.env` and restart `npm run dev`. Keep the large database and any private fault labels outside GitHub.

`GET /api/assistant/health` now distinguishes model connectivity from `historical_reference_available`; the latter only means the normal-history database exists and is readable, not that every room/cutoff has five matching days. The individual answer supplies `historical_days` and the actual source for each sensor.

## Long-range Qwen-only sensor projections and Room assistant UX

The Room assistant now supports **exploratory long-range LLM projections** at **+1, +4, +6, +12 and +24 months**, for a selected room's temperature, humidity or CO₂ sensor. Both the **Project** button and conversational requests such as `Predict CO₂ in 4 months` call `POST /api/assistant/predict`. The model is **local Qwen3 1.7B with P2 Concise instructions**. This feature is separate from the validated room-anomaly assessment at `/api/assistant/ask`.

**Method:** The backend retrieves selected-sensor, time-bounded **connected HTTP** observations, excludes invalid/future readings, and prepares descriptive monthly means, counts and the most recent actual sensor value. If the local `normal` synthetic SQLite database contains the **same canonical sensor ID**, a separate read-only aggregation contributes earlier monthly averages and dated coverage. These are different evidence sources and are explicitly distinguished in the payload. **Qwen3 alone proposes the future central value and low/high scenarios** from these observed trends. No fitted regression, ARIMA, LSTM, deterministic numerical extrapolator or other trained sensor forecasting model generates future values.

**History sufficiency gates:** At least 1 month / 14 distinct dates for a 1-month projection; 3 months / 60 dates for 4 months; 4 months / 90 dates for 6 months; 5 months / 120 dates for 1 year; and 9 months / 240 dates for 2 years, from a consistent source. A recent connected reading no older than 2 hours is also required. When history is short or incompatible, the result is `insufficient_history` **without a fabricated future number**. A short live session alone does not establish a historical trend.

**Validation and reporting:** Qwen returns JSON with `projected_value`, `lower_scenario`, `upper_scenario`, direction, explanation, assumptions and limitations. Code checks the JSON structure, that the range is ordered, and basic physical sensor bounds; malformed values are discarded with `validation_failed`. **Future accuracy cannot be verified at prediction time**: this is not the same numerical verification as the current-reading anomaly assistant. The scenario bounds are not calibrated prediction or confidence intervals. The result shows provenance, coverage, observed monthly values and uncertainty. A multi-month LLM projection should not be described as a proven accurate forecasting model.

Projections require **Live connected HTTP** data; browser random mode, 24-hour demo, historical replay and what-if snapshots are intentionally excluded. Forecast numbers are generated only when Qwen actually returns a structurally valid response; the model is not invoked when required source history is insufficient. The normal-history database is never uploaded to GitHub and may not contain every website sensor's exact code.

The assistant retains the previous features: at-a-glance findings, recommended checks, expandable source evidence, browser-local per-room chat history with New/Delete, drag resizing, Expand/Restore, and JSON downloads. Older conversations with deterministic +1/+24-hour estimates remain labelled as **legacy historical estimates**, not rebranded as LLM forecasts.

Run focused tests without Ollama (tests mock the LLM):

```bash
python3 -m unittest discover -s tests -p 'test_room_prediction.py' -v
node --test tests/roomPrediction.test.mjs tests/roomAssistantUX.test.mjs
python3 tests/bridge_longterm_smoke.py
```

Run a real Qwen projection on your Mac after `ollama pull qwen3:1.7b`, `npm run dev` and the appropriate local historical source are available. The local smoke test validates the HTTP bridge with a **mocked** Ollama response; it is not proof of real-model accuracy.

The website's room assistant is in the lower-right corner. Select a room using the BIM viewer or location list. A request uses the **selected room's original canonical sensor codes**. The same component supports the existing replay and what-if controls without altering their logic.

## Evidence policy and algorithm

1. Node looks up selected-room points in the canonical registry and retrieves read-only history from `twin18.sensor_readings` (or labels browser-supplied scenario data). It enforces the requested cutoff and rejects unsupported sources/identifiers. The assistant endpoint accepts local connections only.
2. Python keeps valid synthetic readings **at or before** that cutoff. For each sensor with observations in the last hour it computes count, mean, min, max, last and time of last reading. It rejects invalid quality flags. Statistics and published numbers are **backend-calculated**.
3. For continuous sensors, a historical comparator uses at most one robust aggregate per comparable earlier same-weekday day within a ±30-minute time band. It first reads **only** prior `normal` rows from the existing local synthetic SQLite database, discovered automatically or via `LLM_HISTORY_DB`, in read-only mode. Otherwise it may compare older **unlabelled website HTTP observations**. At least **five distinct historical days** are required. The exploratory deviation threshold is `max(sensor-type minimum, 2.5 × standard deviation)`; these are *not calibrated fault-detection thresholds*. Do not use website data as a verified normal reference.
4. Occupancy is presence, **not measured headcount**. Water leakage uses an explicit binary indication: any positive leak observation is escalated even when the model disagrees. No mean/SD rule is applied to binary sensors.
5. The local Qwen3 1.7B response is schema-constrained to a short P2-style finding, investigation flag, hypotheses, checks, limitations and named numeric claims for one focus sensor. The backend verifies each numeric claim against its source facts. Model-authored numeric measurements in prose are checked against backend-sourced values and their units. Matching numbers may appear in the concise explanation; unsupported numerical sentences are withheld and the answer is escalated for review. The authoritative evidence lines remain generated by Python, not model text.
6. The semantic checker looks for explicit finding/`needs_investigation` contradictions. These trigger `review_required`, retaining verified sensor evidence and the raw model decision in the audit payload. An independent historical-rule disagreement **does not veto** a model alert. Invalid structured claims or schema trigger `validation_failed`; unsupported free-text numbers are withheld and trigger human review rather than discarding otherwise grounded structured values. Insufficient comparison history triggers `insufficient_evidence` or human review (if the model requests investigation), never a fabricated normal verdict.
7. The response distinguishes `alert`, `no_alert`, `review_required`, `insufficient_evidence`, `validation_failed`. The UI shows the status, numeric check, semantic check, source-backed evidence, limitations, and technical trace. The response never represents review escalation as a confirmed fault.

### Why some new simulator sessions show `insufficient_evidence`

The default simulator may provide only minutes of synthetic data. Five distinct *previous comparable days* are necessary for a historical baseline. The bridge now discovers an existing normal-history database locally without copying it into Git. If there is no normal-history database or fewer than five matching days for the selected sensor/time, it correctly reports insufficient evidence. **The repository cannot manufacture valid historical data.** Do not claim the system detected no anomaly when that rule is not evaluable. The room assistant can still provide a trustworthy measured-data summary when the model output passes its numeric checks.

### Runtime API contract

`GET /api/assistant/health` checks the running bridge, available normal-history database and installed Ollama model; it reports `qwen3:1.7b`, `concise`, `validated`, `hybrid_semantic`, and the independent historical-source readiness flag.

`POST /api/assistant/ask` keeps the existing frontend request format: `{room_id, question, source, as_of, snapshot?}`. Only canonical registry room identifiers and one of `http`, `browser_demo`, `historical_replay`, `what_if` are accepted. The bridge response preserves the existing `result` fields and adds `status`, `numeric_verification_passed`, `semantic_conflict`, `human_review_required`, `decision_assessment`, and `verified_evidence`. Existing frontend features and routes are unchanged.

## Testing and limitations

```bash
python3 -m unittest discover -s tests -p 'test_validated_room.py' -v
python3 scripts/check_llm_history.py
node --test tests/roomAssistantValidated.test.mjs
npm test
npm run build
```

The focused Python tests mock Ollama and check retrieval, validation, binary event handling, semantic contradictions, cutoff correctness, and the exact P2/validator selection. Node tests mock the bridge and verify canonical routing, provenance and local-only access. `npm test` and `npm run build` check the existing frontend/simulator, but a complete live test on your Mac still requires its actual dependencies, PostgreSQL as applicable, Ollama and a WebGL-capable browser.

**Research limitation:** Earlier P2 prompt scores and R4.3.1 development/holdout results arose from different experimental data/retrieval pipelines. They do not validate this new 18-point website combination. A new event-separated labelled evaluation is required before asserting precision, recall or F1 for the integration.