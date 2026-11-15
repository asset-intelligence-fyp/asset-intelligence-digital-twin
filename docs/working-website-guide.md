# Run and demonstrate TwinLabs

This is the companion walkthrough for the integrated **main** branch. It contains details of the 18-point synthetic simulator, persistent rule-based alert evidence, and the local Qwen assistant. **Begin with the [README](../README.md)** for complete Mac, Linux, Windows, and PostgreSQL/TimescaleDB instructions.

**Administrator access:** Run `npm run admin:setup` locally to generate the password, then restart the API. Use `npm run admin:check -- --verify-login` to check an authenticated session and the availability of the database page. Admin login can work even when PostgreSQL is not configured. See [administrator setup](admin-teacher-setup.md).

## Clone and launch

For a new checkout (requires access to the repository, Node.js 22+, Python 3.10+, and Git LFS):

```bash
git clone https://github.com/asset-intelligence-fyp/asset-intelligence-digital-twin.git
cd asset-intelligence-digital-twin
git lfs install
git lfs pull
npm ci
npm run admin:setup
TWIN_STORAGE=memory npm run dev
```

On Windows PowerShell, use `$env:TWIN_STORAGE = "memory"` followed by `npm run dev` instead of the Unix-style environment prefix. Open **http://localhost:5173**. The complete BIM model requires Git LFS; use `npm run model:verify` if it fails to load.

If you already have a working checkout on another branch, **do not force-reset or overwrite it**. Check `git status -sb`, preserve local changes, and use a fresh clone or a separate Git worktree from `origin/main` if the histories have diverged.

## Enable PostgreSQL + TimescaleDB

The Git repository includes the SQL schema and 18-point registry seed, **not another teammate's running database or credentials**. PostgreSQL and TimescaleDB must be installed on the local evaluation computer, and the extension must be enabled in the chosen database.

