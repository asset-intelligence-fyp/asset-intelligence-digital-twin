# Snowdon Towers Level 5 — architectural and HVAC viewer

## Architecture and telemetry

The BIM viewer loads two existing XKT models into one xeokit scene:

- HVAC and physical sensor objects: `/models/Snowdon_Level5_Model+HVAC.xkt`
- Architectural walls, room partitions and slabs: `/models/Snowdon Towers Sample Architectural.xkt`

The physical sensor GlobalIds are preserved for selecting the eight mapped Level 5 devices. Their live readings continue to arrive through PostgreSQL and the existing SSE endpoint; no MQTT or database changes are required by the new view controls.

## Default floor cut: user-identified Level 5 slab

The reference is the `IfcSlab` selected by the user in the BIM viewer screenshot:

- **IFC GlobalId:** `19jRsGRmHCtQuanP7b0FIs`
- **Object name:** `Floor:Finish Floor - Polished Concrete (Grey):2113320`
- **Type:** `IfcSlab`

The viewer resolves that actual object in the scene (primary XKT or globally-prefixed architectural XKT), reads its bounding box and places the lower section plane slightly below its **bottom face**. The plane is `dir: [0,-1,0]`, discarding geometry below Level 5. Neither the bottom-of-HVAC heuristic nor the nearest-slab heuristic is used for the default cut.

**Crucial:** The primary `Snowdon_Level5_Model+HVAC.xkt` also contains some architectural walls and slabs. The viewer therefore marks architectural IFC element types as clippable **inside the primary model as well as in the secondary architectural model**. Physical sensor GUIDs and HVAC ducts/equipment remain non-clippable. This avoids the previous situation where the primary XKT's entire building structure survived every architectural section plane.

If the specified slab cannot be found or validated, the viewer does not attempt an unverified lower cut and instead reports a warning. Select the correct `IfcSlab` object and click **Cut below selected floor** to set a new reference interactively; this does not require changing Revit or reconverting IFC.

The existing **Restore visible model** action disables the floor and camera planes and restores both scene layers.

## View options

- **Walls + floor (normal)**: the default view, without a camera-facing section.
- **Follow camera section**: enables a side section plane facing the current camera yaw. As the operator orbits, the plane orientation is recalculated from the camera's view-matrix event. The side plane stays vertical so camera pitch does not inadvertently remove the floor.
- **3D View / Plan view / Home**: existing camera navigation controls.
- **Show architecture**: hides or restores the architectural model without affecting physical sensors.

The camera-following section clips **only the architectural layer**. HVAC and sensor objects are explicitly non-clippable and remain visible in both modes. Use **Restore visible model** if architectural geometry disappears; this disables both clipping planes and restores both model layers.

## Larger BIM workspace

The BIM Viewer page uses a narrower right inspector for additional model width. The **Expand** button requests browser fullscreen on the viewer **and sensor inspector together**. Use the button again, or press **Esc**, to leave fullscreen. This is user-initiated and does not require a separate fullscreen library.

## Local verification

```bash
git switch feature/level5-architecture-slice
git pull --ff-only origin feature/level5-architecture-slice
npm run dev
```

Go to `http://localhost:5173/bim-viewer`, hard refresh, and check:

1. Architecture and HVAC are visible without clicking any recovery button.
2. No `Enable Level 5 crop` checkbox or east-west/north-south axis dropdown remains.
3. Switching to **Follow camera section** adjusts the cut direction as the view is rotated.
4. Returning to **Walls + floor** restores the walls; sensor object selection works.
5. **Expand** fills the screen while retaining the sensor inspector.

If walls or ducts disappear, check the browser console for `Skipped under-floor cut` warnings and inspect the model coordinate systems. The viewer cannot reconstruct IFC geometry absent from the exported XKT.

The code modifications were inspected for JavaScript syntax but have not been run in a live browser by the authoring environment.

## 2026-10-20 visibility safeguard

- The user observed a blank scene when **Follow camera section** was selected and **Show architecture** was off. The previous implementation made HVAC clippable in camera mode, allowing all geometry to be hidden.
- HVAC entities are now kept visible and non-clippable regardless of view mode.
- The camera-aligned clipping plane is centred on the **architectural** model bounds, rather than HVAC bounds.
- A potentially unsafe below-floor datum causes automatic slicing to be skipped, with the full geometry retained.
- **Restore visible model** disables both floor and camera planes, re-enables the architectural layer, and restores the camera.
- JavaScript syntax checks and simulated model-state tests passed; actual browser rendering must still be verified locally.

## 2026-10-20 lower-wall trimming update

- Moved the architectural lower cut from `HVAC minY - 3.5` to `HVAC minY - 0.25` scene units, trimming more of the lower-storey wall geometry.
- Removed the 70%-building-height cutoff, which could erroneously disable trimming on higher floors.
- Retained checks that the cut lies within the architecture's vertical extent and leaves some geometry above it.
- Re-applies the floor undercut when the architectural layer is re-enabled, while keeping **Restore visible model** fully unclipped.
- JavaScript syntax and a simulated viewer test passed, including startup, camera section, architecture toggle and recovery. Browser rendering against the actual XKT still needs checking.

## 2026-10-20 loading-state safeguard

- The initial HVAC `.xkt` loading callback now catches post-load viewer errors separately from model transfer/decoding errors.
- After 25 seconds without a `loaded` event, the loading card explains that processing is delayed and directs the developer to the browser Network and Console panels. This warning does not stop loading.
- Error events display a file-path-specific message instead of leaving a permanent spinner.
- Repeated per-object HVAC visibility updates were replaced by one-time/batched clippability configuration where available.
- Unit cases validate selecting the nearby Level 5 slab and safely rejecting unclassified, misaligned, or ground-floor-only geometry.

## 2026-10-20 reference-floor implementation

- Exact visual floor reference: `19jRsGRmHCtQuanP7b0FIs` (finish floor, polished concrete grey)
- Lower section placement: `slab.aabb[1] - small_margin`, not `HVAC.aabb[1] - floor_drop`
- Both the primary and secondary models' architectural elements are eligible for clipping; sensor objects and ducts are protected
- The user may manually recalibrate with **Cut below selected floor**
- Syntax, explicit-floor unit cases and a simulated 2-model lifecycle test passed, including cut activation, sensor protection, camera mode, recovery and loading-overlay removal
- The actual 3D cut still requires inspection in the developer's browser; no live xeokit rendering was performed by the authoring environment
