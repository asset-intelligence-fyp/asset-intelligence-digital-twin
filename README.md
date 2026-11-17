# TwinLabs — BIM-Integrated Asset Intelligence Digital Twin

TwinLabs is a **simulation-only building digital twin prototype** combining a whole-building BIM model, 18 virtual indoor sensor channels, a calibrated hybrid Python simulator, weather/occupancy controls, automatic rule-based alerts, incident investigation, and an optional local Qwen3 assistant. Four virtual outdoor weather channels are displayed separately from the 18 indoor channels.

**No physical building/BMS stream is connected.** Sensor-to-BIM associations are demonstration mappings, and threshold alerts are synthetic rule outputs, not verified AI fault diagnoses.

## Choose how to run

| Mode | What works | Additional software |
| --- | --- | --- |
| **A. Quick local demo** | BIM viewer, sensor dashboard, hybrid simulation, weather/fault controls, automatic rule-based alerts, Events, evidence assistant, and admin login | Node.js, Python, Git LFS |
| **B. Full database mode** | Everything in A **plus** persistent sensor readings and incidents, PostgreSQL/TimescaleDB time series, and an authenticated read-only Database viewer | PostgreSQL **with TimescaleDB installed and enabled in the chosen database** |

The **Database** page cannot display PostgreSQL tables in memory mode. Logging in as admin does not automatically connect to a database.

### Prerequisites

- **Git + Git LFS**, **Node.js 22+ / npm**, **Python 3.10+**
- A modern **WebGL 2** browser (Chrome or Edge recommended for xeokit)
- Optional **PostgreSQL + TimescaleDB** for Mode B
- Optional **Ollama and `qwen3:1.7b`** for locally generated AI explanations

## 1. Clone the repository (both modes)

This repository may be private: you need GitHub access before cloning.

```bash
git clone https://github.com/asset-intelligence-fyp/asset-intelligence-digital-twin.git
cd asset-intelligence-digital-twin

git lfs install
git lfs pull
npm ci
npm run model:verify
```

`git lfs pull` downloads the real BIM geometry rather than leaving Git LFS pointer files. `npm run model:verify` checks the model asset. If using a ZIP instead of Git, make sure the complete LFS-managed model was included.

## 2A. Quick local demo — no PostgreSQL installation

From the repository root, generate **your own local administrator credentials**:

```bash
npm run admin:setup
```

The command safely creates or updates the Git-ignored `.env` file, prints **Username: admin** and a **new random password once**, and preserves existing database/simulator settings. Save that password privately. Never enter the generated hash as the password.

Start TwinLabs in temporary-memory mode:

**macOS / Linux**

```bash
TWIN_STORAGE=memory npm run dev
```

**Windows PowerShell**

```powershell
$env:TWIN_STORAGE = "memory"
npm run dev
```

Open **http://localhost:5173** (or the local URL printed by Vite).

`npm run dev` starts the **React/Vite website** (normally port 5173), **Express sensor API** (3001), **Python assistant bridge** (8011), and the **hybrid Python simulator**. One simulator publishes 18 indoor channels per generated batch. Stop the process with **Ctrl+C**.

Log in using the **Login** button at the top right with username `admin` and your locally generated password. The Database navigation entry appears, but table browsing will correctly say **“Configure PostgreSQL first”** until Mode B is configured.

**Important:** Sensor readings, generated rule alerts, and acknowledgements in memory mode are lost when the API stops. This is expected.

For macOS, `Open_TwinLabs.command` is a convenience launcher for **memory mode only**; it does not enable database persistence.

## 2B. Full PostgreSQL + TimescaleDB mode

Use this mode to demonstrate the administrator's database tables, durable readings, and the TimescaleDB hypertable.

### B1. Create a local PostgreSQL database

Install/start a compatible PostgreSQL server and **TimescaleDB extension** on the computer running the app. Installation is operating-system-specific; the PostgreSQL server, roles, and databases are **not included** in a Git clone.

