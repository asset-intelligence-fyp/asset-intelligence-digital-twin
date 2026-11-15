# Alpha submission checklist — COS40005

This file separates what is committed from what must be verified on the computer used for the actual presentation. A passing unit test is **not** the same as a validated physical-building result.

## Version control and reproducibility

- [x] Submission snapshot created as `release/alpha-submission-2026`.
- [x] Root README gives memory-mode and PostgreSQL/TimescaleDB installation, simulator, alerts, Qwen, admin and test commands.
- [x] The older development branches and prior commit history are preserved.
- [ ] On the demonstration Mac, check `git status -sb`, pull `main`, and run `git lfs pull` before testing.
- [ ] Confirm `npm run model:verify` can read the full XKT model, not an LFS pointer.
- [ ] Confirm no private `.env`, passwords, private fault labels, local SQLite history or credentials are committed. Rotate any secrets already exposed historically.

## Administrator demonstration\n\n- [x] `npm run admin:setup` safely generates a separate local admin password and hash while preserving the existing .env database settings. No shared login credentials are checked into GitHub.\n- [ ] On the demonstration computer, run `npm run admin:setup` and keep the generated password private. Restart the API.\n- [ ] Run `npm run admin:check -- --verify-login`; verify authenticated login/session and, if PostgreSQL is configured, database table access.\n- [ ] Log in through the website at http://localhost:5173, open Database, and capture proof without exposing the password or hash.\n- [ ] If an instructor runs a separate clone, have them generate their own local credentials. The hash previously shared between students is not a login password.\n\n## Build and tests

```bash
npm ci
npm run build
npm test
npm run test:ai
npm run test:alerts
python3 -m unittest discover -s tests -p 'test_*.py'
```

- [ ] Record command outputs for the **submitted commit**, including skipped/blocked tests and hardware/OS details.
- [ ] Load the BIM viewer in a real browser with WebGL 2 and capture a screenshot.
- [ ] Run the hybrid simulator: verify 18 indoor channels and four separate virtual outdoor channels.
- [ ] Run the rain, busy-building and public-holiday presets and verify generated-reading changes.

## PostgreSQL / TimescaleDB

- [ ] Back up the development DB. Verify the correct `PGDATABASE` or `DATABASE_URL` and `TWIN_DB_SCHEMA=digital_twin` in the **untracked** local `.env`.
- [ ] Confirm TimescaleDB is installed/enabled on the target DB. Run `npm run db:setup:v3` and `npm run db:check`; save output proving the v3 sensor_readings hypertable, 18 sensors and database name.
- [ ] Run `npm run dev` **without** `TWIN_STORAGE=memory`; verify `/api/health` reports PostgreSQL and the expected schema/hypertable.
- [ ] Demonstrate that sensor readings, threshold alerts, acknowledgement and recovery persist across a restart.

## Alerts and assistant

- [ ] Inject the Toilet water-leak sensor fault using Simulation lab, then verify automatic critical alert, stored trigger and preceding readings, BIM navigation, acknowledgement and recovery.
- [ ] Identify alerts as **rule based** and **synthetic**, not Qwen detections; verify no duplicate incident for a sustained condition.
- [ ] If demonstrating Qwen, run `ollama pull qwen3:1.7b`, verify model/bridge health and confirm the required normal-history SQLite database is available for historical comparisons.
- [ ] Record at least one real local Qwen response, latency and any fallback or validation failure.
- [ ] Do not report Agentic RAG as completed: adaptive multi-step agent selection has not been benchmarked in the submission.

## Report and evidence

- [ ] Match the report's sprint dates, named demonstrations, database status and screenshots against work actually performed during the sprint.
- [ ] Distinguish earlier Level 03 research evaluation scores from the new 18-point website and automatic threshold rules.
- [ ] State that meeting/client acceptance is unconfirmed unless evidence is available.
- [ ] Record limitations: no live BMS, no external notification service, no fully persisted Qwen forecasts/results, no physical fault validation.
- [ ] Verify assessors can access the private repository, or provide the repository ZIP/export if the submission process requires it.
- [ ] Submit the **repository URL** pointing to `main` or the exact tagged/release commit and retain the submission-time SHA.

## What remains unverified by GitHub source inspection alone

The actual TimescaleDB extension on the user's machine, real Ollama model inference, the user's current desktop checkout, and WebGL visual rendering require local checks. Previous tests documented in `docs/integration-verification.md` were performed on an earlier integrated commit; record fresh testing evidence for the submitted commit.
