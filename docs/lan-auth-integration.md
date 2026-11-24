# LAN hosting and account features on the clean dashboard branch

This integration imports the LAN-hosting and account-management system from
`feature/amanda-lan-hosting` into `design/clean-dashboard-preserve-features`
without replacing the clean Overview, AI Monitoring, Analytics, Events, BIM
viewer, simulation lab, alerts or existing public dashboard.

## Operating modes

- `TWIN_STORAGE=memory npm run dev`: existing public dashboard, simulator and
  optional original local administrator credentials from `npm run admin:setup`.
  The login modal and original Admin Database page remain available in this
  development mode. Database-backed account management is not available.
- PostgreSQL / `digital_twin` mode: `npm run host:lan` runs the built
  website and API on one LAN-accessible host. Use `npm run admin:db:setup`
  for database admin credentials when required. Admin signs in through the
  header login modal to see Administration under More tools. Public dashboard
  access and its existing features remain unchanged.
- Invitation signup: Admin > Grant Access issues one-use viewer codes and
  can send them through configured Gmail SMTP or Resend. Recipients open a
  link containing `?invite=CODE`, create a viewer account, and sign in via
  the same modal. Ordinary viewers do not see Administration.
- Email delivery is optional and reported honestly. This flow is
  **invitation-based**, not independent verification of ownership of an
  email address. A valid code shared manually also permits registration.
- LAN demo URLs use HTTP unless HTTPS is configured externally. Do not use
  public/untrusted networks or production passwords without TLS.

The older `npm run admin:setup` and `npm run admin:check` remain for
local/environment-based development. The database equivalents are
`npm run admin:db:setup` and `npm run admin:db:check`.

## Safety and migration

Before `npm run host:lan`, back up the host's database and verify the
Git-ignored `.env` PostgreSQL connection. The launcher creates missing
schema objects additively; it does not create the PostgreSQL database,
install TimescaleDB, reset existing history or expose port 5432.

The LAN launcher is intended for one trusted host serving other browsers.
Do not copy actual SMTP App Passwords, API keys or database credentials into
GitHub. See `docs/shared-lan-hosting.md` and
`docs/admin-access-email.md` for host setup.

## Validation

Run `npm run build`, `npm test`, `npm run test:ai`,
`npm run test:alerts`, and `npm run test:admin`. Check both anonymous
Overview and viewer login, admin login, one-use invitation redemption,
role-restricted Administration, and the existing simulator/BIM in a browser.