Use an **existing PostgreSQL role that actually exists on your computer**. Do not assume the role is named `postgres`. On some macOS installations it is the local username; Windows and other installations may differ.

Check your role and existing databases in `psql` or pgAdmin:

```sql
SELECT current_user, current_database();
SELECT datname FROM pg_database WHERE datistemplate = false;
```

For a **fresh, empty** database, create a database named `twinlabs_demo` through pgAdmin or with a suitably privileged PostgreSQL role:

```bash
createdb -U YOUR_EXISTING_POSTGRES_ROLE twinlabs_demo
```

Replace `YOUR_EXISTING_POSTGRES_ROLE` with the actual role. **Do not run this against an existing database or delete existing data.** If you prefer an existing development database, back it up first and use its actual name instead.

Enable TimescaleDB **inside that database**, using an account authorised to create extensions:

```bash
psql -U YOUR_EXISTING_POSTGRES_ROLE -d twinlabs_demo -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

TimescaleDB must already be installed on the PostgreSQL server. Confirm the extension is enabled in `twinlabs_demo` (it is enabled per database, not globally):

```bash
psql -U YOUR_EXISTING_POSTGRES_ROLE -d twinlabs_demo -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb';"
```

An available-but-not-installed extension is **not** enough: the query above must return a version. If the command fails due to permissions or installation, use your PostgreSQL administrator/pgAdmin to finish setup before continuing.

### B2. Set up your local `.env`

If `.env` does not exist, copy `.env.example`. **Do not overwrite an existing `.env`**, especially after running `npm run admin:setup`.

**macOS / Linux**

```bash
test -f .env || cp .env.example .env
```

**Windows PowerShell**

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` with your **own** PostgreSQL connection details:

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=twinlabs_demo
PGUSER=YOUR_EXISTING_POSTGRES_ROLE
# PGPASSWORD=YOUR_LOCAL_POSTGRES_PASSWORD  # only if required

TWIN_DB_SCHEMA=digital_twin
SIMULATOR_MODE=hybrid
SIM_INTERVAL_SECONDS=5
SIM_STEP_SECONDS=5
```

- `PGUSER` is a **PostgreSQL database role**, not the website's admin username.
- If your role requires a password, set `PGPASSWORD` to its actual local password. If it does not, leave `PGPASSWORD` **unset** rather than using a placeholder.
- `DATABASE_URL`, if exported or set, takes precedence over the individual `PG*` settings.
- Keep the locally generated `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` lines from `npm run admin:setup`. They are **different credentials** from PostgreSQL.
- **Do not set `TWIN_STORAGE=memory`** in `.env` or the shell for Mode B.

If you have not created the admin account yet, run `npm run admin:setup` now; it preserves the database settings just entered.

### B3. Initialize, verify, and start

Back up a populated database before schema updates. The current v3 setup is additive; **do not run the legacy `database/postgres_init.sql` against an existing database**, as it contains destructive historical initialization.

If you previously ran Mode A, stop that server first (**Ctrl+C**), then clear any terminal-only memory override:

**macOS / Linux**

```bash
unset TWIN_STORAGE
```

**Windows PowerShell**

```powershell
Remove-Item Env:TWIN_STORAGE -ErrorAction SilentlyContinue
```

Then run:

```bash
npm run db:setup:v3
npm run db:check
npm run dev
```

`npm run db:setup:v3` creates/updates the `digital_twin` schema, registers **18 sensors across five locations**, and configures the TimescaleDB `digital_twin.sensor_readings` hypertable. It does not import another person's data or copy the legacy `twin18` history.

`npm run db:check` should show fields similar to:

```json
{
  "schema": "digital_twin",
  "sensors": 18,
  "timescaledb_version": "2.x",
  "readings_hypertable": true
}
```

The version printed depends on your installed TimescaleDB. `readings: 0` and `alerts: 0` are normal on a fresh database until the simulator produces events.

Visit **http://localhost:3001/api/health** and confirm `storage` is `postgresql`, `schema` is `digital_twin`, and `timescale.hypertable` is `true`.

Open the website at **http://localhost:5173**, log in with your local **admin** password, then choose **Database**. You should see the seeded registry and time-series readings as the simulator runs. Login succeeds independently from database connection, so if the Database page says “Configure PostgreSQL first”, verify you really stopped Mode A and started without `TWIN_STORAGE=memory`.

**Existing database:** If you use a pre-existing PostgreSQL database, inspect and back it up first; choose its actual database name and role in `.env`. Do not create/rename/destroy databases just to match the examples above. The SQL schema is reproducible, but Amanda's historical stored readings are **not part of the GitHub repository**.

For details, see [database architecture](docs/unified-database-v3.md) and [local administrator setup](docs/admin-teacher-setup.md).

## 3. Administrator login and verification

For either mode:

```bash
npm run admin:setup
```

This generates a new password and writes a matching **salted scrypt verifier** to the Git-ignored `.env`. **Restart `npm run dev` after changing credentials.** Never commit either the password or a teammate's hash.

Once the app is running, open **http://localhost:5173 → Login** and enter `admin` with your generated password.

To verify the actual API login/session from **a second terminal**, in the project directory run:

```bash
npm run admin:check
npm run admin:check -- --verify-login
```

The second command prompts for the password without echoing it, checks the session cookie, and reports whether authenticated database views can be queried. Logging in can work in Mode A while database queries correctly remain unavailable.

The viewer is read-only. Its local authentication and eight-hour in-memory sessions are for the prototype, not a production identity service.

## 4. Optional local Qwen3 AI

To enable generated building explanations, install/start [Ollama](https://ollama.com) on the same computer and pull the model:

```bash
ollama pull qwen3:1.7b
# If Ollama is not already running, start its app or run:
ollama serve
```

The default model endpoint is `http://127.0.0.1:11434`; the Python bridge starts with `npm run dev` at `http://127.0.0.1:8011`. Check the API at:

