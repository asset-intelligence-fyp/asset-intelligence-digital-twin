# TwinLabs Admin: email invitations, user access and sensor readings

The current Admin workspace is based on `development/ui-fixes` and implemented only in `feature/amanda-lan-hosting`. Teammate UI, Xeokit model file and simulator are not modified.

## Administrator workflow

The administration area has a compact left navigation on desktop and a horizontal tab menu on small screens:
**Overview / Sensors / Locations / Maintenance / Access / Database**.

- **Sensors:** Find sensors by code, type or room; add a database-only sensor, edit metadata or delete it only when not bound to the fixed model and without historical references; use **Readings** in a sensor row to display that sensor's stored timestamps, values and quality.
- **Locations:** Rename locations.
- **Maintenance:** Schedule work against a monitored location or sensor and update its status.
- **Access:** Invite viewers, see provider-send status, list accounts, change roles, enable/disable access and review action history.
- **Database:** Use one table dropdown and a single grid, with pagination; no multi-page drill-down required.
- **Overview:** Quick actions and operational administrative counts; not a copy of the normal telemetry dashboard.

This is a *management* area, so built-in BIM sensors remain protected from deletion; adding a database-only sensor does **not** add an IFC/XKT object or a live simulator channel.

## Real email invitation setup (host computer only)

TwinLabs supports real outbound mail through the **Resend HTTPS email API**, without adding new npm packages. You need a Resend sending account, a working API key and a sender address on a verified domain. Follow the provider's current setup: https://resend.com/docs/send-with-nodejs

In your local, Git-ignored `.env` set:

```dotenv
RESEND_API_KEY=re_your_private_key
INVITE_FROM_EMAIL=TwinLabs <invites@your-verified-domain.example>
APP_PUBLIC_URL=http://YOUR_HOST_WIFI_IP:3001
```

For example, `APP_PUBLIC_URL=http://172.20.10.7:3001` **only if** that is still the host's current Wi-Fi IP and the invitee is on the same Hotspot. Never put `localhost` here for another device: that points to the recipient's own computer. For a real remote deployment, use a legitimate HTTPS domain instead.

Keep API keys in `.env` on the host; never upload or paste them into a chat or GitHub. Restart `npm run host:lan` after adding settings. The server detects whether the three values are present.

1. Admin opens **Access → Grant access**, enters a recipient email, and generates the invitation.
2. TwinLabs calls Resend to send a one-time link. The code is stored as a SHA-256 digest; cleartext is returned once to the current Admin for manual fallback.
3. The UI reports **Email accepted by provider**, **Email provider failed**, or **Email not configured**. Provider acceptance does not guarantee inbox delivery; spam filtering and delivery failures remain possible.
4. The recipient opens the email link. The website launches **Redeem invitation** and pre-fills the code.
5. The recipient chooses a username and password (12+ characters) and becomes a **viewer**. The invitation is consumed once and expires after seven days.
6. Admin sees the account in Access, can promote it or disable it, and can revoke an unused invitation.

**No email account configured?** Grant Access still generates a code, but **no email is sent**. Share it privately with the recipient.

## Access-control scope and security limitations

- Admin-only management and database routes enforce the admin role on every protected request.
- Disabled accounts cannot sign in again; disabled administrators are rejected by protected APIs.
- The original building dashboard and its public API routes remain available to visitors on the trusted LAN **without a login**. Invitation approval is not a website-wide access gate. Do not advertise the public dashboard as login-protected.
- A forwarded, still-valid invitation code can be redeemed by its bearer: it is a bearer token. Email ownership itself is **not** verified by the application.
- The hotspot uses HTTP, meaning traffic—including passwords and codes—is not encrypted. Do not expose this deployment to public networks; configure HTTPS and robust access controls for real multi-user deployment.
- `APP_PUBLIC_URL` changes when the host's Wi-Fi address changes. Prior emails pointing to the old IP may become unusable.

## Database migration

`npm run host:lan` runs additive setup/migrations for `digital_twin.access_invites.email_status`, `email_sent_at`, and `digital_twin.users.is_active` without deleting existing rows or resetting credentials.

## Validation checklist

1. Back up the database; pull the feature Branch; run `npm run build` and `npm run host:lan`.
2. Admin → Sensors → Readings: confirm sensor history appears from PostgreSQL.
3. Admin → Access: verify disabled/enabled controls and role changes on a temporary viewer account.
4. With email configured, invite an address you control. Confirm the UI says **accepted by provider** and actually check inbox/spam; follow the one-use link and create a viewer account.
5. With email deliberately unconfigured, verify the UI says **not configured** and provides a manual code.
6. Revoke a separate test invite. Verify the revoked code is rejected.
7. Test that a viewer cannot call `/api/admin/manage/users` (should be rejected).
8. Verify original BIM viewer and simulator behavior are unchanged.

Do not use your primary data or accounts as test targets. This version is not yet verified on your Windows laptop until you run the new build and flow tests.
