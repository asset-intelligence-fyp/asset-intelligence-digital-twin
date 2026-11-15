# TwinLabs website – integrated UI

This project uses the **uploaded TwinLabs React + TypeScript interface** as the base, retaining its navigation, component structure, design tokens, and responsive CSS. It is adapted for the Snowdon Towers **Level 5** Digital Twin: three HRUs, nine sensor points, eight original IFC marker GUIDs, and the existing backend.

## If you already pulled the updated `feature/ui-redesign` branch

The new TwinLabs frontend is already committed to that branch. Run `npm install`, then `MQTT_TOPIC='dt/+/+' npm run dev`. Random readings start by default.

## Integration into your current GitHub checkout

**Use this as a frontend overlay on your existing `asset-intelligence-digital-twin` repository** so you keep its PostgreSQL database, MQTT API, IFC/XKT models and current independent three-HRU Python simulator.

1. From the repository root, ensure you are on `feature/ui-redesign` and your working tree is clean. Back up `.env` and any local work.
2. Extract `twinlabs-integrated-overlay.zip` to a separate folder.
3. Run `bash path/to/extracted/twinlabs-base/install-into-repo.sh /path/to/asset-intelligence-digital-twin` (the installer checks the XKT and API and backs up replaced files).
4. Run `npm install` (a new lockfile is expected), followed by `MQTT_TOPIC='dt/+/+' npm run dev`.
5. Open http://localhost:5173. **Random simulation is the default** and generates local synthetic data every three seconds, so charts work without MQTT or PostgreSQL. Click the header button *Use MQTT* to use readings from the existing PostgreSQL + MQTT + SSE backend instead.

## What works

- Building overview with the **actual Snowdon Level 5 XKT model** (`public/models/Snowdon_Level5_Model+HVAC.xkt` from the existing repo), selection of eight mapped IFC sensor elements, HRU selection, live readings and auto-updating trends. No made-up ninth BIM marker.
- Searchable Asset register, three Level 5 HRU assets, live measurements, metadata and maintenance history from `/api/bootstrap`.
- Building Performance with temperature, damper and valve charts from the reading history; charts refresh when new values arrive.
- Sensor Monitoring, filtering/search, active values and per-point history.
- Event log from stored anomaly records, persistent API acknowledgements; locally generated test events can also be acknowledged and are labeled synthetic.
- Simulator page with start/pause/reset, update interval, source selection and test alert generation.
- Header switch from local random data to persisted MQTT ingestion. Random local values do not overwrite PostgreSQL.

The **AI assistant has a visual placeholder only**: a bottom-right launcher opens a panel with a clear “Coming soon” state and disabled message input. It does not connect to an AI service or generate responses. The starter's fictional predictive failures, energy/CO₂ statistics, confidence levels and false building metadata are removed because the nine-point dataset does not provide those inputs.

## Optional: random readings through the real MQTT pipeline

The default browser simulator is simplest. To also store random values in PostgreSQL and distribute them via MQTT/SSE, run one random publisher instead of the independent simulator:

```bash
python3 -m pip install 'paho-mqtt>=2,<3'
python3 tools/twinlabs_random_mqtt.py --interval 3
```

Then select *Use MQTT* in the website header. MQTT topics are `dt/<asset>/<point>`; the random publisher is explicitly tagged `SYNTHETIC_RANDOM_WALK_NINE_POINT`. The backend validator accepts either the old independent-simulation provenance or the new random-walk provenance. Do not run two publishers concurrently for the same channels.

## Limitations / verification

- **No actual AI forecast, trained anomaly detector or active AI assistant.** The Event log displays stored anomalies and explicitly generated test records, not model predictions.
- Only the original eight IFC GlobalIds map to selectable BIM objects; `FS-501A` is asset-linked but has no BIM geometry.
- The downloaded frontend overlay does not contain the private/large original BIM model or PostgreSQL database, which are retained from your existing repository.
- This assembly environment cannot access your Mac's database or broker, so validate the XKT rendering and live SSE on your laptop.
- The Node API's `/api/bootstrap` currently queries all historical sensor readings. Long-running deployments should paginate its history endpoint and use limited windows.

## Dependency installation and TypeScript build

The initial TwinLabs UI commit changed `package.json` from the previous Vite 8 site to React 18 / TypeScript / Vite 6, but its committed `package-lock.json` was still based on the earlier site. **Do not run `npm ci` until the lockfile is regenerated and committed.** With npm registry access, from the project root:

```bash
npm install
npm run build
git add package-lock.json
git commit -m "chore: synchronize TwinLabs package lock"
```

After this updated lockfile is committed, `npm ci` will work again. The simulator's synthetic test-alert record must be explicitly typed as `EventRecord` so `level: 'Warning'` remains within the `Critical | Warning | Info` union.

## Run checks

```bash
node --test tests/twinlabs_contract.test.mjs
npm run build
```
## AI Assistant placeholder

A persistent bottom-right **AI Assistant** button is available across all TwinLabs pages. It opens and closes a small non-modal preview panel, with keyboard **Escape** dismissal and a disabled message box. It does not make network requests, accept user prompts, or fabricate AI replies. The existing MQTT, PostgreSQL, sensor simulation and BIM model are unchanged. 