Configure the local, Git-ignored `.env` with your actual PostgreSQL database and role (do not assume `postgres` is an existing role):

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=YOUR_EXISTING_OR_NEW_DATABASE
PGUSER=YOUR_ACTUAL_POSTGRES_ROLE
# PGPASSWORD=YOUR_LOCAL_PASSWORD_IF_REQUIRED
TWIN_DB_SCHEMA=digital_twin
SIMULATOR_MODE=hybrid
SIM_INTERVAL_SECONDS=5
SIM_STEP_SECONDS=5
```

Keep the generated `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`; they are separate from database authentication. Back up an existing database before schema changes, and never run the legacy destructive `database/postgres_init.sql` on populated data.

Stop the memory-mode server, remove `TWIN_STORAGE=memory` from the shell and `.env`, and verify TimescaleDB is installed **in the selected database**. For a new local PostgreSQL instance, follow [README `2B](../README.md#2b-full-postgresql--timescaledb-mode) for database creation and extension setup.

```bash
npm run db:setup:v3
npm run db:check
npm run dev
```

The database checker should report `schema: "digital_twin"`, `sensors: 18`, a TimescaleDB version, and `readings_hypertable: true`. The website's System status and `http://localhost:3001/api/health` report the active storage. In-memory readings/alerts reset on restart; PostgreSQL records persist.

The v3 script is additive and rerunnable, but it does **not** copy historical readings from the older `twin18` tables. If the Database page says “Configure PostgreSQL first”, the server is still running in memory mode or its database configuration is not active.

## Demonstrate a complete incident

1. Open **System status**, confirm 18/18 channels are arriving, and confirm your storage mode. The in-app **How to use** page explains the workflow.
2. Wait for at least five batches so preceding readings are available.
3. Open **Simulation lab → Abnormal sensor test**. Select **Toilet → Water leakage → Leak**, then **Start test**. One delivery interval is normally five real seconds. Pause must be off.
4. The API evaluates the delivered reading and creates a **Critical** rule alert. The bell badge and recent activity update automatically.
5. Click the **bell → alert**. Inspect the affected sensor, trigger time, retained evidence chart and table. Up to five preceding observations plus the trigger observation are saved.
6. Click **View in twin**. The corresponding sensor/location is selected, and the incident evidence remains above the live view. The building's live values may have changed since the incident.
7. Click **Acknowledge** in the Event Log. With PostgreSQL, it persists across reloads and API restarts. Acknowledgement does not clear an ongoing abnormal condition.
8. Return to **Simulation lab → Stop fault**. The next normal reading marks the condition recovered. A later recurrence creates a new incident.
9. Send an AI question about the sensor. The answer separates current assessment, next checks, supporting evidence, and limitations; sensor links return to the model.

A repeated high reading does not create a new event on every batch. Acknowledged active incidents remain the same incident. Recovery and acknowledgement are distinct states. Missing readings create data-quality alerts; an absent network stream is shown by reporting coverage and is not currently a separate silence alert. Threshold alarms are immediate, with no persistence duration or hysteresis, so noisy readings near a bound can create multiple recovered/recurrent incidents.

Small drift, stuck values and valid occupancy changes may not breach a rule; they are not guaranteed alarm tests. A **Missing** test is another reliable demonstration. The **Create an event record** link remains a separate manual UI test and does not establish automatic detection.

## Sensor definitions and alert policy

The canonical 18-point registry is `shared/sensorRegistry.json`. `shared/sensorDefinitions.json` defines measurement meanings, accepted numeric ranges and prototype alert bounds. **Sensor monitoring** displays these definitions and the original simulator/BIM aliases.

| Measurement | Meaning | Demonstration alarm |
| --- | --- | --- |
| Temperature | Air temperature, °C | Below 16 or above 30; critical at or above 35 |
| Humidity | Relative humidity, %RH | Below 25 or above 75; critical at or above 90 |
| CO₂ | Concentration, ppm | Above 1200; critical at or above 2000 |
| Power | Instantaneous virtual power, kW | Above 8; critical at or above 12 |
| Water leakage | 0 dry, 1 leak flag | 1 triggers critical |
| Occupancy | 0 vacant, 1 presence | No numeric threshold alert |
| Light | Illuminance, lux | No numeric threshold alert |
| Missing | Explicit source NULL/missing quality | Warning for any channel |

These are editable demonstration thresholds, not client-approved operating limits or certified safety limits. The detector does not read private injected-fault labels. Room mapping remains a demonstration alias, not a verified installed sensor survey. The virtual outdoor weather station is separate from the 18 indoor channels.

## Chatbot and local Qwen

- **Building evidence** retrieves current-run readings and persisted rule alerts. It computes numeric trends and binary state transitions, then asks Qwen to explain implications and suggest checks. If Ollama is unavailable or the explanation fails reference/format checks, the stored-evidence summary remains available and is labelled as a fallback.
- **Qwen room AI** needs local Ollama/Qwen and the Python bridge. Historical comparisons additionally need the configured normal-history SQLite reference; that database has not been silently replaced with PostgreSQL.
- Start Ollama as usual and ensure `qwen3:1.7b` is installed. Existing `OLLAMA_URL`, `LLM_BRIDGE_URL` and `LLM_HISTORY_DB` settings remain supported.
- Enter sends, Shift+Enter inserts a line. Replies safely render headings, paragraphs, numbered/bullet lists, bold text and inline code. Inline source references open the sensor or incident; full sources are collapsed by default. MYT timestamps and a recent-history selector keep observation time and retrieval coverage visible. Raw model HTML is not executed.
- **Ask about this sensor** uses the current sensor history. The assistant now retrieves matching persisted alerts, including their retained trigger observations, alongside current history. Earlier simulation runs are explicitly labelled; an ended alert is not proof of a physical repair. This does not change the chatbot's current-history cutoff to the incident time.

## Verification and limits

```bash
npm run build
npm test
npm run test:ai
npm run test:alerts
npm run db:check
```

The added alert tests cover memory mode and PostgreSQL-compatible execution for both `twin18` and `digital_twin`: trigger evidence, SSE delivery, acknowledgement, duplicate suppression, recovery, recurrence, restart restoration and rollback on alert-write failure. This does not substitute for testing the actual TimescaleDB extension on your machine. The existing geometry test requires the real Git LFS XKT. The optional dataset replay test requires its dataset fixture.

Notifications are in-app (bell, Event Log and recent activity). Email, SMS and push notifications outside the application are not configured. AI-generated alert classification and Agentic RAG remain separate future work.

## Explain a recovered incident in the building assistant

1. Generate a leak, then stop the fault and wait for dry readings.
2. In **AI assistant → Building evidence**, select **Toilet · Water leakage**.
3. Ask: **Why is the sensor dry now when there was a leak earlier? Explain the trend and previous incident.**
4. Current condition, recent trend and previous incidents are computed from stored records. When local Ollama is available, Qwen adds an interpretation, explicitly unverified possible explanations, and recommended checks. It cannot turn an earlier alert into a confirmed cause or repair.
5. Click an inline source number or **Open incident** to inspect the saved evidence. Use **View sensor in twin** for the live location. Full records are under **Sources**.
6. Use a follow-up chip or type a follow-up. Up to four earlier question texts from the same scope are passed for conversational context; earlier answers are not treated as new measurements.

The recent-history selector offers 15 minutes, one hour or four hours, but the available history remains capped at 18,000 readings for the active simulation run. Incidents come from the latest 500 automatic rule alerts, with up to eight scoped records retrieved and up to three summarised in the answer. Model-reference and format checks do not establish factual accuracy of its general explanation; operator review is still required. This is a bounded retrieval-and-explanation workflow, not an iterative Agentic RAG benchmark.

Validation includes eleven building-assistant tests, persisted incident retrieval after restart for both supported database schemas, and the unchanged room-AI regression suite. Model tests use controlled responses; actual Qwen output and latency require the user's local Ollama runtime.

### If the answer says stored evidence / fallback

The fallback banner now distinguishes **MODEL_UNREACHABLE** (open Ollama or run `ollama serve` in another terminal), **MODEL_NOT_FOUND** (run `ollama pull qwen3:1.7b`), **MODEL_TIMEOUT**, and **MODEL_RESPONSE_REJECTED**. Inspect connectivity at `http://localhost:3001/api/assistant/building/health`. A connected health response establishes model availability, not successful generation.

The explanation path permits numbers copied from the supplied evidence and statements expressing uncertainty about a repair. It constrains source IDs during generation and makes one shorter corrective attempt for malformed, truncated or rejected responses. These checks do not prove that a generated explanation is factually correct. Unreachable services are not retried.

For sub-minute simulator windows, trend spans, transitions and retained observations include seconds. The answer summarises each incident; the full retained-observation list stays under Sources. Restarting the simulator can create a new run, so a current dry-only window must not be described as if it contains an earlier run's leak-to-dry transition.
