# Asset Intelligence frontend redesign (light / dark)

## Scope and design references

The frontend was restyled using the supplied desktop reference PDFs for:

- Overview
- BIM Viewer
- Sensor Monitoring
- AI Forecasting
- Anomaly Detection
- Historical Data
- Sensor Simulator
- Settings

Both **Light** and **Dark** variants are supported. The new theme is not a static image: the CSS/layout is implemented on top of the existing Vite single-page app.

## Branch and files

- Branch: `feature/ui-redesign`
- Base: `feature/level5-architecture-slice` (contains existing xeokit and MQTT work)
- `src/ui-redesign.css`: CSS tokens, dark/light styling, cards, tables, responsive grids and BIM workspace.
- `src/theme.js`: light/dark/system appearance handling and persistence in browser `localStorage`.
- `src/redesignViews.js`: pages grounded in PostgreSQL frontend cache.
- `src/main.js`: new navigation shell and routes; original xeokit/REST/SSE preserved.
- `index.html`: loads the new CSS after the existing viewer styles.
- `tests/uiRedesign.test.mjs`: empty-state and data integration smoke tests.

## Routes

| Route | View | Source |
| --- | --- | --- |
| `/` | Overview | Existing live xeokit dashboard model + PostgreSQL summary and charts |
| `/bim-viewer` | BIM Viewer | **Real** xeokit Level 5 XKT and selectable BIM sensors |
| `/sensor-data` | Sensor Monitoring | 9 active sensor-point registrations, last readings and available time series |
| `/model-results` | AI Forecasting | Current measured/simulated history; **no invented model predictions** |
| `/anomalies` | Anomaly Detection | Existing PostgreSQL demonstration anomaly records |
| `/historical-data` | Historical Data | Current browser/backend history only; separate prepared CSV clearly distinguished |
| `/simulator` | Sensor Simulator | Independent nine-point synthetic Python simulator over MQTT, with 9/9 ingestion status |
| `/settings` | Settings | Data-source table, persistent light/dark/system theme and workspace information |
| `/assets`, `/assets/:id` | Existing asset directory/detail | Remains available as a secondary navigation item |
| Assistant drawer | Existing prototype assistant | Remains available via secondary navigation |

The later nine-point feature changes the sensor-point registry, adds a safe SQL migration, and preserves the existing XKT geometry. The replacement independent Python simulator publishes nine active points via MQTT; its telemetry is synthetic and must be run separately.

## Appearance

Use the top-bar moon/sun icon for a quick theme toggle, or **Settings → Appearance** to choose **Light**, **Dark**, or **System**. The choice stays on that browser. In System mode it follows the OS preference.

## Important source/AI distinctions

The uploaded design PDFs contained **static illustrative values, fake forecast predictions and placeholders for physical sensors**. These are *reference designs only* and are **not** copied into working data fields. The new UI:

- Uses the PostgreSQL bootstrap and SSE readings where available.
- Shows **—** or an empty-state message when no data has been loaded.
- Marks the nine-point stream as simulated, not physical Snowdon Towers measurements.
- Does not claim TFT/Chronos training metrics or prediction confidence.
- Does not pretend that the Python simulator's Start/Stop/Reset buttons work inside the frontend. The old 11-point Flask tool is not yet compatible with this new profile.
- Preserves the actual level clipping direction `[0, 1, 0]` and all existing xeokit BIM interactions.

## Local development and checks

```bash
git fetch origin
git switch feature/ui-redesign
git pull --ff-only origin feature/ui-redesign
npm install
npm run dev
```

Open `http://localhost:5173`; verify the eight routes and both themes. For relevant work, start PostgreSQL and Mosquitto separately, do not run the old 11-point Python publisher against the new active database profile; run only the replacement independent Python script under tools/independent_3hru_live.

```bash
node --test tests/uiRedesign.test.mjs
node --test tests/level5NinePointProfile.test.mjs
node --test tests/bimSensorCards.test.mjs
npm run build
```

### Browser regression checklist

- [ ] Overview uses the real xeokit geometry and opens/selects Level 5 sensors.
- [ ] BIM Viewer still loads, clips below the correct floor, allows orbit/fullscreen, and selects 8/8 mapped physical devices.
- [ ] Light and Dark modes are readable; System follows OS and persisted choice survives reload.
- [ ] Sensor Monitoring renders registered points and SSE refreshes visible latest values.
- [ ] Forecast view shows no fictional accuracy, confidence or predicted readings.
- [ ] Anomaly Detection shows database records, not a fabricated injected fault.
- [ ] Historical screen does not mistake the full local dataset row count for loaded API history.
- [ ] Simulator page reports actual accepted points out of nine and names missing sensor channels.
- [ ] Asset detail and assistant remain reachable.
- [ ] Tablet/mobile layouts keep navigation usable and do not cover the 3D canvas.

## Nine-point Level 5 telemetry update

The current dataset uses nine active point names:
`SAT-501A`, `MAT-501A`, `FS-501A`, `SAT-504`, `DP-504`,
`DPCMD-504`, `SAT-507`, `CV-507`, `S-L5-008-TEMP`.

All eight original physical BIM GlobalIds remain intact. Their new sensor IDs are the CSV point names. Three former air-velocity BIM rows are **logically reassigned** to MAT-501A, DPCMD-504 and CV-507 at the user's direction; this does not verify the actual device hardware. Only FS-501A has no IFC GlobalId. The independent Python simulator was added under tools/independent_3hru_live; use its MQTT-enabled publisher.

Apply `database/seed_level5_nine_point_profile.sql` in PostgreSQL after
pulling this branch. See
[`docs/level5-nine-point-dataset-migration.md`](level5-nine-point-dataset-migration.md).

