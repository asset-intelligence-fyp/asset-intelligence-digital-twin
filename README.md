# TwinLabs · simulation-only building digital twin

The current website uses an 18-point **synthetic Python HTTP stream**, the whole-building
IFC/XKT model, and a local Qwen3 room assistant. No physical building feed is connected.
Generated outdoor weather drives the simulator; optional scene-only previews are decorative. The overview no longer
contains the Live twin / replay / what-if / comfort panel or a browser-random source switch.
The theme toggle remains in the header.

## Current workspace

The atmosphere toolbar is removed. X-ray and heatmap remain. The six labelled pages are
Building overview (with asset register), Sensors & trends, Events, AI assistant,
Simulation lab and System status. Generation controls belong in the lab; monitoring pages
show their effects. See [workspace guide](docs/workspace-cleanup.md) for controls, weather
coupling, event investigation and the building-wide evidence assistant.

## Source status

The default is now a **calibrated hybrid simulator** that generates NEW synthetic
observations, rather than replaying dataset rows. It uses aggregate normal 2023–2024
patterns, independent normal 2025 regression diagnostics, stateful weather/room dynamics,
Sarawak holidays and seeded variation. The fitted profile is included; no dataset ZIP
or weather website is required to run it. Four virtual outdoor channels are shown separately
from the existing 18 IFC-linked indoor channels.

Start with **[hybrid simulator setup, weather and holidays](docs/hybrid-simulator.md)**.
Exact **[dataset replay](docs/dataset-replay.md)** remains an explicitly selected testing
mode. IFC mappings remain demonstration aliases; neither transport nor calibration proves
physical building fidelity or AI accuracy.

## Run on a Mac

Requirements: Node.js 22+, Python 3.10+, Git LFS for the model files, and a WebGL 2 capable
browser for the BIM viewer. From the project folder:

```bash
git lfs pull
npm ci
# Set SIMULATOR_MODE=hybrid in .env (the default).
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173/. This starts the website, API and Python assistant bridge.
It also starts the hybrid simulator by default. A fresh seed creates a different run.
Default simulation step and release interval are both five seconds. Use SIM_STEP_SECONDS=300
and SIM_INTERVAL_SECONDS=2 for an explicitly accelerated demonstration. Stop with Control+C.
Run one publisher per API. Temporary memory resets at API shutdown.

The Overview shows read-only virtual weather. Simulation lab changes generated weather,
attendance, AC, ventilation and manual measurement faults. The scene follows the generated weather. Holidays use Malaysia dates, not UTC dates. See the setup guide for calendar
coverage and manual demonstration overrides.

For local Qwen inference, run Ollama and download `qwen3:1.7b`. Defaults are
`http://127.0.0.1:11434` for Ollama and `http://127.0.0.1:8011` for the bridge.
The active server is `server/sensorServer.js`; older `server/index.js` and `/api/ai/*`
modules are legacy references. See [current assistant setup](docs/whole-building-llm.md).
Known chatbot grounding/validation limitations remain outstanding.

## Persistent PostgreSQL

Keep existing databases unchanged. Create a separate `digital_twin_18` database, configure
`.env` from `.env.example`, and run `npm run db:setup` before `npm run dev`. Do not force
`TWIN_STORAGE=memory` for a persistence run. Setup creates the additive `twin18` schema.
Keep real credentials and local SQLite references out of Git. The benchmark identifies
whether storage is temporary memory or PostgreSQL.

## Benchmarks and acceptance

Open **Simulator** for source-to-browser latency. Start a fresh measurement run, keep one
browser tab visible for at least 30 complete batches, and download the result. AI response
time is a separate measurement. The earlier dataset-replay preview recorded 102 acknowledged
batches out of 105: median 1.450 s, p95 1.954 s, maximum 2.000 s. Three unacknowledged
batches mean the trial is **incomplete**, so it does not establish the ≤5 s criterion.
It used temporary memory and lacked WebGL 2, not the final Mac/PostgreSQL configuration.
These are not hybrid-generator latency results. See [trial summary](docs/benchmarks/2026-11-05-dataset-replay-summary.json).

AI accuracy is **not measured**. The brief requires ≥85% anomaly accuracy against logged
maintenance events. The evaluator needs frozen, independently labelled held-out cases;
synthetic injection results must be reported separately and require agreement if replacing
the maintenance-event basis. Tests and fluent answers do not establish model accuracy.

See [measurement method, source handoff and evaluation commands](docs/performance-evaluation.md)
and [recorded preview samples](docs/benchmarks/2026-11-04-preview-latency.json).

## Verification and model mapping

```bash
npm run build
npm test
node --test tests/datasetStream.test.mjs tests/latencyMetrics.test.mjs tests/velvetUI.test.mjs tests/roomAssistantValidated.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

[Whole-building mapping and geometry](docs/whole-building-integration.md) ·
[Velvet UI integration](docs/velvet-ui-integration.md).
Model assets remain in `public/models/FYP_WholeBuilding_18Sensors.xkt` and
`public/models/FYP_WholeBuilding_18Sensors.ifc.gz`, managed by Git LFS. No BIM geometry
or original sensor IDs were renamed by the simulation/benchmark update.

## Qwen3 1.7B room AI and one-month prediction (Velvet UI)

The AI assistant page and floating panel retain the existing building-evidence view
and add a **Qwen room AI + 1-month forecast** tab. This connects the latest
validated room anomaly assessment and Qwen-generated one-month forecasts without
replacing Velvet's simulator or dashboard. See
[Velvet AI integration](docs/velvet-llm-integration.md) and
[LLM evaluation methodology](README_LLM_RESEARCH_EVALUATION.md).
