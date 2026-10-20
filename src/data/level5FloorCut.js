// Determine the architectural slab directly beneath the Level 5 HVAC model.
// This is a geometry-based estimate, NOT a substitute for a confirmed Revit floor elevation.
// Coordinates and units must match between the architectural and HVAC XKT files.

function validAABB(box) {
  return Boolean(box && box.length === 6 &&
    Array.from(box).every(Number.isFinite) &&
    box[3] >= box[0] && box[4] >= box[1] && box[5] >= box[2]);
}

function horizontalOverlap(a, b) {
  return a[0] <= b[3] && b[0] <= a[3] &&
    a[2] <= b[5] && b[2] <= a[5];
}

/**
 * Returns a cut point just BELOW the nearest compatible architectural slab.
 * On failure returns null; callers must display the intact architecture, not
 * fall back to clipping blindly from the HVAC bounding-box bottom.
 *
 * @param {number[]} hvac AABB [xmin, ymin, zmin, xmax, ymax, zmax]
 * @param {number[]} architecture Architectural model AABB
 * @param {{id:string, type:string, aabb:number[]}[]} objects Architectural objects
 * @returns {{y:number, slabId:string, slabTop:number, source:string}|null}
 */
export function findLevel5FloorCut(hvac, architecture, objects) {
  if (!validAABB(hvac) || !validAABB(architecture)) return null;
  if (!horizontalOverlap(hvac, architecture)) return null;

  const height = architecture[4] - architecture[1];
  if (!(height > 0)) return null;

  const hvacBottom = hvac[1];
  const hvacHeight = Math.max(0.1, hvac[4] - hvac[1]);
  // A slab may intersect the lower edge of HVAC geometry, but a slab far above
  // the HVAC does not identify its supporting floor.
  const aboveTolerance = Math.min(0.75, hvacHeight * 0.15);
  const maxBelow = Math.max(6, Math.min(12, hvacHeight * 1.25));

  const candidates = (objects || [])
    .filter(x => /IfcSlab/i.test(x?.type || "") && validAABB(x.aabb))
    .filter(x => horizontalOverlap(x.aabb, hvac))
    .map(x => ({
      ...x,
      top: x.aabb[4],
      distance: hvacBottom - x.aabb[4],
      area: (x.aabb[3] - x.aabb[0]) * (x.aabb[5] - x.aabb[2])
    }))
    .filter(x => x.distance >= -aboveTolerance && x.distance <= maxBelow)
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || b.area - a.area);

  const slab = candidates[0];
  if (!slab) return null;

  // Preserve the slab itself; trim just below its lower surface. This avoids
  // accidentally showing only the lowest building slabs or clipping L5 slab.
  const thickness = slab.aabb[4] - slab.aabb[1];
  const margin = Math.min(0.05, Math.max(0.01, thickness * 0.1));
  const y = slab.aabb[1] - margin;
  const epsilon = Math.max(0.0001, height * 1e-5);

  // A candidate at the architectural bounding-box boundary cannot safely
  // define a cut through the full building.
  if (y <= architecture[1] + epsilon || y >= architecture[4] - epsilon) return null;

  return { y, slabId: String(slab.id), slabTop: slab.top, source: "nearest-IfcSlab" };
}