The original eleven-point Python simulator and initial SQL seed belong to the previous prototype and must not be treated as the current telemetry profile.

## Verification status

JavaScript parsing and simulated data-template checks passed in the authoring environment. A full `npm run build` and real browser rendering against the locally generated XKT files **have not been executed** here. Complete the above checks before merging into `develop`.


## BIM viewer status-board update (21 October 2026)

The BIM Viewer now uses a three-column workspace at desktop sizes:

1. **Left live sensor list** — nine status cards replace the old sensor-tree navigation, presented as one vertical searchable list of sensor ID, HRU asset, latest simulation value, status dot, and status text. Eight entries focus unchanged original IFC markers; the virtual fan-status entry is asset-linked without an IFC marker.
2. **Middle BIM canvas only** — the real xeokit viewer occupies the full height of the center column, without a status-card strip above it.
3. **Right selected-sensor inspector** — the existing PostgreSQL inspector continues to show selected sensor/asset metadata and live measurements.

Clicking an eight-IFC-linked mini card calls the existing `controller.selectSensor(guid)` method. Clicking FS-501A opens the asset-linked telemetry inspector without focusing nonexistent geometry. It focuses/highlights the real IFC element and fires the existing selection handler, updating the inspector without reloading the BIM model. The existing floor clipping, camera controls and fullscreen viewer remain unchanged. Cards receive in-place updates from the existing MQTT→backend→SSE path; freshness is also checked periodically.

The status dots are **informational** and do not indicate verified equipment health:

- **Green** = a simulated sensor reading timestamp within 5 minutes and no *matching* active database anomaly record
- **Amber** = a matching open anomaly record or invalid reading quality
- **Red** = a matching open high/critical-severity anomaly record
- **Gray** = no recent valid timestamp/measurement available

Statuses are matched by point code or physical sensor ID, not inferred from an unrelated anomaly on the same HRU. Closed anomaly records are ignored. PostgreSQL demo anomalies are not confirmed real building faults.

The top-right header now keeps data-source status, theme/notifications and Facility Manager account controls in separate aligned groups, with responsive hiding of low-priority text on small screens.

### Review checklist

- [ ] At 1440px+ desktop width, data-source status, icons and user account share one header row.
- [ ] Center contains only the full-height BIM viewer; all nine status rows are in the left scrollable/searchable sidebar, with no duplicate tree or cards above the canvas; right inspector fits without overlapping.
- [ ] Selecting a mini card focuses the sensor BIM element and updates the inspector; selecting a BIM object highlights its corresponding mini card.
- [ ] S-L5-008-TEMP shows room temperature; FS-501A renders ON/OFF and indicates no IFC marker.
- [ ] New MQTT readings update mini cards and the selected inspector; stopping replay eventually turns stale cards gray.
- [ ] Demo high/critical anomaly linked to a point lights the matching card red; unrelated sensors remain unaffected.
- [ ] Dark/light themes, fullscreen, small screens and level-5 clipping continue to work.

`node --test tests/bimSensorCards.test.mjs` runs data-state and source integration checks. Real xeokit rendering, actual MQTT delivery and responsive browser checks are **not** verified from the remote editing environment.


## MQTT simulator replacement

The old `hru_digital_twin_simulator_v2` and eleven-point `level5_digital_twin_simulator_final` publishers were removed from this branch. Running legacy processes on the developer's machine must be stopped separately. `/api/live-status` measures **all nine** accepted current points rather than a single reading, and the Node MQTT contract rejects legacy/unapproved messages by provenance and topic. No physical measurements or AI inference are claimed.

## Refined BIM layout: single vertical sensor sidebar

The old left sensor navigator and separate three-column status-card strip above the canvas were consolidated into a **single searchable vertical list** on the left. Each row retains its live reading, sensor/asset label, freshness or anomaly state, and click-to-select behavior. The eight IFC-linked points still focus the actual xeokit geometry, while the virtual `FS-501A` opens the HRU-linked inspector without fabricating an IFC marker. Incoming MQTT→SSE updates modify row values in place; the search box and the BIM viewer are not reconstructed. The center column now contains only the full-height 3D BIM viewer, and the selected-sensor inspector stays on the right. Narrow viewports stack the panels with a vertically scrolling sensor list.

## Operational UI and live chart updates (21 October 2026)

The visible workspace no longer displays research/development instructions, prototype badges, oversized demonstration warnings, placeholder training splits, or fake evaluation sections. The source-status chip remains **Synthetic MQTT** and forecasting status remains **Unavailable** until an evaluated forecasting model exists; neither is relabeled as physical building telemetry.

The Overview, Sensor Monitoring, Historical Data, and AI Forecasting charts are now wrapped in per-channel live containers. As the browser receives an accepted `sensor-reading` SSE event from the existing MQTT/PostgreSQL backend, it updates the sensor cache and appends a history sample. A short 200 ms debounce then regenerates each active SVG *inside its chart container*, updating captions and current values without rebuilding the page, selected equipment inspector, or xeokit BIM scene. A chart can transition from an empty state to recorded points without navigation. The historical record table is still a snapshot loaded at navigation time; the graphs are live.

Check the page while the Python publisher is running (e.g. `--mqtt --interval-seconds 5`). In Overview and Sensor Monitoring, ensure the line changes without refreshing the browser; check Historical Data and the selected trend in AI Forecasting as well. Inspect the top-bar sensor coverage badge for MQTT freshness. Stopping the Python process stops new plot samples; no fictitious points are inserted.

Tests: `node --test tests/uiRedesign.test.mjs tests/liveCharts.test.mjs tests/bimSensorCards.test.mjs`; build: `npm run build`.

