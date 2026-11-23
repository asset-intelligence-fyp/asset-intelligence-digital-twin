# TwinLabs Agentic RAG + one-month forecast demo

Branch: feature/agentic-context-forecast-demo-20261123  
Base: development/ui-fixes (the newer simulation/UI work).

## What this integration actually does

The AI assistant now opens **Agentic RAG + 1-month forecast** by default. Select a registered room and sensor.

### Agentic investigation
The Node backend supplies current readings at/before the selected timestamp, plus synchronized synthetic weather/occupancy/HVAC context where available. Python calculates causal trend summaries. Qwen3:1.7b may select up to **two** read-only tools:
- Historical: month-level normal-history from the configured SQLite database (optional).
- Related: other sensors in the same selected room.
- Incidents: earlier rule-generated synthetic alerts, **not** confirmed diagnoses.

Qwen then writes a cited, advisory explanation. The UI displays its retrieval trace, original evidence summaries, suggested checks, and limits. If Qwen is unavailable, a factual observed-trend summary remains visible.

### One-month forecasting
A separate pipeline asks the same Qwen3:1.7b model to produce **one sensor reading exactly one calendar month ahead**, with illustrative lower and upper scenarios. It uses available recent readings and (optionally) historical monthly normal references. If there are fewer than 14 days of current readings and no historical reference month, the output is labelled **low-evidence exploratory scenario**. Numeric outputs must be finite, correctly ordered, and within physical sensor bounds; otherwise no projected value is displayed. This is **not** a trained or calibrated forecast, and the scenarios are **not confidence intervals**.

### Relationship to E8-A research
This is an **E8-A-informed website adapter**, not a direct deployment of the frozen research E8-A anomaly classifier. The E8-A 480-point evaluation metrics do **not** apply to this new adapter. It borrows bounded retrieval and evidence-first investigation but does not automatically classify or confirm equipment faults. Existing deterministic simulator rule alerts remain separate from AI. The original building-evidence assistant remains available as a labelled legacy tab for rollback.

## Run on your Mac

Commit or stash any local changes before switching branches:

~~~bash
git fetch origin
git switch --track origin/feature/agentic-context-forecast-demo-20261123
git lfs pull
npm ci
ollama pull qwen3:1.7b
npm run dev
~~~

Start the Ollama application/service first if it is not already running. The dev command starts Python bridge, Node API, Vite and the simulator. The new website adapter uses the existing Python standard-library Ollama client and needs no extra Python packages.

Optionally set the existing local .env variable LLM_HISTORY_DB to the normal-history SQLite file. Do not commit the database or secrets. Missing history does not block investigating current-run readings.

Check http://localhost:3001/api/assistant/health for connected=true and agentic_supported=true. Open the website URL printed by Vite (usually http://localhost:5173).

## Recommended live demo

1. Simulation lab → Normal day. Verify generator is connected; allow several batches.
2. AI assistant → Agentic RAG + 1-month forecast. Choose Meeting Room → CO2-L03-MEET-01. Click **Explain current conditions** then **Investigate with Agentic RAG**.
3. Expand **Agent retrieval trace** and **Evidence inspected** to show what was retrieved. Current context is included when the hybrid telemetry timestamp matches.
4. Return to Simulation lab and choose **Busy building**, or increase attendance and lower ventilation. Wait for readings to respond; investigate the same sensor again.
5. Optionally inject a controlled temperature drift/spike. The agent describes measured behaviour and possible causes; do not promise it will classify an injected fault.
6. Select a numeric sensor and click **Forecast +1 month**. With short history, the output must be presented as an exploratory scenario, not validated prediction accuracy.
7. Only describe a historical comparison if the normal-history reference is available. Prior rule alerts do not establish a confirmed fault.

## Validation

~~~bash
npm run build
npm run test:ai
python3 -m unittest discover -s tests -p test_agentic_twin.py -v
~~~

GitHub Actions runs Python syntax, causal data isolation tests, frontend build, and existing AI compatibility checks. Live Ollama inference and actual UI interaction must still be checked on your Mac.

## Research limits

- Context depends on synchronized hybrid data; browser demos and replay may lack operational context.
- The source IDs are validated against retrieved evidence; claims in generated prose are **not** fully numerically verified.
- Old normal-history SQLite and current simulator readings have different provenance. They are not silently treated as one stream.
- Historical rule alerts are not verified maintenance incidents.
- The current forecast is one month-ahead *point* prediction, not a full month-long time series.
- Evaluate blind anomaly precision/recall and one-month forecast MAE/WAPE independently before accuracy claims.


## Troubleshooting: AI shows "Local model unavailable" or "No observations"

These are two independent conditions.

**No observations despite 18/18 reporting:** In the initial integration, PostgreSQL timestamps were JavaScript Date objects, but the AI route filtered for strings only. The later fix normalizes database dates to ISO strings and maintains a bounded mirror of committed current-run sensor batches. Pull the latest commit, **stop the existing npm run dev process**, and restart it; hot-reloading the frontend alone does not replace the backend process.

**Local model unavailable:** The "18/18" badge reports sensor transport, not Qwen. On the Mac:

~~~bash
ollama list
curl http://127.0.0.1:11434/api/tags
curl http://127.0.0.1:8011/health
curl http://127.0.0.1:3001/api/assistant/health
~~~

- If the first HTTP check fails, start the Ollama application or run ollama serve in a **separate Terminal window**. Do not run a second server if Ollama is already listening.
- If qwen3:1.7b is absent from the tags response, run ollama pull qwen3:1.7b.
- If the bridge check on 8011 fails, inspect the Terminal running npm run dev for Python startup or port-conflict errors.
- If the Node AI health response reports connected=false, read its error field. The interface now shows this error and offers a Recheck AI connection button.

Pull the corrected branch on the test Mac:

~~~bash
git status
git switch feature/agentic-context-forecast-demo-20261123
git pull --ff-only origin feature/agentic-context-forecast-demo-20261123
npm run dev
~~~

Keep one dev process running. The simulator must deliver a fresh batch after a Node restart for the in-memory stream mirror to be populated. The mirrored data is always from accepted server-side batches and contains neither injection instructions nor ground-truth fault labels.
