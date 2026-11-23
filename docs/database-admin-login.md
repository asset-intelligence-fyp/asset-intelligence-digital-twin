# Database-backed TwinLabs Administrator (feature/database-admin)

The administrator login now validates a user in `digital_twin.users`, joined to the `admin` entry in `digital_twin.roles`. It does **not** use `ADMIN_USERNAME` or `ADMIN_PASSWORD_HASH` from `.env`. The password itself is never stored: only a salted scrypt hash.

## One-time setup on your intended PostgreSQL database

1. Back up the existing database first. Keep `.env` local and configure `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (or `DATABASE_URL`) and `TWIN_DB_SCHEMA=digital_twin`. Do not enable `TWIN_STORAGE=memory`.
2. Ensure your existing `digital_twin.users` and `digital_twin.roles` tables are present. If not, first review the additive v3 schema setup and run it against the **intended** database only.
3. Run `npm run admin:db:setup` from the repository root. This creates a single admin account, displays a generated password once, and leaves existing accounts unchanged on rerun. Save it privately.
4. Restart `npm run dev`, then log in as `admin` using that generated password.
5. To intentionally rotate the password, run `npm run admin:db:setup -- --reset` and save the newly generated password. Restart is not required for the database password to be read, but previously authenticated in-memory sessions remain valid until logout, expiry, or API restart; restart the API after rotation to invalidate them.

**Do not** run the old `npm run admin:setup` workflow for this branch. That legacy script writes local credentials into `.env` and is not used by the new database login.

There is no need to create a second `admin_users` table. The `digital_twin.users` / `roles` tables already existed in v3.

## For teammates

Database-backed authentication does **not** automatically share your local database. Two laptops pointing to separate PostgreSQL instances have separate user records. A shared administrator account works across laptops only if their backends connect to the same PostgreSQL instance (or each instance is initialized separately).

Do not commit database passwords, generated admin passwords, or `.env`. Do not expose a development PostgreSQL port publicly. The existing eight-hour sessions are process-local and are not a substitute for a production identity/session service.
