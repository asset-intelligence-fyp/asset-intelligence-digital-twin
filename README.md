# Asset Intelligence — AI-Driven Building Digital Twin

Version 1.2 connects the construction/facility monitoring frontend to a **PostgreSQL** demo database through a **Node.js + Express REST API**.

## Architecture

```text
PostgreSQL (digital_twin)
        ↓
Node.js / Express API  http://localhost:3001
        ↓  REST
Vite frontend          http://localhost:5173
        ↓
Dashboard + xeokit BIM viewer
```

The browser never receives PostgreSQL credentials and never connects directly to the database.

## 1. Requirements

Install:

- Node.js 18 or newer
- npm
- PostgreSQL

Check them:

```bash
node --version
npm --version
psql --version
```

## 2. Create the PostgreSQL database

From Terminal:

```bash
createdb digital_twin
```

If PostgreSQL says the database already exists, that is fine.

Then, from this project folder, load the temporary schema and demo data:

```bash
psql -d digital_twin -f database/postgres_init.sql
```

**Warning:** `postgres_init.sql` drops and recreates the demo tables. Use it only for this temporary PoC database.

**Latest** postgres_schema.sql is the database schema and postgres_seed.sql is the data.

Verify the data:

```bash
psql -d digital_twin
```

Then inside `psql`:

```sql
\dt
SELECT * FROM assets;
SELECT * FROM sensors;
SELECT * FROM anomaly_results;
\q
```

## 3. Configure the backend

Copy the example environment file:

```bash
cp .env.example .env
```

Default `.env` values are intended for a local PostgreSQL installation:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=digital_twin
SERVER_PORT=3001
PGSSL=false
```

On many Homebrew PostgreSQL installations, the current macOS username is used automatically, so `PGUSER` and `PGPASSWORD` can remain commented out.

If your PostgreSQL setup requires credentials, edit `.env` and add:

```env
PGUSER=postgres
PGPASSWORD=your_password
```

Do not commit your real `.env` file to GitHub.

## 4. Install packages and run everything

```bash
npm install
npm run dev
```

This starts both:

- Backend API: `http://localhost:3001`
- Frontend: `http://localhost:5173`

Open the frontend URL in Chrome.

You can test the API directly:

```bash
curl http://localhost:3001/api/health
```

A healthy response looks similar to:

```json
{"ok":true,"database":"digital_twin","server_time":"..."}
```

## Current live MQTT simulator (nine-point profile)

The only supported simulator is the Python program from the uploaded
`PPT_LBNL_Independent_3HRU_Live.zip`. Its **independent HVAC generator
is preserved**, and the publisher has been adapted to send the nine active
sensor identities over MQTT. This is synthetic telemetry, not physical
building measurements.

[Setup and troubleshooting](tools/independent_3hru_live/README.md)

```bash
# Stop any previously running hru-simulator-v2 or 11-point replay first.
git switch feature/ui-redesign
git pull --ff-only origin feature/ui-redesign
# Terminal 1: mqtt broker
mosquitto -v
# Terminal 2: API + website (after npm install)
npm run dev
# Terminal 3: Python (after the README virtual-environment setup)
python tools/independent_3hru_live/scripts/simulate_live.py --mqtt --interval-seconds 5
```

The API now **rejects messages without the independent simulator provenance**,
even on a topic that overlaps a legacy simulator. It reports how many
of all nine active points were accepted in the last 90 seconds:
`curl http://localhost:3001/api/live-status`. A live MQTT connection by
itself does not mean all nine sensors are reporting. The browser badges show
`N/9` and the Simulator view identifies missing points.

The old `tools/hru_digital_twin_simulator_v2` and
`tools/level5_digital_twin_simulator_final` directories were deleted from
this branch. **Already-running processes must still be stopped manually**:
pulling new code does not terminate Python or Mosquitto.

```bash
node --test tests/liveMqttContract.test.mjs tests/level5SimulatorRegistry.test.mjs
python -m unittest discover -s tools/independent_3hru_live/tests -v
```

These are contract/unit checks, not proof of an end-to-end PostgreSQL
deployment. Verify the broker log, API live-status, SQL inserts and website
cards on your local machine.


## 5. What now comes from PostgreSQL

The following dashboard data are loaded from PostgreSQL through `/api/bootstrap`:

- BIM model metadata
- building and floors
- spaces
- assets
- maintenance events
- sensors
- current sensor readings
- historical sensor readings
- anomaly results
- alerts
- alert statuses and severities

The construction-oriented UI and xeokit BIM model remain frontend components. AI evaluation metrics remain placeholders because the project has not supplied validated model-evaluation results.

## Acknowledge workflow

The **Acknowledge** button now performs a real API update:

```text
Frontend
  → PATCH /api/anomalies/:id/status
  → PostgreSQL anomaly_results
  → PostgreSQL alerts
  → refresh dashboard data
```

Acknowledgement does not mean the fault has been repaired; it only records that the anomaly has been seen.

## BIM files

The existing Snowdon Towers files are preserved:

- `public/models/Snowdon Towers Sample Architectural.xkt`
- `public/models/Snowdon Towers Sample Architectural.ifc`

The viewer loads the `.xkt` file using xeokit.

## Production-style run

Build the frontend:

```bash
npm run build
```

Then start the Express server:

```bash
npm start
```

When `dist/` exists, Express serves the built frontend as well as the API.

## Troubleshooting

### `PostgreSQL is not available`

Check PostgreSQL:

```bash
pg_isready
```

Then test:

```bash
psql -d digital_twin -c "SELECT COUNT(*) FROM assets;"
```

### `role ... does not exist`

Your PostgreSQL username differs from your macOS username. Add the correct `PGUSER` to `.env`.

### `password authentication failed`

Set the correct `PGPASSWORD` in `.env`, or use a valid `DATABASE_URL`.

### Port already in use

The default ports are:

- API: `3001`
- Vite: `5173`

Change `SERVER_PORT` in `.env` only if needed. If you change the API port, also update the target in `vite.config.js`.

## Demo-data notice

The database records are temporary demonstration fixtures only. They must not be presented as live building measurements, validated fault diagnoses, or measured AI performance.
