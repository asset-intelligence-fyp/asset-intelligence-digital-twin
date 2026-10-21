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
| `/sensor-data` | Sensor Monitoring | 11 sensor_point registrations, last readings and available time series |
| `/model-results` | AI Forecasting | Current measured/simulated history; **no invented model predictions** |
| `/anomalies` | Anomaly Detection | Existing PostgreSQL demonstration anomaly records |
| `/historical-data` | Historical Data | Current browser/backend history only; separate prepared CSV clearly distinguished |
| `/simulator` | Sensor Simulator | Guidance and link to separately started Python Flask replay tool (port 8001) |
| `/settings` | Settings | Data-source table, persistent light/dark/system theme and workspace information |
| `/assets`, `/assets/:id` | Existing asset directory/detail | Remains available as a secondary navigation item |
| Assistant drawer | Existing prototype assistant | Remains available via secondary navigation |

No database schema, MQTT topic, simulator, XKT geometry or sensor mapping files were modified for this redesign.

## Appearance

Use the top-bar moon/sun icon for a quick theme toggle, or **Settings → Appearance** to choose **Light**, **Dark**, or **System**. The choice stays on that browser. In System mode it follows the OS preference.

## Important source/AI distinctions

The uploaded design PDFs contained **static illustrative values, fake forecast predictions and placeholders for physical sensors**. These are *reference designs only* and are **not** copied into working data fields. The new UI:

- Uses the PostgreSQL bootstrap and SSE readings where available.
- Shows **—** or an empty-state message when no data has been loaded.
- Marks the 11-point stream as simulated, not physical Snowdon Towers measurements.
- Does not claim TFT/Chronos training metrics or prediction confidence.
- Does not pretend that the Python simulator's Start/Stop/Reset buttons work inside the frontend. Open the separate real Flask tool.
- Preserves the actual level clipping direction `[0, 1, 0]` and all existing xeokit BIM interactions.

## Local development and checks

```bash
git fetch origin
git switch feature/ui-redesign
git pull --ff-only origin feature/ui-redesign
npm install
npm run dev
```

Open `http://localhost:5173`; verify the eight routes and both themes. For relevant work, start PostgreSQL and Mosquitto separately, then run `python app.py` under the final Level 5 simulator to test live readings.

```bash
node --test tests/uiRedesign.test.mjs
node --test tests/level5SimulatorRegistry.test.mjs
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
- [ ] Simulator link opens the separately running local Python interface when available.
- [ ] Asset detail and assistant remain reachable.
- [ ] Tablet/mobile layouts keep navigation usable and do not cover the 3D canvas.

## Verification status

JavaScript parsing and simulated data-template checks passed in the authoring environment. A full `npm run build` and real browser rendering against the locally generated XKT files **have not been executed** here. Complete the above checks before merging into `develop`.


## BIM viewer status-board update (21 October 2026)

The BIM Viewer now uses a three-column workspace at desktop sizes:

1. **Left sensor tree** — the existing searchable Level 5 xeokit sensor navigator in a separate collapsible panel, not over the BIM canvas.
2. **Middle canvas and persistent sensor cards** — eight mini cards are always visible above the real xeokit viewer. Each uses the physical device's `sensorId` and IFC GlobalId from `src/data/level5Sensors.js`; Unit 507's ABB card displays TEMP, HUM and CO2 together.
3. **Right selected-sensor inspector** — the existing PostgreSQL inspector now displays large measurement tiles with units, quality and latest update time for every measurement channel on the selected physical sensor.

Clicking a mini card calls the same `controller.selectSensor(guid)` method used by the existing BIM navigator. It focuses/highlights the real IFC element and fires the existing selection handler, updating the inspector without reloading the BIM model. The existing floor clipping, camera controls and fullscreen viewer remain unchanged. Cards receive in-place updates from the existing MQTT→backend→SSE path; freshness is also checked periodically.

The status dots are **informational** and do not indicate verified equipment health:

- **Green** = a simulated sensor reading timestamp within 5 minutes and no *matching* active database anomaly record
- **Amber** = a matching open anomaly record or invalid reading quality
- **Red** = a matching open high/critical-severity anomaly record
- **Gray** = no recent valid timestamp/measurement available

Statuses are matched by point code or physical sensor ID, not inferred from an unrelated anomaly on the same HRU. Closed anomaly records are ignored. PostgreSQL demo anomalies are not confirmed real building faults.

The top-right header now keeps data-source status, theme/notifications and Facility Manager account controls in separate aligned groups, with responsive hiding of low-priority text on small screens.

### Review checklist

- [ ] At 1440px+ desktop width, data-source status, icons and user account share one header row.
- [ ] BIM scene, dedicated sensor tree, all 8 mini cards and right sensor inspector fit without overlapping.
- [ ] Selecting a mini card focuses the sensor BIM element and updates the inspector; selecting a BIM object highlights its corresponding mini card.
- [ ] S-L5-008 shows three independent TEMP/HUM/CO2 readings with stored units.
- [ ] New MQTT readings update mini cards and the selected inspector; stopping replay eventually turns stale cards gray.
- [ ] Demo high/critical anomaly linked to a point lights the matching card red; unrelated sensors remain unaffected.
- [ ] Dark/light themes, fullscreen, small screens and level-5 clipping continue to work.

`node --test tests/bimSensorCards.test.mjs` runs data-state and source integration checks. Real xeokit rendering, actual MQTT delivery and responsive browser checks are **not** verified from the remote editing environment.
