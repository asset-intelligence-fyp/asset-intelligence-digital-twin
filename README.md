# TwinLabs · simulation-only building digital twin

The current website uses an 18-point **synthetic Python HTTP stream**, the whole-building
IFC/XKT model, and a local Qwen3 room assistant. No physical building feed is connected.
Scene weather is decorative and does not alter the readings. The overview no longer
contains the Live twin / replay / what-if / comfort panel or a browser-random source switch.
The theme toggle remains in the header.

## Source status

The intended teammate simulator and dataset have **not yet been supplied or verified**.
The bundled `tools/level03_simulator` is a provisional SOP v1.4 generator with configurable
assumptions, not a verified replay of the teammate's dataset. Do not claim dataset fidelity.
The five IFC locations and 18 canonical point mappings retain their documented demonstration
aliases; PIR represents presence, and virtual power is an illustrative aggregate.

## Run on a Mac

Requirements: Node.js 22+, Python 3.9+, Git LFS for the model files, and a WebGL 2 capable
browser for the BIM viewer. From the project folder:

```bash
git lfs pull
npm ci
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173/. This starts the website, API, Python assistant bridge and
bundled simulator. Temporary memory resets when the API stops. Generated CSV/JSON output
is saved in ignored `runtime/simulator`; previously tracked simulator files are not changed.
Use Control+C to stop. Do not start a second publisher at the same time.

The simulator sends a batch every five real seconds and advances simulation time by one
minute per batch. `normal` mode injects no faults. Select controlled injected scenarios
with `SIM_FAULT_MODE=demo` or sparse faults with `SIM_FAULT_MODE=live` before starting;
these are synthetic modes, not real sensor measurements. To use a teammate publisher,
set `SIMULATOR_AUTOSTART=false` and start its adapter separately after validating IDs/units.

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
time is a separate measurement. A preview trial of 40 batches had a 5.392 s p95 and
6.037 s maximum conservative upper bound; **it did not establish the ≤5 s target**.
It used temporary memory and lacked WebGL 2, not the final Mac/PostgreSQL configuration.

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
node --test tests/latencyMetrics.test.mjs tests/velvetUI.test.mjs tests/roomAssistantValidated.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

[Whole-building mapping and geometry](docs/whole-building-integration.md) ·
[Velvet UI integration](docs/velvet-ui-integration.md).
Model assets remain in `public/models/FYP_WholeBuilding_18Sensors.xkt` and
`public/models/FYP_WholeBuilding_18Sensors.ifc.gz`, managed by Git LFS. No BIM geometry
or original sensor IDs were renamed by the simulation/benchmark update.
