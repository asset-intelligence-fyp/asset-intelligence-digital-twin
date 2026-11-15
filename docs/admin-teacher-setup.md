# TwinLabs administrator login — lecturer / demonstration setup

This guide applies to the **default `main` branch** and the integrated TwinLabs Alpha website. It is intended for a reviewer or student running a local copy. The administrator viewer does not use a cloud-hosted account and the GitHub repository intentionally contains **no reusable admin password or password hash**.

## A. Setup on a fresh checkout

Install Node.js 22+, Python 3.10+ and Git LFS. From the cloned repository:

```bash
git lfs pull
npm ci
npm run admin:setup
```

`admin:setup` creates `.env` if needed or **preserves the existing database and simulator settings** in `.env` while replacing old admin credentials. It prints **Username: admin** and a newly generated password once. Save the password somewhere private. Neither the plaintext password nor the salted verifier is committed to GitHub.

**Do not paste a teammate's `ADMIN_PASSWORD_HASH=scrypt:...` into the README or GitHub.** A hash is not itself a login password: without the original matching password, the login will fail. Regenerate a local pair instead.

## B. Start and verify login — no database required

For a simulation demo, from the repository directory:

```bash
TWIN_STORAGE=memory npm run dev
```

Open **http://localhost:5173**, click **Login** in the top-right corner, and enter the local username/password printed during setup. A successful session exposes **Database** in the navigation. This demonstrates authentication only; the Database page cannot load tables in memory mode.

In a **second terminal**, verify:

```bash
npm run admin:check
npm run admin:check -- --verify-login
```

The first check confirms the local verifier's format and whether the API is reachable. The second securely prompts for your password **without echoing it**, submits a real login, checks the HttpOnly session cookie, and checks whether database tables are accessible. It reports if login works but database storage is unavailable.

Use this process **after** restarting `npm run dev` whenever credentials are regenerated. Running `admin:setup` again rotates the credentials; the previously displayed password will no longer work.

## C. Demonstrate PostgreSQL + TimescaleDB database tables

**Admin login by itself is not proof that PostgreSQL or TimescaleDB works.** For the actual database demonstration:

1. Back up existing PostgreSQL data and verify you selected your intended development database.
2. In local `.env`, configure correct `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`/`PGPASSWORD` or `DATABASE_URL`. Configure `TWIN_DB_SCHEMA=digital_twin`. **Remove `TWIN_STORAGE=memory`** from `.env` and from the current shell.
3. Enable the TimescaleDB extension on that database before setup.
4. Run:

```bash
npm run db:setup:v3
npm run db:check
npm run dev
```

5. Run `npm run admin:check -- --verify-login` in another terminal; the final check should say the authenticated database view is accessible. Use **System status** or `http://localhost:3001/api/health` to verify PostgreSQL, `digital_twin`, and an active TimescaleDB hypertable.
6. Open **Login → Database** in the web UI to inspect building/location/sensor records, synthetic readings and persisted rule alerts.

Expected initial database registry: **18 virtual indoor sensors across five virtual monitoring locations**. Tables for AI model outputs, forecasts, notifications and users may be empty because their workflows are not all connected. The Database page is read-only.

**Mac / Linux:** `unset TWIN_STORAGE DATABASE_URL` only if those environment variables were previously exported and conflict with your intended `.env` settings. On PowerShell, use `Remove-Item Env:TWIN_STORAGE -ErrorAction SilentlyContinue` if required. Do not casually remove `DATABASE_URL` when you actually use it for PostgreSQL.

## D. Troubleshooting

| Problem | Check / action |
| --- | --- |
| `Admin login is not configured` (HTTP 503) | Run `npm run admin:setup` from the repository root and restart `npm run dev`. |
| `Invalid credentials` (HTTP 401) | The password must match this machine's newly generated hash; don't enter the hash as the password. Repeat `admin:setup` if the password was lost, then restart. |
| `Too many login attempts` (HTTP 429) | Wait for the local rate-limit window (15 minutes), or restart the development API before testing with newly generated credentials. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` still ignored | Environment variables exported in the terminal can override `.env`; remove stale shell overrides and restart the API. |
| Login works, but `Configure PostgreSQL first` | You are in memory mode or the DB isn't configured. Follow section C. |
| PostgreSQL `password authentication failed` | Fix your local `PGUSER` and `PGPASSWORD`, or `DATABASE_URL`. These are **different** from the web admin password. |
| TimescaleDB not installed / hypertable not confirmed | Confirm extension availability and run `npm run db:setup:v3` against the intended database; then `npm run db:check`. |
| Admin menu disappears after server restart | Sessions are in-memory and expire on restart; simply log in again with the same local password. |
| Local login works in terminal but not browser | Use the Vite origin `http://localhost:5173`; avoid mixing unrelated hosts and inspect the browser Network tab for `/api/admin/login` and cookies. |

## E. Security and submission

- The GitHub repository contains **setup scripts and instructions, not actual credentials**.
- The locally generated `.env` is Git-ignored. Do not upload it or screenshots showing credentials.
- The password should be shared privately with the instructor **only if running the same configured machine**; on another clone, the instructor runs `npm run admin:setup` themselves.
- Admin authentication uses a salted scrypt verifier, constant-time comparison, HttpOnly SameSite cookies and local in-memory sessions. It is an academic prototype, not production identity management.
- Never expose the local prototype's API/DB/Ollama ports to a public network without proper security hardening.

Related: [top-level README](../README.md), [TimescaleDB setup](unified-database-v3.md), [complete fault demo](working-website-guide.md).
