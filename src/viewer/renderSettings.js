// The installed xeokit renderer clips when dot(-dir, worldPosition-pos) > 0.
// Lower keeps ABOVE the plane; upper keeps BELOW it.
export const FLOOR_CLIP_DIRECTIONS={lower:[0,1,0],upper:[0,-1,0]};
export const GHOST_COLOUR=[.12,.18,.25];
export const XRAY_DEFAULT=.38;
export const XRAY_MIN=.08;
export const XRAY_MAX=.85;
export function viewerPalette(theme='dark'){
 return theme==='light'
  ? {solid:[.55,.64,.73],ghost:[.24,.42,.55],edge:[.08,.28,.41]}
  : {solid:[.35,.43,.54],ghost:GHOST_COLOUR,edge:[.18,.41,.52]};
}
export function xrayStyle(value,theme='dark'){
 const alpha=Math.min(XRAY_MAX,Math.max(XRAY_MIN,Number.isFinite(Number(value))?Number(value):XRAY_DEFAULT));
 const palette=viewerPalette(theme);
 return {alpha,floorAlpha:.08+alpha*.3,fillColor:palette.ghost,edgeColor:palette.edge,edgeAlpha:.9};
}
