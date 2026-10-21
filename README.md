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

## Current nine-point independent MQTT live simulator

The supplied independent, LBNL-informed **stateful synthetic** three-HRU Python simulator is now connected through MQTT → Node.js → PostgreSQL → SSE → website. See [the independent simulator setup](tools/independent_3hru_live/README.md). The older eleven-point historical simulator below is **legacy**; do not run it with the current nine-point PostgreSQL mapping.

## Level 5 live simulator → BIM viewer (legacy 11-point instructions)

The integrated 11-point historical replay simulator lives at
[`tools/level5_digital_twin_simulator_final/`](tools/level5_digital_twin_simulator_final/README.md).
It publishes on `dt/+/+` through Mosquitto, is checked against the
Level 5 sensor registry in `database/seed_level5_sensor_registry.sql`,
and uses the existing Node.js MQTT ingestion and SSE browser updates.
It replaces the **old simulator for Level 5 integration testing**; do not
run the two simulators at the same time.

Generated CSV datasets are not committed. Generate a small rule-based test
CSV or use your validated LBNL-derived **holdout** CSV locally.
See the simulator README for environment setup, `mosquitto -v`, Python
dependencies, Start/Stop controls, and end-to-end verification.

Validate the 11 simulator-to-database mappings without a broker:

```bash
node --test tests/level5SimulatorRegistry.test.mjs
```

This checks only the integration contract. Actual MQTT-to-PostgreSQL-to-browser
delivery must be tested with the broker, database and local web app running.

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
