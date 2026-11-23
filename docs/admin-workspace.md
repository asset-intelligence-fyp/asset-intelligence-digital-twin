# TwinLabs administration workspace

This feature is exclusive to `feature/amanda-lan-hosting` and is based on `development/ui-fixes`. The original team's branch, IFC/XKT model, camera controls, simulator, and ordinary operating pages are not edited by the management workspace.

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

## Confirmation for sensitive changes

Read-only administration views do not require extra prompts. Changes through Admin management APIs (sensor create/edit/delete; location rename; maintenance create/status; invitation create/revoke; user role/activation) require the logged-in administrator to re-enter their **existing Admin login password**. A successful verification authorizes management writes for **five minutes in that server-side session**. The backend returns HTTP 428 when confirmation has expired; the UI shows a password modal and retries the pending operation after successful verification.

The password is verified against the stored scrypt hash and is never stored in the frontend or logged. Five incorrect attempts lock password confirmation temporarily for fifteen minutes. This is a step-up check, not a substitute for network encryption: the LAN site currently runs on HTTP, so **do not use it for sensitive production credentials until HTTPS is configured**.

For validation, run `npm run test:admin:step-up` then `npm run build`. Test renaming a disposable location to verify that the password prompt appears, wrong passwords are rejected, and a correct password permits saving. Check the audit log afterwards.

Grant Access cards have been adjusted so the Send Invitation button stays a normal, fixed-height control regardless of Recent Activity content and email delivery status.
