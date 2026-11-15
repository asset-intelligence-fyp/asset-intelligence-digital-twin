> **Legacy Level 5 reference only.** The 18-sensor office-building integration uses `server/sensorServer.js`, `server/roomAssistant.js` and `llm_service/validated_room.py`. See [whole-building LLM integration](whole-building-llm.md). This document below describes the inactive nine-point adapter.

> **Compatibility warning (18-point merged branch):** The implementation
> described below targets the legacy nine-point Level 5 website and is **not
> attached to the active `server/sensorServer.js` whole-building runtime**.
> See [Whole-building AI merge status](whole-building-ai-merge-status.md).

# Local AI assistant: Snowdon Level 5 (llm_integration)

This implementation connects the current **React / xeokit / Express / PostgreSQL Level 5** application to local **Ollama `qwen3:1.7b`**. It uses a P2-concise-style prompt, deterministic read-only PostgreSQL retrieval, a typed numeric evidence checker, and the R4.3.1 **hybrid + semantic consistency** review policy.

## Important dataset / method boundary

The earlier R4.3.1 research implementation uses a separate **Level 03** synthetic SQLite dataset with CO2/TEMP IDs such as `CO2-L03-MEET-01`, and matches occupancy, AC and ventilation over 2023–2025. **That historical dataset is not in this GitHub repository**. The website is now a **Level 5** model (HRU501A, HRU504, HRU507) with **nine different online PostgreSQL sensor points** and eight genuine IFC-linked markers. `FS-501A` is not an IFC element. The adapter deliberately does not claim a Level 03 sensor maps to a Level 5 asset.

This repository provides a **JavaScript adaptation of the R4.3.1 checks**, not a byte-for-byte execution of the original Python/SQLite agent. The numeric-verification and disagreement escalation rules are preserved. The new data adapter only compares prior same-weekday/same-Malaysia-clock-time means when at least five comparable previous calendar days exist. No occupant/AC/ventilation/weather-matched baseline is available for the Level 5 database. Position, command and binary fan-state channels have **no calibrated anomaly thresholds** and cannot be declared normal/faulty by this temperature rule.

Consequently, the **P2 benchmark score (e.g. precision 0.8333) and previous R4.3.1 F1 figures do not apply to this Level 5 integration**. Run a new labelled and event-separated experiment before making performance claims. The system does not autonomously select tools: the Express backend retrieves a single canonical sensor point before sending the evidence to Ollama.

## Local setup (macOS M1, 8 GB)

1. Check out **`llm_integration`** and ensure the database has the existing nine-point migration. Do **not** rerun `postgres_init.sql` on a database you need to keep; it destroys tables. Keep the existing MQTT simulator running if you want stored recent readings.
2. Install dependencies with `npm install` if needed; no new npm packages are added by this AI feature.
3. Start Ollama and install the local model: `ollama pull qwen3:1.7b` (if not installed). In another terminal, run `ollama serve` only if Ollama is not already running.
4. Set these optional entries in your local `.env` (never commit passwords):

```env
AI_ENABLED=true
OLLAMA_URL=http://127.0.0.1:11434
```

5. Start `npm run dev`. Open `http://localhost:5173`. Select one of the nine points using the real BIM model (eight mapped), the Overview, or Sensor Monitoring. Open the bottom-right AI Assistant and choose a **Malaysia time** window with stored PostgreSQL samples, then Analyse.

The default window is the previous hour in MYT. The browser's synthetic **random mode is not persisted** to PostgreSQL, so it cannot be queried by the AI. Switch to MQTT and run the approved synthetic publisher to create persisted sensor history. An empty or sparse window is reported as `insufficient_evidence` without inventing values.

## API

`GET /api/ai/status` returns the configured model, prompt/retrieval/validator and synthetic dataset notices. It does not prove Ollama is reachable.

`POST /api/ai/analyze` (loopback-only, one concurrent request):

```json
{
  "point_code": "SAT-501A",
  "window_start": "2026-11-03T08:00:00+08:00",
  "window_end": "2026-11-03T09:00:00+08:00",
  "question": "Compare this supply-air temperature with earlier observations and recommend checks."
}
```

The timestamps are examples; update to a **past interval containing your own stored data**. Both must have `+08:00` offsets, stay on one Malaysia calendar day, cover at most six hours and contain no future readings. Only the nine canonical point IDs are accepted. The API intentionally rejects arbitrary SQL, model, dataset, tooling and path controls. No ground-truth labels or private evaluation keys are part of this service.

Response: `status`, `finding`, `verified_evidence` (with `current_window`, `historical_baseline`, `anomaly_assessment`), `numeric_verification_passed`, `semantic_conflict`, `decision_assessment`, `evidence`, `hypotheses_unverified`, `recommended_checks`, `model`, `prompt_variant`, `latency_seconds`, and `source_notice`.

The endpoint permits **local connections only** because the existing application has no authenticated users and Ollama inference can be expensive. Do not expose it publicly without authentication, rate limiting, and network controls. A second concurrent AI request returns HTTP 429.

## Decision handling

| Status | Meaning |
| --- | --- |
| `alert` | Both verified LLM boolean and exploratory temperature rule recommend investigation |
| `no_alert` | Neither flagged this observation under the available rule; **not proof of healthy equipment** |
| `review_required` | LLM/rule disagreement, or an explicit finding-versus-boolean contradiction; preserve both, escalate for human review |
| `insufficient_evidence` | Missing/sparse current readings, fewer than five prior comparable days, or unsupported non-temperature sensor type |
| `validation_failed` | Invalid model JSON, sensor/room ID mismatch, numerical mismatch, or timestamp mismatch |

Free-form LLM causes are hypotheses, not validated facts. Verified statistics and published evidence are generated by backend SQL calculations, not copied from the model's prose. Distinguish *triage escalation* from *confirmed fault diagnosis*. If a sensor is unavailable or Ollama is offline, the user sees a transparent error or an insufficient-evidence result.

## Checks

```bash
node --test tests/aiIntegration.test.mjs
node --test tests/*.test.mjs
npm run build
```

In addition, test your actual PostgreSQL, MQTT, local Ollama, xeokit marker selection and the assistant from a local browser. Automated module/unit tests do not prove live connectivity or classification accuracy.

## Source inventory

- `server/aiCore.js`: numeric schema, source verification, R4.3.1-style semantic review and triage logic
- `server/aiService.js`: canonical Level 5 PostgreSQL retrieval and local Qwen3 request
- `server/aiRoutes.js`: local Express API, input validation, one-concurrent-request guard
- `src/components/AssistantPanel.tsx`: working assistant drawer, canonical BIM point selection and result presentation
- `src/ai-assistant.css`: styles extending the current TwinLabs drawer
- `tests/aiIntegration.test.mjs`: regression tests for IDs, SQL parameters, numeric checks, semantic conflicts and model request contract

The repository's original BIM XKT files, MQTT ingestion, PostgreSQL sensor registrations and website routes are unchanged.