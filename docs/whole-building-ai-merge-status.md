# Whole-building AI merge status — two distinct architectures

The local commit `7b87d48` is the **newer 18-sensor, five-location, whole-building**
application with an HTTP simulator, whole-building xeokit model, replay, what-if
scenarios, Command Palette and room assistant. It runs `server/sensorServer.js`.

The remote commit `d2ec7c1` contains an AI adapter for the **older nine-point
Snowdon Towers Level 5** application. It registers `/api/ai/status` and
`/api/ai/analyze` in legacy `server/index.js` and retrieves the nine named
points from a PostgreSQL schema containing `sensor_points`, `equipment`, etc.

## Merge resolution

For the six conflicted files, preserve the local whole-building frontend and
room assistant, and keep the remote AI source modules available for review.
Replace outdated frontend tests with tests matching the active whole-building
frontend. This resolves Git conflicts but **does not by itself finish the
18-sensor R4.3.1 integration**.

The existing local assistant calls `/api/assistant/health` and
`/api/assistant/ask`. Its backend and Ollama behaviour must be checked in the
active server code before any claim that P2 Concise or hybrid semantic validation
are connected. Do not claim the R4.3.1 synthetic development F1 scores for the
whole-building stream.

## Required code before completing the integration

Inspect these **local** sources, which were not included in the conflict ZIP:
`server/sensorServer.js`, other `server/*.js` assistant files,
`shared/sensorRegistry.json`, `src/services/twin.tsx`, `package.json`,
plus the `twin18` SQL schema and relevant tests.

Then adapt the verified evidence retrieval and semantic checks to the real
18-point registry, preserve source provenance and timestamp cutoff, add
read-only data retrieval, wire the API into the actual running Express server,
and test Qwen3 1.7B / P2 Concise against the new data representation.

**Do not** copy the Level 5 `SAT-501A` schema or invent mappings from Level 03
`CO2-L03-MEET-01` to Level 5 points.
