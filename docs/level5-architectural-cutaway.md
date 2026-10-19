# Snowdon Towers Level 5 — architectural and HVAC viewer

## Architecture and telemetry

The BIM viewer loads two existing XKT models into one xeokit scene:

- HVAC and physical sensor objects: `/models/Snowdon_Level5_Model+HVAC.xkt`
- Architectural walls, room partitions and slabs: `/models/Snowdon Towers Sample Architectural.xkt`

The physical sensor GlobalIds are preserved for selecting the eight mapped Level 5 devices. Their live readings continue to arrive through PostgreSQL and the existing SSE endpoint; no MQTT or database changes are required by the new view controls.

## Default floor cut

When the HVAC model and architecture have loaded, the viewer automatically creates **one** lower clipping plane at the minimum HVAC world-Y position minus `3.5` model units. The plane faces down (`[0,-1,0]`) and cuts away geometry below that position. The automatic plane applies to the architecture; the HVAC model is **not clippable** in normal view, preserving sensor visibility.

This is a **provisional floor elevation estimate**, not a verified Revit Level 5 datum. If the architectural and HVAC bounds do not overlap, the crop is safely skipped and a warning is shown. When the correct IFC storey elevation is known, adjust `FLOOR_DROP` in `src/xeokitViewer.js` or replace it with the measured elevation.

The former upper/lower slice controls and **Enable Level 5 crop** checkbox have been removed because they could hide the entire scene.

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