```bash
curl http://localhost:3001/api/assistant/building/health
```

The **Building evidence** workflow can produce a labelled deterministic summary when Ollama is unavailable. Some **Qwen room analysis and one-month forecasting** functions additionally require a separate normal-history SQLite file configured via `LLM_HISTORY_DB`; that dataset is not included in Git. Model output is explanatory decision support, **not** a confirmed sensor fault diagnosis. No benchmarked iterative Agentic RAG capability is claimed.

See [AI integration details](docs/whole-building-llm.md).

## 5. Walk through the website

1. **System status:** Verify up to 18/18 indoor channels reporting and check storage mode.
2. **Building overview:** Open the BIM model, select floor/location/sensor, and inspect virtual readings.
3. **Simulation lab:** Change weather, occupancy, ventilation, AC, or choose preset scenarios. Weather affects generated readings; rain by itself does **not** cause a water-leak alarm.
4. **Generate a test alert:** In abnormal-sensor testing, select **Toilet → Water leakage → Leak → Start test** and wait for the next simulated batch.
5. **Events:** Open the notification bell or Event log, inspect the automatically recorded **rule-based synthetic** alert, view retained readings, open the BIM sensor, and acknowledge it.
6. **Recovery:** Stop the injected fault. A later normal reading marks recovery; acknowledgement and recovery are separate.
7. **AI assistant:** Ask about recent sensor evidence and previous incidents. Generated Qwen explanations require Ollama; fallback evidence summaries do not.

The manual **Create an event record** control is for UI testing, not evidence of automatic anomaly detection. External email/SMS/push notifications are not configured. [Detailed walkthrough](docs/working-website-guide.md).

### Presentation refresh (development branch)
The header's persistent **Light / Dark** toggle, styled IFC façade, conceptual landscaped site, clearer X-ray floor guides and recognizable low-poly occupants are described in [the presentation guide](docs/presentation-refresh.md). Landscaping is **illustrative**; people are display proxies, not tracked individuals.

### Experimental clock, A/B comparison, heatmap and occupants (development branch)

