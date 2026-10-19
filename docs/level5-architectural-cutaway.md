# Level 5 architectural cutaway

## Why the HVAC-only IFC has no walls

The sensor IFC `Snowdon_Level5_Model+HVAC.ifc` / `.xkt` contains the HVAC geometry from its Revit export.
The JavaScript viewer cannot reconstruct missing walls, slabs, or room boundaries from ducts.

To show the floor without modifying the original Revit walls, the BIM Viewer now loads **two scene models**:

1. The existing new `Snowdon_Level5_Model+HVAC.xkt` for HVAC and clickable physical-sensor IFC GUIDs.
2. The repository's existing `Snowdon Towers Sample Architectural.xkt` for walls, slabs, doors, windows, and architectural partitions.

The architecture XKT is a **candidate** context asset. Its geometry and coordinate system have NOT been confirmed to match the new HVAC IFC. The viewer reports a warning if the axis-aligned bounds don't overlap; a successful overlap alone does not prove perfect alignment.

## How the Level 5 crop works

Xeokit uses **world Y as up** in the current viewer configuration.

The Level 5 crop is **off by default**, so geometry remains visible while alignment is checked. After enabling **Enable Level 5 crop**, two section planes remove the geometry above and below a band around the Level 5 HVAC model:

- lower plane: HVAC minimum Y - `Below HVAC` adjustment, defaults to 3.5 model metres
- upper plane: HVAC maximum Y + `Above HVAC` adjustment, defaults to 1.5 model metres

Enable the crop checkbox and adjust these two sliders until the Level 5 floor slab, interior partitions, and appropriate wall height become visible. Turn the checkbox off (or click Reset / Show all geometry) if the scene disappears. The correct boundaries depend on model geometry; they are not verified floor elevations.

The separate **Extra section cut** slider creates a third clipping plane on demand. The HVAC model remains protected from automatic architectural slicing, but responds to an explicitly requested section cut.

`Show walls and floor` enables or disables the architectural context layer. The HVAC scene and sensor IFC IDs are unaffected. The architectural context uses prefixed entity IDs to prevent collisions.

## Start and check

From the project root on your local machine:

```bash
git fetch origin
git switch feature/level5-architecture-slice
npm ci
npm run dev
```

Ensure `public/models/Snowdon_Level5_Model+HVAC.xkt` exists locally. If missing, run `npm run convert:model` before opening the viewer. The XKT is currently **not** in GitHub: it is generated on the developer's computer.

Open http://localhost:5173/bim-viewer and verify:

1. Both the HVAC ducts and architectural context are visible at startup with the crop OFF.
2. The architectural status says `Walls and slabs shown`, with no model-alignment warning.
3. Lower and upper sliders control the visible floor band; the extra cut still works.
4. All eight mapped IFC sensor objects remain selectable and show live database readings.

## If walls/slabs still do not appear

- If architecture reports `No architectural geometry in XKT`, verify the XKT contains classified `IfcWall`/`IfcWallStandardCase`/`IfcSlab` elements.
- If the status reports **not aligned**, the architectural sample XKT likely uses different coordinates or geometry. Obtain a **matching full-building architectural IFC** from the same Snowdon Towers Revit model, with the same project/shared coordinate reference as the HVAC IFC. Convert that IFC to XKT and update the architectural URL in `src/xeokitViewer.js`.
- If some walls or floor are missing, those objects may not have been exported or may not be modeled; no frontend code can recover missing mesh geometry.
- Revit's **Room Separation Lines** are not necessarily exported as renderable XKT geometry. Actual partition walls will show; room labels/2D separators may require additional IFC space/room data and an overlay.

**Do not delete or modify shared/stacked walls in the RVT file.** A single full architectural model can be loaded as a separate scene layer and sliced non-destructively in the web viewer.
