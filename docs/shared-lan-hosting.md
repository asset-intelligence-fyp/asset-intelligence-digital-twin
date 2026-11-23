# One-command TwinLabs shared Website (Windows hotspot / trusted LAN)

This feature is implemented **only on feature/amanda-lan-hosting**, based on development/ui-fixes. It does not update the original branch.

## Goal

The host Windows laptop runs the whole TwinLabs website against its own existing PostgreSQL + TimescaleDB installation. Everyone on the same mobile Hotspot uses the host's URL in a browser; visitors do **not** install PostgreSQL, pgAdmin, Node.js, or VS Code. The host computer must stay powered and connected.

## One-time prerequisites — host laptop only

- Node.js 22+ installed; Python 3 available if you want the optional Qwen3 bridge / hybrid simulator.
- A working local PostgreSQL + TimescaleDB database **already configured** in your host's Git-ignored `.env`. Use `PGDATABASE`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` or `DATABASE_URL`. The launcher will **not** replace or reset existing database tables. Unlike the older prototype, database admin login does not need `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` in `.env`.
- The PostgreSQL database itself and its TimescaleDB extension must already exist. The launcher **automatically creates missing `digital_twin` schema tables and registers missing sensor metadata** using the existing `db:setup:v3` initializer, and skips this step when the schema and 18 sensor registrations are already present. It does not automatically create a PostgreSQL database or install TimescaleDB. Back up the database before its first initialization.
- Ensure nothing else is listening on port 3001 (including any older `npm run dev` process).

## Which database schema is the official one?

**Use only `database/schema_v3.sql` as the canonical SQL definition for the active `digital_twin` schema.** It contains 17 tables and additive legacy-alert column upgrades. The older `twin18` schema and any previous prototype schemas are retained for legacy compatibility, not for setting up this LAN-hosted website.

**Recommended:** run `npm run host:lan`. It checks the existing PostgreSQL database, skips initialization when all v3 tables and at least 18 sensor registrations exist, and otherwise runs `npm run db:setup:v3` automatically. Existing rows are not replaced during metadata seeding.

**Manual initialization (host only, if needed):** `npm run db:setup:v3` runs the canonical SQL, adds missing default Building/Floor/Location/Sensor metadata without overwriting matching records, converts the sensor readings table to a TimescaleDB hypertable when needed, and installs the change notification trigger. Running the SQL alone in pgAdmin does **not** seed the 18 sensor registrations or run the hypertable conversion/trigger setup.

**Prerequisites:** the PostgreSQL *database* named by `.env` must already exist; TimescaleDB must be enabled in that database. The launcher will not create a PostgreSQL database, install TimescaleDB, or reset existing data. Backup your database before initial setup.

## Start the entire website

From the repository root on the host laptop:

```powershell
npm run host:lan
```

The launcher automatically installs missing npm dependencies, checks and initializes missing v3 schema tables and sensor metadata when needed (skipping existing objects), creates a database administrator only **if absent** (and prints its generated password once), builds the React site, starts Express (UI + API on port 3001), and starts the optional Python AI bridge and the simulator. Failure to start optional Python services does not stop the core website.

**The launcher runs one narrowly scoped additive alert compatibility migration** before starting the API. It adds missing `digital_twin.alerts.replay_id`, `detector`, and `evidence` columns with `IF NOT EXISTS` and ensures required severity/status lookup rows exist. It does not delete or replace sensor readings or existing alerts. Back up your database before the first run. If the configured PostgreSQL database or TimescaleDB extension is missing, or schema initialization fails, it stops with an error rather than using an empty memory database. Existing sensor/location metadata use `ON CONFLICT DO NOTHING` during initialization, so their values are not overwritten.

The terminal prints:
- `http://localhost:3001` for the host
- LAN IPv4 URL(s), such as `http://192.168.43.120:3001`, for visitors. Choose the address belonging to the shared Hotspot.

## On a friend's Mac

1. Connect to the **same Hotspot** as the host Windows laptop.
2. Open the host's LAN URL in Safari or Chrome.
3. Use the administrator credentials initialized on the host to enter the Admin Database page. The Mac does not need database credentials or its own PostgreSQL setup.

The Admin viewer queries the host's PostgreSQL through the host Express API. Database access is not exposed directly to visitors.

## If the LAN URL is unreachable

- Confirm `http://localhost:3001` works on the host, and `http://localhost:3001/api/health` reports `storage: postgresql`.
- Check Windows Firewall: allow only the required **TCP 3001**, limited to the trusted Private/Hotspot network if possible. Do **not** open PostgreSQL TCP 5432 or the AI/model ports.
- Some mobile Hotspots isolate connected clients; if yours does, use another trusted Wi-Fi network or a private VPN such as Tailscale.
- `localhost` on your friend's Mac refers to **their Mac**, not your Windows laptop. Use the host's printed LAN IP.

## Security and limitations

This is **trusted local-network demonstration mode**, not Internet hosting. The URL is ordinary HTTP, so do not use untrusted/public Wi-Fi or expose it to the Internet; access controls, HTTPS, and network hardening are required for broader deployment. Use strong admin credentials and log out after demonstrations. The existing application includes other non-admin API routes not designed for public exposure. The host should not open database port 5432 to the network.

If the host shuts down, the shared site goes offline. GitHub updates do not auto-deploy; the host must pull the intended branch and rerun the launcher. The existing Qwen3 service remains dependent on local Ollama/model availability.

For optional testing without starting the AI bridge or simulator, add `HOST_START_AI=false` and `SIMULATOR_AUTOSTART=false` to the host's local `.env`; this does not affect the main Admin Database feature.
