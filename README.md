# TwinLabs · simulation-only building digital twin

The current website uses an 18-point **synthetic Python HTTP stream**, the whole-building
IFC/XKT model, and a local Qwen3 room assistant. No physical building feed is connected.
Scene weather is decorative and does not alter the readings. The overview no longer
contains the Live twin / replay / what-if / comfort panel or a browser-random source switch.
The theme toggle remains in the header.

## Source status

The supplied dataset has been audited: 6,148,224 sensor rows, in complete 18-point
five-minute batches. `tools/dataset_replay/replay.py` now replays the actual CSV values
and timestamps from the supplied ZIP. The old SOP generator remains a legacy reference;
it is not the default feed. Fault labels are excluded from the online path. Missing values
remain unavailable, not zero. IFC room mappings remain demonstration aliases.

See **[dataset setup and operation](docs/dataset-replay.md)** and
**[architecture research and latency method](docs/http-sse-architecture.md)**.

## Run on a Mac

Requirements: Node.js 22+, Python 3.10+, Git LFS for the model files, and a WebGL 2 capable
browser for the BIM viewer. From the project folder:

```bash
git lfs pull
npm ci
# Configure DATASET_PATH in .env first; see dataset setup above.
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173/. This starts the website, API and Python assistant bridge.
It also starts dataset replay when DATASET_PATH is configured; otherwise the dashboard
waits for a source. Temporary memory resets at API shutdown. Use Control+C to stop.
Run only one publisher per API. Default replay releases five minutes of source time every
two real seconds, with no random replacement or automatic loop.

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
time is a separate measurement. The new dataset-replay preview recorded 102 acknowledged
batches out of 105: median 1.450 s, p95 1.954 s, maximum 2.000 s. Three unacknowledged
batches mean the trial is **incomplete**, so it does not establish the ≤5 s criterion.
It used temporary memory and lacked WebGL 2, not the final Mac/PostgreSQL configuration.
See [trial summary](docs/benchmarks/2026-11-05-dataset-replay-summary.json).

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
