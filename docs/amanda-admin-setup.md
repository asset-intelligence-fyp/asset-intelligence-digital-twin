# Amanda local PostgreSQL + TimescaleDB + Admin setup (Windows)

All code changes in this guide target the **amanda** branch only. The original Velvet UI pages are retained.
The running Node server remains `server/sensorServer.js`; the live readings table is **twin18.sensor_readings**, NOT the older V2 `public.sensor_readings`.
The canonical point codes are the 18 entries in `shared/sensorRegistry.json`. The canonical monitoring location aliases are L02-OPEN, L03-MEET, L04-WC, L04-CLEAN and L05-ELEC.

## First: protect existing pgAdmin data

1. In pgAdmin select the existing database and use Backup; keep the backup separately.
2. Run these **read-only** checks in Query Tool:

```sql
SELECT current_database(), current_user, current_setting('server_version');
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name='timescaledb';
SELECT table_schema,table_name FROM information_schema.tables
 WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2;
```

**Do not** execute the old `database/postgres_init.sql` or rerun the old V2 schema on a populated database; those are historical alternatives and may conflict or delete tables. The new Amanda migration is additive but should be applied to a separate database first.

## Set up a separate local Amanda database

In pgAdmin, right-click **Databases → Create → Database…** and name it `digital_twin_amanda`. Keep your earlier V2 database unchanged. Use this new database for every following SQL command.

In VS Code PowerShell, from the repository root:

```powershell
git switch amanda
git pull --ff-only origin amanda
git lfs pull
npm ci
Copy-Item .env.example .env
```

If `.env` already exists, **edit** rather than overwrite it. Set the real local database account values and leave `TWIN_STORAGE` unset:

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=digital_twin_amanda
PGUSER=postgres
PGPASSWORD=YOUR_LOCAL_PASSWORD
SIMULATOR_MODE=hybrid
SIM_STEP_SECONDS=5
SIM_INTERVAL_SECONDS=5
ADMIN_USERNAME=admin
```

Never commit `.env` or show your password in chat/screenshots.

In PowerShell clear previous memory-mode and connection URL overrides:

```powershell
Remove-Item Env:TWIN_STORAGE -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Now run the existing **non-destructive** registry setup, which creates `twin18.sensor_registry` and `twin18.sensor_readings` and seeds the website's 18 points:

```powershell
npm run db:setup
```

Next, in **pgAdmin Query Tool connected to digital_twin_amanda**, execute `database/migrations/001_amanda_locations_maintenance.sql`. It creates five website monitoring location aliases and an empty `twin18.maintenance_events` table; no fake maintenance history is inserted. It is safe to rerun.

Verify:

```sql
SELECT COUNT(*) FROM twin18.sensor_registry; -- 18
SELECT location_code FROM twin18.monitoring_locations ORDER BY location_code; -- five aliases
SELECT COUNT(*) FROM twin18.maintenance_events; -- 0 until real records are inserted
```

## TimescaleDB (optional until confirmed installed)

The standard PostgreSQL schema and sensor ingestion work without TimescaleDB, but production-target time-series storage requires it. Verify the extension's availability in the **new** database:

```sql
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name='timescaledb';
```

If `default_version` is absent/NULL, install a compatible TimescaleDB build for your PostgreSQL version **before** trying this step. Make a backup and stop the running API/simulator. Only then execute `database/migrations/002_amanda_optional_timescaledb.sql` on `digital_twin_amanda`. It enables the extension and converts `twin18.sensor_readings` to a hypertable with `migrate_data => TRUE`. Migration may lock the table; verify success via the SQL provided. Do not apply it to your old V2 database.

## Set up Admin Login

Run locally:

```powershell
node scripts/generate-admin-hash.mjs
```

Enter a strong password (at least 12 characters). Copy the produced `ADMIN_PASSWORD_HASH=scrypt:...` line into your **local .env** (alongside `ADMIN_USERNAME=admin`). Never commit/share the hash or password. This first version uses one locally configured administrator rather than the legacy V2 `public.users` table. Cookies are HttpOnly, SameSite=Strict, session tokens expire after eight hours or process restart, and repeated failed logins are rate limited. It is a local prototype; add central user management, HTTPS/proxy configuration and persistent session storage before public deployment.

## Launch and verify

```powershell
npm run dev
```

Open `http://localhost:5173/`. Open `http://localhost:3001/api/health` to confirm `storage` is `postgresql`. In the top-right click **Admin Login**, enter configured credentials, and view Locations, Sensor registry, Sensor readings, Maintenance events. This viewer is intentionally **read only**.

To add maintenance events for testing, use pgAdmin on the *new* database and replace sample values with an actual record (do not record demo data as real maintenance):

```sql
-- Example only; execute only if you intentionally want a clearly labelled demo record:
-- INSERT INTO twin18.maintenance_events(location_code,point_code,event_type,event_date,description,maintenance_status,performed_by)
-- VALUES ('L03-MEET','TEMP-L03-MEET-01','Demo inspection',NOW(),'Synthetic test record','Completed','Demo');
```

Asset Register's existing **Maintenance History** section now reads the records through `/api/bootstrap` (up to 200 recent events). Existing other pages remain unchanged.

## Trouble-shooting

- `password authentication failed`: check the database credentials in `.env`.
- `relation twin18.sensor_registry does not exist`: run `npm run db:setup` first against the new DB.
- Admin login says not configured: add `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`, then restart the server.
- TimescaleDB missing: skip optional migration; don't install or alter extensions on your old database.
- These code changes do not alter your local pgAdmin data automatically. Always run the migration against the database you deliberately choose.
