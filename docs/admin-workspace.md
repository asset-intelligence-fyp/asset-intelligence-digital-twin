# TwinLabs administration workspace

This feature is available on `design/clean-dashboard-preserve-features` and is based on `development/ui-fixes`. The original team's branch, IFC/XKT model, camera controls, simulator, and ordinary operating pages are not edited by the management workspace.

## Access

Run `npm run host:lan` with the configured PostgreSQL + TimescaleDB database. The launcher creates missing `digital_twin.access_invites` and `digital_twin.admin_audit` schema objects automatically using the canonical `database/schema_v3.sql`, then starts the application. Sign in with a `digital_twin.users` account whose role is `admin`.

The administrative workspace uses a compact left sidebar on desktop (horizontal tabs on mobile): **Overview**, **Sensors**, **Locations**, **Maintenance**, **Access**, **Database**. The normal operating sidebar is hidden while the administration workspace is open. The database viewer has one table selector with an inline record grid and simple pagination.

## What really works

- **Sensors:** Open a sensor's recent historical Readings directly from its row; create additional sensor registry records in PostgreSQL; edit location, type, and unit; remove newly added sensors **only if** they have no readings, AI results, forecasts, alerts, or maintenance references. The 18 built-in sensor IDs are protected from removal. Changes are logged in `digital_twin.admin_audit`.
- **Locations:** Rename existing monitoring locations in PostgreSQL.\n- **Maintenance:** Schedule maintenance against a location or a matching sensor; update status (Scheduled, In Progress, Completed, Cancelled) and record an audit entry.
- **Access:** Generate a one-use viewer invitation code linked to an email (expires after seven days). Only the SHA-256 code digest is stored. With a configured Resend account, TwinLabs sends the invitation email and records whether the provider accepted it. Otherwise, the administrator copies the code and shares it privately. See [email setup](admin-access-email.md). The recipient uses **Login → Have an invitation code?** to create a viewer account and a 12+ character password. A one-way scrypt verifier is stored in `digital_twin.users`. Administrators can switch user roles between viewer and admin and enable/disable accounts; they cannot disable their own account or the last active administrator. Role checks are repeated on each protected request.
- **Database:** Read-only, paginated browsing of all permitted database sections from a single dropdown. Password hashes are not exposed in this viewer.
- **Audit:** Recent administrator actions are available under Access.

## Important BIM limitation

The real 3D model is an IFC-derived XKT asset at `public/models/FYP_WholeBuilding_18Sensors.xkt`. Xeokit **displays and navigates** the model, but this application does not implement IFC/XKT editing or a persistence mechanism for new building geometry.

Creating a sensor in PostgreSQL is therefore **not** the same as adding a marker to the 3D BIM. Newly created rows receive `pending_bim_mapping`. To make a new sensor operational you must also update the project's fixed sensor registry, add an IFC sensor (or equivalent mapped model object) and regenerate the XKT model, and configure a data producer/simulator. This workspace deliberately does not claim otherwise.

Existing built-in sensors use a fixed frontend/simulator mapping, so metadata changes to those records should be coordinated with the static registry. The CRUD routes do not rewrite historical readings.

## Website access versus admin access

The new invitation flow creates real viewer accounts with working sign-in. All `/api/admin/...` data/management routes require a valid **admin** role. **The original operating website and its public API endpoints remain accessible without sign-in.** Viewer codes do *not* currently enforce a website-wide access gate; that would require a separate access policy and middleware rollout. Do not treat the invite as a substitute for network controls.

LAN traffic uses ordinary HTTP. Use a trusted private network only, avoid weak passwords (especially `admin/admin`), keep the database port private, and do not share administrator credentials or invitation codes publicly.

## Smoke-test checklist (in a test database first)

1. Back up the PostgreSQL database; pull the feature branch; run `npm run host:lan`.
2. Sign in as admin; open Administration. Verify all five sections and the data table picker.
3. Create a temporary new sensor. Verify the row appears as **Pending BIM**.
4. Edit its type/unit/location; verify the database row changes; delete it before it has any references.
5. Verify built-in sensors cannot be deleted and that existing readings remain unchanged.\n6. Schedule a temporary maintenance task and update its status.
7. Rename a location; refresh the database viewer and verify the change.
8. Generate a viewer code, use the Login modal to redeem it in a private browser session, sign in as viewer, and verify that admin API calls return 401/403.
9. Revoke a different unused code and confirm it cannot be redeemed.
10. Confirm the original BIM viewer, dashboard, and simulator still run as before.

This code has not yet been tested against your live laptop/database. Validate in an isolated test database before applying live changes.

## Confirmation for every administrator change

All read-only Admin operations remain available without repeated prompts. **Every individual change** (sensor create/edit/delete, location rename, maintenance creation/status, grant/revoke invitation, user role change, account enable/disable) requires entry of the currently signed-in Administrator's password, with no grace period between changes.

The backend verifies the password against the account's scrypt password hash. After successful verification, it issues a **60-second, one-use confirmation token** bound to exactly the requested HTTP method, URL path, and JSON body. The token is consumed upon the next matching change attempt; it cannot be reused for a second change or a different payload. Five wrong password confirmations trigger a temporary 15-minute lockout.

Every successful administrative database mutation already writes to `digital_twin.admin_audit` within its database transaction, capturing the signed-in account username (`actor`), action, target, optional details, and database-generated timestamp. The **Access → Recent activity** list shows that username alongside the action, target and time.

