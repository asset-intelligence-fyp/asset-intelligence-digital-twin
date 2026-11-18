# Presentation refresh: Light mode, Building, X-ray and occupants

Branch: `development/ui-fixes`. These improvements are **presentation-only**: generated sensor telemetry, room associations, alert rules and original BIM/XKT geometry are unchanged.

## Appearance

Use the **Light / Dark** control in the header. The choice is saved in the browser using the `assetIntelligenceTheme` key; Dark remains the initial default. Navigation, cards, inputs, analytics, simulation comparisons and viewer controls have light variants. Refreshing retains the selection.

## Building

- Actual IFC objects receive a restrained architectural material palette based on IFC element types, with walls, glazed areas, roof, slabs and structural elements distinguished.
- A non-IFC **conceptual site** adds stylized grass, footpaths, trees and benches outside the building bounding rectangle. These are illustrative, **not surveyed park assets**.
- The site is visible only in whole-building Building mode; X-ray, Heatmap and floor-focused views remain BIM-oriented. Weather/cloud/rain overlays remain synthetic.

## X-ray

- Actual IFC slabs are tinted more distinctly than transparent walls. The adjustable wall shading retains the existing X-ray material control.
- Optional **Floor guides** use elevations from `shared/modelNavigation.json` to show level reference rectangles. They are guides, **not physical modeled floor slabs**.
- **Building levels** lets viewers select the whole building or Levels 01–05.

## Synthetic people

- Procedural low-poly figures have recognisable heads/hair, torsos, shoulders, arms, legs, shoes and varied clothing.
- **People** displays up to four illustrative proxies per room. The separate occupancy panel retains the simulated headcount; four visual proxies may represent 25 synthetic occupants.
- Optional **Walking** moves each proxy within an IFC room-floor triangle, not an inferred walking route. Reduced-motion browser preference disables animation.
- Proxies are not selectable BIM elements, tracked individuals or data sources.

## Demo verification

```bash
git fetch origin
git switch development/ui-fixes
git lfs pull
npm ci
TWIN_STORAGE=memory npm run dev
```

Verify the light toggle survives a refresh, the new materials and illustrative landscaping are visible in Building mode, X-ray clearly separates slabs and has functional level guides, and low-poly people are visible for a weekday 09:00 busy simulation. Confirm simulated occupancy counts remain distinct from the number of figures.

CI cannot inspect WebGL output on the demonstration Mac; validate 3D rendering and camera interactions locally before merging.

## Building Tour: two deliberately different people modes

The viewer has a **People display** selector:

- **Simulator occupancy** (default) renders proxies only for the four monitored rooms with positive simulated headcounts. It is normal for one floor to have visible figures while others are vacant. No people are generated for unmonitored floors in this mode.
- **Building tour · visual only** generates 16 deliberately staged low-poly figures across Levels 01–05. This is a design demonstration of the viewer, **not** extra sensor coverage or actual building occupancy. The side label always says “visual-only” and lists the demonstration count by floor.

Switching into Building Tour automatically opens the whole-building X-ray and hides sensor markers to reveal the figures. The existing People and Walking toggles remain available. Returning to Simulator occupancy restores headcount-driven visibility.

The revised figures use rounded faceted silhouette meshes authored in `src/viewer/characterGeometry.js` (tapered torso, limbs, hair and clothing, facial features), not imported third-party or remotely loaded character files. No external asset license or network connection is needed.

### Quickly show all levels

Click **Tour all floors** at the top of the BIM viewer. It activates the visual-only population and switches the view to whole-building X-ray, so the staged occupants on Levels 01–05 can be explored using the level buttons. The occupants inside supported monitored rooms are anchored to actual IFC room-floor triangles; the rest are explicitly staged from storey reference elevations, without asserting sensor coverage. To return to actual synthetic room headcounts, click **Return to sensor occupancy**. This display-mode toggle never affects PIR, CO₂, event logs or stored telemetry.
