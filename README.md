# TwinLabs — Asset Intelligence Digital Twin
**COS40005 Computing Technology Project A · Alpha research prototype · November 2026**

TwinLabs is a **simulation-only BIM-integrated building monitoring proof of concept**. It displays an IFC/XKT office-building model with **18 indoor virtual sensor channels across five monitoring locations**, a calibrated hybrid Python simulator, interactive operating-condition and fault controls, automatic **rule-based** sensor alerts, incident investigation, and a local Qwen3 AI assistant. Four virtual outdoor weather channels provide environmental context. **No physical building sensors, BMS connection or independently verified fault diagnosis are claimed.**

> **Start here:** Use the quick start below for an evaluation without a database. For persistent PostgreSQL + TimescaleDB, follow the separate database setup. The application's actual storage mode is reported by `/api/health`; repository SQL files do **not** prove that TimescaleDB is installed on your computer.

## Requirements

- **Node.js 22+**, npm, **Python 3.10+**, and Git LFS
- A WebGL 2-capable browser (Chrome or Edge recommended for the xeokit BIM viewer)
- **Optional:** Ollama with the local `qwen3:1.7b` model for generated explanations and room analysis
- **Optional:** PostgreSQL with the TimescaleDB extension for durable sensor readings and alerts

**Git LFS is required for the BIM assets.** After cloning, execute `git lfs pull`. Do not replace an XKT or IFC file with its text LFS pointer.

## 1. Quick start: working simulation without a database

From the repository root:

```bash
git lfs pull
npm ci
TWIN_STORAGE=memory npm run dev
```

Open **http://localhost:5173** (the Vite terminal shows the actual URL).

The dev command launches the **Node/Express API (3001)**, **React/Vite UI (5173)**, **Python AI bridge (8011)**, and **hybrid synthetic simulator**. Memory mode is suitable for a self-contained presentation, but readings, alerts and acknowledgements **reset on API restart**. The core BIM/simulator/alerts functions do not require Ollama. The Qwen-specific functionality requires a reachable model and, for historical room comparisons, the separate local historical database.

On macOS, `Open_TwinLabs.command` provides a memory-mode launcher. Its convenience mode is **not** evidence of PostgreSQL persistence.

## 2. Persistent PostgreSQL + TimescaleDB mode

**Back up any existing database first.** The repository retains older SQL scripts for research history; **do not run** `database/postgres_init.sql` against a populated database because it drops/recreates legacy tables.

1. Install and start PostgreSQL, and install/enable a compatible **TimescaleDB extension in the selected database**. Create a **development database** if necessary; `digital_twin_18` is only an example name.
2. Copy `.env.example` to an untracked `.env`. Configure `PGHOST`, `PGPORT`, `PGDATABASE`, and local `PGUSER`/`PGPASSWORD` if needed. Alternatively set `DATABASE_URL`, which takes precedence. Set `TWIN_DB_SCHEMA=digital_twin`. **Do not set `TWIN_STORAGE=memory`** in the shell or `.env`.
3. Set up the additive v3 schema and verify the running database:

```bash
cp .env.example .env
# Edit .env for YOUR local PostgreSQL instance. Never commit it.
npm ci
npm run db:setup:v3
npm run db:check
npm run build
npm run dev
```

`npm run db:check` should report `schema: "digital_twin"`, `sensors: 18`, a non-null `timescaledb_version`, and `readings_hypertable: true`. On a fresh database, `readings: 0` and `alerts: 0` are expected until the simulator sends data. Also check **http://localhost:3001/api/health** and **System status** in the UI. Those checks are needed on the actual evaluation machine; CI tests cannot establish that your local TimescaleDB server is installed.

The unified `digital_twin` schema keeps `twin18` and historical `public` tables untouched. Data are **not automatically copied** between schemas. For a PostgreSQL-only compatibility demonstration without TimescaleDB, `TWIN_DB_SCHEMA=twin18` with `npm run db:setup` remains supported; do not call this TimescaleDB mode.

## 3. Demonstrate the complete working flow

1. Open **System status** and verify active telemetry (up to 18/18 indoor channels); confirm the reported storage/schema.
2. Open **Building overview** to navigate the BIM viewer, use X-ray/floor controls, and inspect selected sensors and assets.
3. Open **Simulation lab**. Use **Normal day**, **Rainy day**, **Public holiday**, or **Busy building**, or adjust weather, attendance, AC, ventilation and simulation pace. These alter **generated** conditions; rain alone never means an indoor water leak.
4. For a reliable alert test, select **Toilet → Water leakage → Leak → Start test**. Keep the simulator unpaused; allow the next batch to arrive.
5. Click the **bell / Event log**. The Node backend evaluates defined sensor thresholds and creates an automatic **synthetic rule alert**, preserving trigger evidence and preceding readings. Open the record, use **View in twin**, and **Acknowledge** it.
6. Return to **Simulation lab → Stop fault**. The next qualifying normal reading marks recovery; acknowledgement and recovery are distinct.
7. Open **AI assistant**. **Building evidence** retrieves readings and incident records and can show a deterministic evidence fallback without Ollama. **Qwen room AI** and one-month prediction require a configured AI runtime and valid historical inputs.