Run `npm run test:admin:step-up` and `npm run build` after pulling. Confirm that a second edit prompts for a password again, and that the audit history lists the correct signed-in username. Changes through `/api/admin/manage/*` are protected server-side, not merely by a modal.

**Security note:** The current HTTP LAN site is not transport-encrypted. A password prompt does not substitute for HTTPS in production. Keep your testing on a trusted private LAN and use HTTPS before handling real credentials over untrusted networks.

The Grant Access card retains the fixed-size Send Invitation button, unaffected by the height of Recent Activity or email delivery status.

## Admin navigation: accounts, invitations, audit, alerts and notifications

The Admin sidebar now has dedicated sections for **User Accounts**, **Grant Access**, **Audit Log**, **Alerts**, and **Notifications**, instead of combining all access functions in one scrolling section.

- **User Accounts:** View username, email, current role, status and creation date; promote/demote users or enable/disable access with a new password confirmation for each action.
- **Grant Access:** Keep the existing Gmail SMTP/Resend invitation form, a fixed-height Send Invitation button, and the invitation list (status, provider acceptance, expiry, revoke). Each invitation/revocation requires its own password confirmation.
- **Audit Log:** Filter by actor, action or target; page through the recorded history. The log shows the signed-in username, action, target, timestamp and details. New sensor edits, location renames, role changes and maintenance status edits include prior and new values; older entries may contain less detail.
- **Alerts:** See the latest 200 real PostgreSQL alerts, severity, sensor, detector-derived data and current status; change status between New/Review/Acknowledged/Closed with password confirmation and an audit entry. This does not tune detector thresholds.
- **Notifications:** See the latest 200 real PostgreSQL notifications and their recipient; mark read or unread. Read timestamps are persisted in a new nullable `digital_twin.notifications.read_at` column. The LAN launcher adds that column idempotently, preserving existing notifications.

### Validation

1. Back up the existing PostgreSQL database and pull `design/clean-dashboard-preserve-features`.
2. Run `npm run build`, `npm run test:admin:step-up`, then `npm run host:lan`. The launcher performs an additive notification schema migration.
3. Sign in as Admin and verify each separate sidebar item. Accounts should no longer appear below the invitation form, and Audit Log should no longer be confined to the Access card.
4. In Alerts, change a test alert from New to Review: verify the password prompt, saved status and `alert.status` audit entry.
5. In Notifications, mark a test notification read: verify the password prompt, persisted read status and audit entry. If none exist yet, the list accurately shows an empty state rather than inventing notifications.
6. In Audit Log, check that the named actor, time, action and target appear. Test a location rename and ensure subsequent audit entries include previous and new values.
7. Verify Grant Access still sends via configured Gmail SMTP and that its button remains a consistent size.

Known limitations: The public operational Dashboard still does not enforce website-wide login; this update does not change the BIM model or static simulator. The site uses HTTP over LAN, so password confirmations require a trusted private network until HTTPS is configured. The alert detector may independently create or update alerts during subsequent simulation activity.

## Announcements replacing the Admin Notifications tab

The Administration sidebar now shows **Announcements** instead of **Notifications**. This is a separate editorial feature, not a renaming of sensor alert notifications.

- Create a draft with a title and message.
- Publish the draft to make it visible under the main TwinLabs sidebar → **Announcements** for all LAN website visitors.
- Edit an existing announcement, return it to draft, or archive it to remove it from the public listing without deleting its history.
- Record who created or last modified each announcement and capture each change in the Admin Audit Log.
- Every create, edit, publish or archive operation uses a one-time Admin password confirmation.
- The public page shows **published announcements only**, sorted newest first, with a refresh button.

The original `digital_twin.notifications` table and the real-time **alert bell** are retained. Those relate to automatic sensor alerts and are not edited by the new Announcements editor. The new records live in `digital_twin.announcements`, which `npm run host:lan` creates additively when missing.

To test: run `npm run build` and `npm run host:lan`; open Admin → Announcements; create a draft; publish with your Admin password; open the normal site → Announcements and check it appears. Archive the notice and confirm it disappears from the public listing but remains in Admin history and Audit Log. This update has not been verified on your Windows environment until those tests pass.

## Dedicated login screen

TwinLabs now renders the existing PostgreSQL-backed **Sign in / Redeem invitation** form on its own landing screen instead of opening it in a popup over the dashboard. After an administrator signs in, the Admin Workspace opens. After a Viewer signs in, the building overview opens. Existing sessions are checked against `/api/admin/session` when loading the app; logout returns to the login screen. Invite links still open the registration form.

**Important limitation:** this UI change is *not* website-wide API protection. The existing telemetry, BIM and other public backend routes remain accessible on the LAN without a login; backend authentication must be enforced on those routes for a production access-controlled deployment. Admin management endpoints retain the existing PostgreSQL authorization and per-write password confirmation.

If Admin still shows **Notifications** instead of **Announcements**, stop the host, pull `design/clean-dashboard-preserve-features`, run `npm run build`, restart `npm run host:lan` and reload the page. Check the output of `git branch --show-current` and `git log -1 --oneline` if the old UI persists. Verify the announcements storage migration appears in host startup logs, and sign in as Admin to create and publish a test announcement.
