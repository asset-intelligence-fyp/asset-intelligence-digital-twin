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
| `/simulator` | Sensor Simulator | Nine-point Python simulator integration pending; existing old replay is incompatible |
| `/settings` | Settings | Data-source table, persistent light/dark/system theme and workspace information |
| `/assets`, `/assets/:id` | Existing asset directory/detail | Remains available as a secondary navigation item |
| Assistant drawer | Existing prototype assistant | Remains available via secondary navigation |

The later nine-point feature changes the sensor-point registry, adds a safe SQL migration, and preserves the existing XKT geometry. The new Python simulator is not yet connected.

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

Open `http://localhost:5173`; verify the eight routes and both themes. For relevant work, start PostgreSQL and Mosquitto separately, do not run the old 11-point Python publisher against the new active database profile; the replacement script has not yet been supplied.

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
- [ ] Simulator page correctly reports that the new independent nine-point Python app is awaiting integration.
- [ ] Asset detail and assistant remain reachable.
- [ ] Tablet/mobile layouts keep navigation usable and do not cover the 3D canvas.

## Nine-point Level 5 telemetry update

The current dataset uses nine active point names:
`SAT-501A`, `MAT-501A`, `FS-501A`, `SAT-504`, `DP-504`,
`DPCMD-504`, `SAT-507`, `CV-507`, `S-L5-008-TEMP`.

All eight original physical BIM GlobalIds remain intact. Their new sensor IDs are the CSV point names. Three former air-velocity BIM rows are **logically reassigned** to MAT-501A, DPCMD-504 and CV-507 at the user's direction; this does not verify the actual device hardware. Only FS-501A has no IFC GlobalId. The new Python simulator remains to be connected.

Apply `database/seed_level5_nine_point_profile.sql` in PostgreSQL after
pulling this branch. See
[`docs/level5-nine-point-dataset-migration.md`](level5-nine-point-dataset-migration.md).

The original eleven-point Python simulator and initial SQL seed belong to the previous prototype and must not be treated as the current telemetry profile.

## Verification status

JavaScript parsing and simulated data-template checks passed in the authoring environment. A full `npm run build` and real browser rendering against the locally generated XKT files **have not been executed** here. Complete the above checks before merging into `develop`.


## BIM viewer status-board update (21 October 2026)

The BIM Viewer now uses a three-column workspace at desktop sizes:

1. **Left sensor tree** — the existing searchable Level 5 xeokit sensor navigator in a separate collapsible panel, not over the BIM canvas.
2. **Middle canvas and persistent sensor cards** — nine mini cards are always visible above the real xeokit viewer. Eight reuse the original IFC GlobalIds and the ninth fan-status card is asset-linked without a 3D marker; Unit 507 exposes its room-temperature point.
3. **Right selected-sensor inspector** — the existing PostgreSQL inspector now displays large measurement tiles with units, quality and latest update time for every measurement channel on the selected physical sensor.

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
- [ ] BIM scene, dedicated sensor tree, all 9 mini cards and right sensor inspector fit without overlapping.
- [ ] Selecting a mini card focuses the sensor BIM element and updates the inspector; selecting a BIM object highlights its corresponding mini card.
- [ ] S-L5-008-TEMP shows room temperature; FS-501A renders ON/OFF and indicates no IFC marker.
- [ ] New MQTT readings update mini cards and the selected inspector; stopping replay eventually turns stale cards gray.
- [ ] Demo high/critical anomaly linked to a point lights the matching card red; unrelated sensors remain unaffected.
- [ ] Dark/light themes, fullscreen, small screens and level-5 clipping continue to work.

`node --test tests/bimSensorCards.test.mjs` runs data-state and source integration checks. Real xeokit rendering, actual MQTT delivery and responsive browser checks are **not** verified from the remote editing environment.
