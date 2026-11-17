# Agentic RAG integration (research prototype)

Branch: `feature/agentic-rag`, based on `feature/velvet-ui`.

## What is implemented

This is a **bounded SQL-tool-calling anomaly assistant** using the existing pretrained
`qwen3:1.7b` model via Ollama, not a replication of the fine-tuned multi-agent
architecture in Ravuru et al. (2024). No fine-tuning, LSTM, embeddings, or
autonomous database SQL generation are introduced.

The previous fixed-retrieval assistant remains available for direct comparison.

| Active capability | Endpoint |
| --- | --- |
| Existing fixed historical retrieval | `POST /api/assistant/ask` |
| Model-selected read-only retrieval | `POST /api/assistant/ask-agentic` |
| Existing one-month LLM prediction (unchanged) | `POST /api/assistant/predict` |
| Python original analysis | `POST /ask` on loopback bridge |
| Python agentic analysis | `POST /ask-agentic` on loopback bridge |

The frontend offers a selector between **Agentic RAG** and **Fixed retrieval**.
Agentic RAG is the default selector in this development branch; the fixed
baseline remains one click away.

## Agent investigation workflow

1. Node.js validates loopback access, local origin, canonical room ID, source,
   timezone-aware cutoff and room sensor points. Only readings at/before
   `as_of` are sent to the Python bridge.
2. `build_evidence()` constructs the existing independently checked
   60-minute room evidence; this also establishes the focus sensor.
3. Qwen selects a **read-only** retrieval tool:
   - `get_recent_trend(sensor_id, hours=1|6|24)` uses the authorised
     room's real request-history snapshot (all synthetic).
   - `get_historical_baseline(sensor_id, years=1|3|7)` queries only
     historical **normal**, quality-filtered SQLite rows from before the
     analysis timestamp, using comparable weekdays and ±30-minute clock slots.
   - `get_room_context()` returns only the verified room snapshot.
4. Qwen may request additional evidence within **3 investigation rounds,
   6 total calls**. If native Ollama `message.tool_calls` is missing, the
   agent retries and then asks Qwen for a **schema-constrained JSON tool plan**.
   The backend validates and executes only registered room-scoped tools;
   this remains model-selected retrieval, but is explicitly labelled
   `structured_tool_plan` rather than a native function call. At least one
   successful model-selected retrieval is required. A separate final call
   generates a schema-constrained anomaly response.
5. `publish()` reuses the existing **independent** numerical/narrative and
   historical-rule checks. The backend supplies numeric claim values from its
   own verified evidence rather than accepting LLM-generated numeric values.
6. The UI displays final alert/review status and a brief tool trace.

**Important:** The independent existing 60-minute/3-year historical rule is
not silently replaced by the agent's possible 7-year historical tool result.
This may cause disagreement/review. It is intentional until the two
validation policies can be evaluated on the same controlled cases.

### Safety and provenance

- No arbitrary SQL is generated or executed by the model.
- No access to other rooms or unregistered sensors through tools.
- No future observations, private fault labels or scenario names enter retrieval.
- The historical SQLite connection is read-only.
- Tool call arguments have fixed enumerated windows and bounded outputs.
- The bridge and Ollama services remain loopback-only.
- Tool traces are provided for reproducibility.
- A model-selected tool is not proof that the resulting diagnosis is correct.
- Synthetic readings and virtual BIM sensor aliases are **not real measured
  building data or verified device installations**.

## Local installation and tests

From the repository root:

```bash
ollama pull qwen3:1.7b
npm install
npm run test:ai
npm run test:agentic:python
```

Node.js and Python tests use mocks/fixtures. They **do not establish actual
Ollama tool-selection performance**. The Python tests check sensor scoping,
future-data exclusion, seven-year normal-only retrieval, required tool
calls and re-use of the existing validator.

Start the Digital Twin as usual:

```bash
npm run dev
```

Ensure `LLM_HISTORY_DB` points to a populated normal-history SQLite file
(or use the project's existing discovery paths). Start a simulator feed and
select **Agentic RAG** in the Qwen room assistant.

Check `GET /api/assistant/health` for `agentic_supported: true`.
After analysis, inspect `agentic.tool_call_count` and `tool_trace`.
For a direct raw Ollama tool-calling probe that does not touch your sensor
database, run:

```bash
python3 scripts/diagnose_agentic_tools.py
```

A reported `structured_tool_calls: 0` confirms that this particular
native request did not yield a structured function call; it does not measure
anomaly accuracy. The agent will then try a **schema-constrained Qwen tool
plan** before failing. If both methods fail, the evaluation writes
`runtime_error`; never count it as a successful classification.

If all initial Agentic RAG smoke-test cases were saved as `runtime_error`,
move aside `reports/agentic_rag_eval/agentic_predictions.jsonl` before
re-running; `--resume` skips those saved failures. The fixed baseline
output remains intact.

## Blind paired evaluation

The new runner reuses the **same public cases, hidden answer key and
synthetic readings** as `scripts/evaluate_llm_anomalies.py`.
Only the `score` subcommand accesses the private key.

Prepare a held-out dataset first with the original anomaly `prepare`
command. Then run each mode on the same public case IDs:

```bash
python3 scripts/evaluate_agentic_rag.py run --method fixed \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --limit 3

python3 scripts/evaluate_agentic_rag.py run --method agentic \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --limit 3
```

Inspect runtime errors and tool traces before the full run:

```bash
python3 scripts/evaluate_agentic_rag.py run --method fixed \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --resume

python3 scripts/evaluate_agentic_rag.py run --method agentic \
  --readings tools/level03_simulator/outputs/fyp_fault_holdout/sensor_history.csv \
  --db storage/digital_twin.sqlite --resume

python3 scripts/evaluate_agentic_rag.py score
```

Report is written to `reports/agentic_rag_eval/summary.json`.
The score command reports paired classification metrics, **recall across
all positives**, scored-case false-positive rate, coverage, sampled-event
recall, tool calls and mean/P95 latency.

The fixed method computes evidence from the most recent 60 minutes; the
agent can additionally retrieve earlier readings within the preceding
24 hours. That is the deliberate architectural difference. If investigating
prompt-selection effects separately, use a further control with the same
24-hour window and a fixed expanded retrieval plan.

A target such as **>=90% fault recall** is a research progression criterion,
not an achieved result. High recall must be accompanied by an acceptable
false-positive rate and coverage. Do not tune to the private holdout,
and do not claim successful benchmark performance until real Ollama runs.

## Remaining work / limits

- Run Ollama native-tool diagnostic and actual model-directed structured-plan smoke tests on the Mac; record each selection mode and retrieval trace.
- Verify that all seven historical years are imported and indexed in SQLite;
  the existing fixed validator currently uses a three-year window.
- Measure actual latency and false-positive trade-offs on blind cases.
- Confirm the UI, backend, simulator and bridge operate end-to-end.
- Optionally add a forecasting agent after the anomaly agent is validated.
  The current one-month predictor remains unchanged and **is not agentic**.
