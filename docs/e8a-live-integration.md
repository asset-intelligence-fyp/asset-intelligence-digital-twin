# Live E8-A agentic anomaly monitoring for TwinLabs

## What is deployed

The E8-A **anomaly detection** workflow from `llm-test/tyra_agentic_rag_m1/src/e8a.py`
is copied unchanged into this branch together with its E7 causal retrieval tools,
LangGraph planner, independent E8-A evidence review, validator and Ollama adapter.

This is **not** a newly trained model or a future-fault forecaster. The local
model is Ollama **`qwen3:1.7b`**. E8-A assesses the latest available synthetic
sensor state; one-month point forecasting remains the separate existing
`/api/assistant/predict` workflow.

Every E8-A evaluation performs:

1. **Initial LLM screening** for normal / suspect / anomaly / unknown. The
   original screening result is preserved.
2. **Mandatory causal trajectory retrieval**, plus up to two optional
   LLM-planned retrieval calls (historical references, summary, related
   sensors, seasonal, similar shapes or context).
3. **Independent LLM evidence review**, with deterministic source-ID,
   temporal, numerical and same-sensor comparison validation. One grounding
   repair call may be attempted. Failed review abstains as `unknown`; it
   never silently overwrites initial screening.

The original research pipeline expects 5-minute UTC readings in a DuckDB
`readings` table. A separate website adapter uses the existing Express
HTTP/postgres-or-memory sensor feed, filters labels and future observations,
retains the **last actual observed value** per UTC five-minute bucket,
and creates a temporary unlabeled DuckDB for each request. Missing intervals
are **not interpolated or synthesized**. The dataset and evaluation labels
never enter live inference. Results retain the simulated evidence provenance.

## Install on your Mac (once)

From the cloned repository on branch `design/clean-dashboard-preserve-features`:

```bash
npm ci
python3 --version
# Python 3.11 or 3.12 recommended
python3 -m pip install -r llm_service/requirements-e8a.txt
ollama pull qwen3:1.7b
# Have the Ollama app or 'ollama serve' running
TWIN_STORAGE=memory npm run dev
```

`npm run dev` now starts both the **existing** Qwen room-assistant bridge at
`127.0.0.1:8011` and a separate optional **E8-A** bridge at
`127.0.0.1:8012`. Existing building assistant/Qwen room evidence and
one-month projections are unchanged. The E8-A worker calls only the dedicated
8012 endpoint; the model weights stay in local Ollama and are not committed.

Check:

```bash
curl http://127.0.0.1:8012/health
curl http://127.0.0.1:3001/api/ai/e8a/status
curl http://127.0.0.1:11434/api/tags
```

The E8-A /health response shows missing Python dependencies; the dashboard
shows **offline/not evaluated** if the worker or Ollama is unavailable.
It does not invent predictions. On a first simulator run, the historical
context is usually sparse; verified results may abstain even if screening
suggests investigation. Keep the simulation running to build usable history.

## Autonomous execution and UX

The Express monitoring worker is enabled by default. It starts checking a
short time after server startup, polls every 30 seconds, and processes **at
most one sensor at a time**, least-recently checked first. Completed results
are cached per sensor/active simulation run. New five-minute observations may
be rechecked after a four-minute cooldown. Supported continuous channels:
temperature, humidity, CO₂, light and virtual power; binary leakage can
also be screened. Occupancy presence alone is **not** interpreted as a fault.

The **Overview → Monitoring insights** panel shows a compact view. The
**AI Monitoring** page shows separate screening/verified statuses, evidence
grounding, the selected retrieval trace and repair state, with links to
the associated BIM sensor and chatbot. Original rule alerts continue to
work and are not converted into E8-A outcomes.

The **Building assistant** includes stored E8-A results in its evidence
context and, when asked about anomalies, provides a separate E8-A assessment
section. It never treats a positive screening with invalid citations as
verified; a grounded model opinion is not confirmation of a physical fault.

E8-A cache is in-memory. It resets on server restart or simulation replay ID
change, does not silently populate the existing PostgreSQL anomaly table,
and does not assert event-level metrics from E8-A research on the new website.

## Config

```env
# default true; disable expensive E8-A model inference during other work
E8A_MONITOR_ENABLED=true
E8A_BRIDGE_PORT=8012
E8A_BRIDGE_URL=http://127.0.0.1:8012
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:1.7b
```

The separate E8-A port binds to loopback only; no remote /detect endpoint is
exposed. The browser reads status via the existing backend on port 3001.
On a trusted LAN, `npm run host:lan` launches the additional Python worker
when AI hosting is enabled. Team devices do not need Ollama or Python.

## Research/quality limitations

- Original E8-A screening and verified channels, evidence retrieval and
  validators are preserved, but the **website evidence source is different**
  (live simulated 18-sensor feed rather than held-out historical research
  DuckDB). Therefore **E8-A test metrics are not website detection metrics**.
- The agentic pipeline is computationally expensive on an 8 GB M1 and does
  not guarantee a fresh conclusion for all channels at once. Last evaluation
  timestamps and pending coverage are displayed.
- The system does not predict **future fault onset**. Its task is
  classification of recent/current observed patterns; long-range numeric
  forecasting remains the on-demand Qwen room projection.
- Zero E8-A positives, missing results or an ungrounded review never prove
  that a room is normal.

## Verification

```bash
npm run build
npm run test:e8a
npm run test:ai
npm run test:alerts
```

Node and Python unit tests verify causal windowing, replay isolation,
schema/grounded-vs-screening separation, and non-fabricated data. To validate
actual inference, run a fresh simulated stream with Ollama installed and
inspect E8-A model latency and outcomes in the browser. Never infer
precision/recall for deployment without a separate labelled, blinded,
chronological evaluation.
