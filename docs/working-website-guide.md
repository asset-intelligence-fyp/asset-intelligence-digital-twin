# Run and demonstrate the integrated TwinLabs website

This version includes Amanda's committed database/admin updates and the Velvet UI. The automatic alert pipeline uses explicit demonstration rules, not Qwen-generated diagnoses.

## Update your Mac checkout

In your existing repository, check `git status` first. Commit your own uncommitted work before switching or pulling; do not discard it. Then:

```bash
git switch feature/velvet-ui
git pull --ff-only
git lfs pull
npm ci
```

`git lfs pull` retrieves the existing 16 MB XKT building model. If the viewer cannot load, run `npm run model:verify`. Do not replace the model with a Git LFS pointer.

## Use Amanda's PostgreSQL and TimescaleDB

Keep your existing `.env` credentials. Match the database host, port, name and account to Amanda's working configuration. Add or update:

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=digital_twin_18
TWIN_DB_SCHEMA=digital_twin
SIMULATOR_MODE=hybrid
SIM_INTERVAL_SECONDS=5
SIM_STEP_SECONDS=5
```

Set `PGUSER` and `PGPASSWORD` locally if your PostgreSQL server requires them. `DATABASE_URL`, if set, takes precedence over these individual connection settings. Remove `TWIN_STORAGE=memory` from the file and terminal environment to use PostgreSQL. Do not commit `.env` or credentials.

With PostgreSQL running and the TimescaleDB extension already enabled in this database:

```bash
npm run db:setup:v3
npm run db:check
npm run build
npm run dev
```

Use the localhost address printed by Vite, normally http://localhost:5173. Keep the terminal open. The development command starts the API, browser frontend, Python bridge and hybrid generator.

Rerun setup even if Amanda already created the v3 schema: this update adds the columns required to retain automatic alert evidence. Setup is additive and rerunnable; it does not remove the old `twin18` tables or copy their history into `digital_twin`. Back up an important local database before any schema update.

If setup reports that TimescaleDB is missing, enable the extension in the selected PostgreSQL database using your normal administrator process, then rerun setup. The extension must be available to that PostgreSQL installation. Do not claim TimescaleDB is active just because the schema exists.

`npm run db:check` should report 18 sensors, `schema: "digital_twin"`, a TimescaleDB version and `readings_hypertable: true`. The website's System status page and http://localhost:3001/api/health report the active storage, schema and hypertable state.

For a temporary demonstration without a database:

```bash
TWIN_STORAGE=memory npm run dev
```

Readings, automatic alerts and acknowledgements then reset when the API stops. Plain PostgreSQL with `TWIN_DB_SCHEMA=twin18` also supports alerts after `npm run db:setup`, but is a different schema from Amanda's v3 database.

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

- **Building evidence** works from API history even when Ollama is unavailable, and labels that fallback.
- **Qwen room AI** needs local Ollama/Qwen and the Python bridge. Historical comparisons additionally need the configured normal-history SQLite reference; that database has not been silently replaced with PostgreSQL.
- Start Ollama as usual and ensure `qwen3:1.7b` is installed. Existing `OLLAMA_URL`, `LLM_BRIDGE_URL` and `LLM_HISTORY_DB` settings remain supported.
- Enter sends, Shift+Enter inserts a line. Replies safely render headings, paragraphs, numbered/bullet lists, bold text and inline code; raw model HTML is not executed.
- **Ask about this sensor** uses the current sensor history. The incident's saved trigger evidence is displayed in the Event Log and twin investigation banner; it is not automatically used as the chatbot's historical cutoff.

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
