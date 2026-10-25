# PostgreSQL demo database

This project now uses PostgreSQL through the Node.js/Express API in `server/index.js`.
The browser does **not** connect directly to PostgreSQL.

## Files

- `postgres_schema.sql` — creates tables matching the supplied project ERD.
- `postgres_seed.sql` — inserts temporary Snowdon Towers demonstration data.
- `postgres_init.sql` — resets the demo schema and runs both schema + seed data in one command.

## Create and load the database

From the project folder:

```bash
createdb digital_twin
psql -d digital_twin -f database/postgres_init.sql
```

The init script drops and recreates the demo tables, so do not run it against a database containing data you need to keep.

*The latest database schema is postgre_schema.sql and the data is postgres_seed.sql*

## New nine-point Level 5 dataset profile (October 2026)

After applying the existing base schema and Level 5 registry seed, update the
running database to the nine point codes in the new CSV **without deleting
history or changing any physical BIM GlobalIds**:

```bash
psql -X -v ON_ERROR_STOP=1 -d digital_twin \
  -f database/seed_level5_nine_point_profile.sql
```

You can also paste that file into **Adminer → SQL command**. See
[`docs/level5-nine-point-dataset-migration.md`](../docs/level5-nine-point-dataset-migration.md)
for the nine-code mapping, verification queries, and next Python MQTT steps.

**Do not rerun the old eleven-point seed after the nine-point migration**;
it would reactivate the retired channel names. Do not use `postgres_init.sql`
on a populated research database because it resets tables.

## Connection

Copy `.env.example` to `.env`. The default configuration assumes PostgreSQL is on `localhost:5432` and the database is named `digital_twin`.

If your PostgreSQL account requires a specific username/password, uncomment and edit `PGUSER` and `PGPASSWORD` in `.env`.

All included records are temporary demonstration data. They are not live BMS readings or validated AI performance results.