In the updated **Simulation lab**, you can set a synthetic start date/time, select a working-day or holiday schedule, and start a new isolated simulation run. The **Scenario Experiment Workspace** compares matched one-hour runs without publishing experiment readings. In the BIM viewer, **Heatmap** colours available IFC room footprints; **People** and **Walking** display optional illustrative avatars driven by virtual headcounts. The current Building Performance page shows real units and changes instead of arbitrary percentage bars.

These features are prototype visualisations, not measured physical occupancy or validated causal building models. See [UI fixes and experiment guide](docs/simulation-experiments.md).

## 6. Build and checks

```bash
npm run build
npm test
npm run test:admin
npm run test:alerts
npm run test:ai
python3 -m unittest discover -s tests -p 'test_*.py'
npm run model:verify
# Mode B only, when the database is configured:
npm run db:check
```

Some tests use mocked model responses or PostgreSQL-compatible test engines; they do **not** by themselves validate a real TimescaleDB server, physical telemetry, or local Ollama inference. Demonstrate and verify those components on the target computer.

## 7. Troubleshooting

| Symptom | Likely cause / next step |
| --- | --- |
| `npm run admin:setup` says missing script | The local checkout is old. Clone the current default `main` branch or update the checkout after preserving your local changes. |
| `role "postgres" does not exist` | Your computer uses a different PostgreSQL username. Check `SELECT current_user` and update `PGUSER`; do not assume `postgres`. |
| PostgreSQL password authentication failed | Verify local `PGUSER`/`PGPASSWORD` or `DATABASE_URL`. These are **not** admin login credentials. |
| TimescaleDB is available but `timescaledb_version` is null | Enable the extension **in the selected database**, then rerun `npm run db:setup:v3`. |
| `relation digital_twin.sensor_registry does not exist` | Check the target database and then run `npm run db:setup:v3` after backing up an existing DB. |
| Admin login succeeds, Database says “Configure PostgreSQL first” | You started with `TWIN_STORAGE=memory`. Stop the app, clear the override, verify `.env` and use Mode B. |
| Invalid admin credentials | Use the **plaintext password displayed by `npm run admin:setup`**, not the hash. If lost, rerun setup and restart the server. |
| BIM model does not load | Run `git lfs pull` and `npm run model:verify` and use a WebGL 2-capable browser. |
| Port 5173, 3001, or 8011 already in use | Stop duplicate TwinLabs processes before launching another copy. |
| AI uses a fallback | Confirm Ollama is running with `qwen3:1.7b`; some research tools also need `LLM_HISTORY_DB`. |

## 8. Source layout and limitations

| Location | Purpose |
| --- | --- |
| `src/` | React dashboard, xeokit viewer, simulation controls, Event log, AI and database UI |
| `server/sensorServer.js` | Active Node API: HTTP ingestion, SSE, database writes and live monitoring |
| `server/alertService.js` | Prototype threshold alerts, persistence, recovery and acknowledgement |
| `tools/hybrid_simulator/` | Generated sensor readings, weather and intervention logic |
| `llm_service/` | Python bridge and Qwen room/prediction research logic |
| `shared/` | Canonical 18-point registry and demonstration sensor definitions |
| `database/schema_v3.sql` | Unified PostgreSQL tables |
| `scripts/setup-v3.mjs` | Database setup and TimescaleDB hypertable |
| `tests/` | JavaScript/Python integration and unit tests |
| `docs/` | Architecture, setup guides and evaluation methodology |

TwinLabs is a research proof of concept. The 18 sensors and four weather channels are simulated, spatial mappings are demonstration aliases, and rule alerts are not AI detections. Unimplemented features include physical BMS ingestion, external incident notifications, complete Qwen result/forecast persistence, and production identity management. Historical accuracy and latency research should not be presented as independently verified performance of this entire integrated application.

**Local secrets:** `.env` and private datasets are ignored by Git. Never publish passwords, local database dumps containing personal information, or the password verifier.