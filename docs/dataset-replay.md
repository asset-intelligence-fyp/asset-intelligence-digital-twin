# Exact dataset replay and website setup

The supplied `generated(1).zip` contains generated CSVs/manifests, not the original
`people_driven_v3.0` generator implementation. The new simulator replays its observations
exactly; it does not reproduce the unavailable stochastic generator or invent intermediate
readings. It works directly from the ZIP, without extracting the approximately 1 GB of CSVs.

## What was checked

| Split | Time range (Malaysia) | Sensor rows | Complete batches | Injected events |
| --- | --- | ---: | ---: | ---: |
| normal_weather_2023_2025 | 2023-01-01–2025-12-31 | 5,681,664 | 315,648 | 0 |
| fault_weather_2026_q1 | 2026-01-01–2026-03-31 | 466,560 | 25,920 | 216 |

Both splits contain 18 registered sensors at five-minute intervals. The full CSV audit
found no incomplete, duplicate-sensor or out-of-order batches. IDs, types, units and source
room IDs match `shared/sensorRegistry.json`. See [audit counts](dataset-audit.json).
The manifest identifies synthetic building readings and weather input as
`NASA_POWER_hourly_interpolated`; weather provenance was not independently established.

The fault split deliberately has 223 missing values, 312 `noisy` quality annotations and
1,366 `drift` annotations. Missing observations become JSON/SQL NULL and display
**Unavailable**; charts break at the gap. Other numeric values are replayed unchanged.
Injected `noisy`/`drift` annotations are withheld from the online stream because they would
reveal evaluation answers. The original annotations remain untouched in the source CSV.
`quality` is `synthetic` for available observations and `missing` for absent ones.

The normal split has 12 synthetic scheduled maintenance rows. The fault split's maintenance
log is header-only. Injection labels are not independently reviewed maintenance events.
The manifest's `scenario` field says `normal` in both partitions; the replay validates the
split against the `faults` boolean instead.

## Run on Emily's Mac

1. In VS Code open the Git project folder, not an old downloaded ZIP copy. Pull the
   `feature/velvet-ui` branch only after saving/committing unrelated local work. Do not
   discard `TODO.md` or generated output changes just to make a pull succeed.
2. Keep the original ZIP outside the repository, for example in Downloads. Install
   dependencies with `npm ci`. Python 3.10+ is recommended; replay uses its standard
   library and needs no pip packages.
3. Copy `.env.example` to `.env` only if you do not already have `.env`. Add these lines
   to your existing file (adjust the exact ZIP filename/path):

```dotenv
DATASET_PATH="/Users/emily/Downloads/generated(1).zip"
DATASET_SPLIT=fault_weather_2026_q1
DATASET_START=2026-01-01T08:00:00+08:00
SIM_INTERVAL_SECONDS=2
SIM_CLOCK_DOMAIN=same_host
```

4. Run the complete application:

```bash
TWIN_STORAGE=memory npm run dev
```

Open http://localhost:5173/. Open **Simulator** to see the split, original dataset time,
18 channels and latency measurement panel. `npm run dev` starts the API, website, assistant
bridge and dataset replay. With no DATASET_PATH it starts the website but leaves the feed
empty, with a configuration message. There is no silent random-data fallback.

The first injected event starts on January 1 around 08:25 Malaysia time; some missing-data
and noise cases occur earlier. Replay at two-second cadence advances five dataset minutes
per batch: 150× acceleration when delivery keeps up. Dataset timestamps are historical;
source release timestamps are current wall time. At 300-second cadence it runs at the
original sampling speed. Data freshness between five-minute source samples is not improved
by choosing faster delivery.

Control+C stops the application. Replay stops at EOF and does not wrap to the beginning.
The website remains available if just the replay process finishes or fails; check Terminal
for its explicit error. Run only one publisher per API. A new run clears the active website
history so the 2023 normal split cannot mix with a previous 2026 fault run.

For a separately controlled simulator set `SIMULATOR_AUTOSTART=false`, start the app, then
use a second Terminal:

```bash
npm run simulator -- --ticks 40
```

Optional `.env` settings: `DATASET_END` (exclusive ISO time), `SIM_TICKS`, `PYTHON`,
`SIM_INTERVAL_SECONDS`, `DATASET_SPLIT`. The CLI also accepts an extracted `generated/`
directory and `--inspect` to print the manifest without sending observations.

## PostgreSQL and retention

For persistent runs use your separate `digital_twin_18` database and run `npm run db:setup`
again before starting. This adds `replay_id`, a receipt timestamp and supporting indexes,
and allows NULL reading values. It drops no tables. Run `npm run dev` without forcing
memory mode and verify the storage label says PostgreSQL.

Transactions commit all 18 observations before the API broadcasts one SSE batch. Records
are unique by sensor/time; replaying the same period updates those observations. This is
not an immutable archive of every simulation run. The active replay ID is recovered after
API restart for bootstrap/history; live receipt coverage starts empty until delivery resumes.
Memory retains at most 18,000 readings and resets at API shutdown. Browser history retains
at most 30,000 readings; long-history model training requires separate offline data handling.

The existing IFC room aliases remain demonstration mappings. The source's `L03-OPEN-01`
is presented in the model's Level 2 office, for example. A transport change does not establish
physical placement accuracy.

## Model evaluation boundary

Use only the normal split for development/training/reference fitting. Freeze thresholds,
model, prompts and features before scoring the separate fault split. Never use held-out
fault CSVs as an LLM normal-history reference. The old LLM_HISTORY_DB option is not
automatically rebuilt from this ZIP; an unrelated historical SQLite file is not validated
by the new replay.

The online publisher reads only `run_manifest.json` and `sensor_history.csv`. It never
loads employee records, badge events, ground-truth labels/events, maintenance descriptions
or future training features. Labels belong in an offline evaluator, not the chatbot prompt.
A passed replay test is not evidence of ≥85% AI accuracy. The existing evaluator and
[performance procedure](performance-evaluation.md) remain separate from data delivery.

## Protocol and failure behaviour

HTTP POST uses a persistent connection, one in-flight batch and up to three retries with
bounded backoff. The identical payload and batch ID are reused after a transient failure.
Recent retries (256 IDs per running API) are idempotent; conflicting reused IDs and stale
sequences are rejected. Errors stop the replay rather than skipping samples. This is not
exactly-once delivery across API restarts; replay values are upserted but timing/event IDs
may restart. Keep a single publisher and restart a bounded benchmark after interruptions.

SSE event IDs allow automatic reconnect and replay of up to 128 cached batches in the
same API process. Expired cursors trigger a bootstrap resynchronization. Slow clients are
disconnected when socket writes exceed backpressure, then reconnect and recover from
that buffer or snapshot. This bounds retained streaming state but is not a durable broker.
History bootstrap is a snapshot, not a latency sample; only actually delivered, rendered
batches produce browser acknowledgements.