A separate **Create an event record** action is for manual UI testing, **not** an automatically detected fault. Alerts are currently **in-app**; email, SMS and push notifications are not implemented.

See [full demo walkthrough](docs/working-website-guide.md) and the in-app **How to use** page.

## 4. Optional local Qwen3 assistant

Install Ollama, start the Ollama service, then:

```bash
ollama pull qwen3:1.7b
# In another terminal, if the Ollama application is not already running:
ollama serve
```

`npm run dev` starts `llm_service/bridge.py`. Default connections are `OLLAMA_URL=http://127.0.0.1:11434` and `LLM_BRIDGE_URL=http://127.0.0.1:8011`. The historical Qwen experiments additionally use a **separate local normal-history SQLite file** referenced by `LLM_HISTORY_DB`; this file is intentionally excluded from Git. The unified PostgreSQL schema does **not** automatically replace that research reference.

```bash
python3 scripts/check_llm_history.py
curl http://localhost:3001/api/assistant/building/health
```

A generated explanation is decision-support text, not a validated diagnosis. If the model is missing, unreachable, too slow or returns unsupported content, the building-evidence path shows a labelled fallback. Neither the current retrieval system nor the fixed-route room assistant should be described as a completed/benchmarked **iterative Agentic RAG** implementation. See [current AI integration](docs/whole-building-llm.md) and [research evaluation procedures](README_LLM_RESEARCH_EVALUATION.md).

## 5. Administrator database viewer

The authenticated **Database** page is available after setting `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` in the local `.env`. Generate a hash using:

```bash
node scripts/generate-admin-hash.mjs
```

The current admin viewer is **read-only**, and its login uses locally configured credentials/in-memory sessions, not the future `digital_twin.users` table. It can inspect the available building, location, sensor, readings, AI, alert and maintenance tables in the selected schema. Some result tables remain empty until their application workflow is implemented. See [database schema details](docs/unified-database-v3.md) and [admin setup](docs/amanda-admin-setup.md).

## 6. Verification

```bash
npm run build
npm test
npm run test:ai
npm run test:alerts
npm run model:verify            # requires downloaded Git LFS BIM model
python3 -m unittest discover -s tests -p 'test_*.py'
npm run db:check                # PostgreSQL/TimescaleDB mode only
```

Tests include synthetic HTTP/SSE ingestion, simulator contracts, navigation, deterministic alert creation, evidence, acknowledgement, recovery, and AI bridge contracts. Mocked model outputs and PGlite SQL compatibility **do not** prove performance against physical building data, actual local Ollama inference, or TimescaleDB runtime installation. For prior recorded tests and limitations, see [integration verification](docs/integration-verification.md).

## 7. Repository layout

| Directory | Purpose |
| --- | --- |
| `src/` | React monitoring, BIM viewer, Simulator, Events, Assistant, admin interface |
| `server/sensorServer.js` | **Active** Node API, sensor ingestion, SSE, persistence and rule alerts |
| `server/alertService.js` | Rule-based incident creation, recovery and acknowledgement |
| `tools/hybrid_simulator/` | Calibrated synthetic generator and fault controls |
| `llm_service/` | Local Python Qwen bridge, validated room analysis and predictions |
| `shared/` | 18-point registry and demonstration sensor definitions |
| `database/schema_v3.sql` | Unified additive PostgreSQL v3 schema |
| `scripts/setup-v3.mjs` | v3 metadata seed, TimescaleDB hypertable and database change notifications |
| `tests/` | JavaScript and Python regression/integration tests |
| `docs/` | Setup, system design, experiments, and limitations |

`server/index.js` and historical Level 5 documentation remain as **legacy references**; the running whole-building application is `server/sensorServer.js`. Do not start both backend servers for one demo.

## 8. Scope and limitations

- **Synthetic PoC only:** 18 virtual indoor channels and 4 virtual outdoor channels; BIM sensor mapping contains demonstration aliases, not verified physical installations.
- **Threshold alerts:** Automatically generated from synthetic sensor measurements; they are **not Qwen or Agentic RAG detections**. Bounds are prototype rules, not certified safety limits.
- **Experimental AI:** Historical forecasting and labelled anomaly results relate to their stated research datasets and protocols, not automatically to the current 18-sensor production-like UI. Do not transfer old accuracy scores to the integrated website.
- **Performance:** A prior incomplete replay benchmark and code-level tests do **not** certify the five-second synchronisation or 85% anomaly-accuracy requirements. Record new measurements and independent ground truth.
- **Unfinished integration:** AI-generated result/forecast persistence, Agentic RAG iteration, external notifications, production-grade auth/security and live BMS integration remain future work.
- **Security:** Keep `.env`, API keys, PostgreSQL credentials, private test labels and local SQLite history out of Git. Do not expose the local prototype or Ollama ports publicly.

**Submission:** The complete Alpha release is maintained on the repository's default `main` branch and the snapshot branch `release/alpha-submission-2026`; original development branches are preserved for traceability.
