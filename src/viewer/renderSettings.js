// The installed xeokit renderer clips when dot(-dir, worldPosition-pos) > 0.
// Lower keeps ABOVE the plane; upper keeps BELOW it.
export const FLOOR_CLIP_DIRECTIONS={lower:[0,1,0],upper:[0,-1,0]};
export const GHOST_COLOUR=[.26,.33,.35];
export const XRAY_DEFAULT=.38;
export const XRAY_MIN=.08;
export const XRAY_MAX=.85;
export function xrayStyle(value){
 const alpha=Math.min(XRAY_MAX,Math.max(XRAY_MIN,Number.isFinite(Number(value))?Number(value):XRAY_DEFAULT));
 return {alpha,floorAlpha:.08+alpha*.3,fillColor:GHOST_COLOUR,edgeColor:[.28,.39,.41],edgeAlpha:.9};
}
