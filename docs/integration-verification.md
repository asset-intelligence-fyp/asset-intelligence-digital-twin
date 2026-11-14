# Integration verification — 15 November 2026

Source: Amanda branch commit `965f02fe05628c6867cd8b70540f67b51b3f2239`. GitHub comparison confirmed it contains the complete committed history of Velvet UI at `f3c53c82d444f110ce9f18ff94233e55fa0719e3` (83 ahead, zero behind).

Verified before publishing:

- Production TypeScript/Vite build passed. Existing bundle-size advisory remains.
- Main suite: 42 passed, one optional dataset fixture skipped, one model test blocked because the GitHub connector supplies the Git LFS pointer rather than the model bytes. The model and its LFS pointer are unchanged by this integration.
- AI regression suite: 12 passed. These are code-level checks, not a new Qwen accuracy benchmark.
- Python hybrid simulator suite: 12 passed.
- Six new automatic-alert tests (included in the main suite) passed, covering memory and both PostgreSQL-compatible schemas, retained readings, SSE, acknowledgement, recovery, recurrence, restart and transaction rollback. One test sends real controlled Python hybrid batches through HTTP and checks a critical leak alert and 18/18 coverage.
- Rendered DOM interaction check passed: live notification → exact incident → retained table → correct washroom sensor/location → twin investigation banner → persisted acknowledgement → formatted chatbot response. Browser layout/WebGL rendering was not visually verified in this environment.

PostgreSQL SQL was executed using PGlite for integration tests. The TimescaleDB extension, Amanda's local PostgreSQL service, local Ollama inference and the actual Git LFS geometry still require runtime checks on the demonstration computer. Use `npm run db:check`, System status, and `npm run model:verify` after pulling and setting up the database.

Automatic alerts are explicit demonstration thresholds, not a claim that Qwen or Agentic RAG detects these incidents. Notifications are in-app. See [the run/demo guide](working-website-guide.md) for setup and limitations.
