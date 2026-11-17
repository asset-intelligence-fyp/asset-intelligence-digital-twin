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
