# Snowdon Towers Level 5 BIM viewer

## Models and sensor mapping

The xeokit viewer loads:

- `/models/Snowdon_Level5_Model+HVAC.xkt` — HVAC, sensors and architectural objects present in the new IFC conversion
- `/models/Snowdon Towers Sample Architectural.xkt` — additional architectural context

The Level 5 sensor registry (`src/data/level5Sensors.js`) maps eight physical sensors to their IFC GlobalIds, plus the unlocated fan-status telemetry point. Live readings continue through the existing backend/database/SSE pipeline. The source IFC files and converted XKT assets are unchanged by these UI changes.

## Floor cut

A single automatic lower section plane uses the identified finish-floor slab
`19jRsGRmHCtQuanP7b0FIs` (`IfcSlab`). Its Y position is just below the slab's lower face, when the object is present with a valid AABB.

The plane always uses `dir: [0,-1,0]`. The xeokit SectionPlane discards the half-space in its direction, so this removes elements **below** the slab. Previously, plane creation and updates used opposite directions; those now match.

Architectural objects in the primary and secondary XKT files can be clipped; mapped sensor objects and HVAC equipment remain protected. If the slab cannot be found or validated, the viewer leaves the model uncut and displays a warning instead of guessing another elevation.

## Minimal controls

The BIM viewer now has two small floating, **collapsible** panels:

- **Level 5 sensors** (left), containing sensor search and the eight clickable physical devices. The heading retains the model-mapping count.
- **View options** (right), containing **Show architecture** and **Restore visible model**.

Both panels are collapsed by default. Click the panel heading to expand or collapse it. Keyboard focus and Enter/Space activation are provided by the native HTML `details/summary` element.

The **Follow camera section** and **Cut below selected floor** buttons/modes were removed, along with camera-driven section events. The existing orbit, plan, fit, home and fullscreen features remain.

## Recovery and local verification

If geometry disappears, expand **View options** and click **Restore visible model**, which deactivates the floor plane and restores both model layers.

```bash
git switch feature/level5-architecture-slice
git pull --ff-only origin feature/level5-architecture-slice
npm run dev
```

Open `http://localhost:5173/bim-viewer`, hard-refresh, and verify:

1. Neither of the two floating panels obscures the model initially.
2. Sensor panel expands, searches by ID or asset, and clicking a sensor focuses the correct BIM entity.
3. View options expands, toggles architectural context, and the recovery action works.
4. The selected Level 5 slab and geometry above it remain visible, with lower walls clipped.
5. 3D/plan/fit and fullscreen work, and existing live sensor readings still update.

JavaScript syntax and static UI regression checks passed. **The actual xeokit rendering and cut elevation still need verification against the local XKT models.**
