import definitions from '../../shared/sensorDefinitions.json';

/**
 * Heatmap scores are for a visual demo, not calibrated comfort predictions.
 * Composite condition blends only types with configured rule thresholds.
 * Light = intensity and occupancy = presence, never "risk" by themselves.
 */
export const STATUS_METRICS=new Set(['temperature','humidity','co2','water_leakage','power']);
export const HEATMAP_STOPS=[
 [0,[.13,.70,.37]], // green
 [.25,[.51,.80,.28]], // yellow-green
 [.5,[.95,.82,.23]], // yellow
 [.75,[.97,.52,.19]], // orange
 [1,[.82,.18,.21]] // red
];
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const ramp=(value,start,end)=>clamp((value-start)/(end-start));
export function heatmapColour(value){
 const t=clamp(Number(value)||0);
 for(let i=1;i<HEATMAP_STOPS.length;i++){
  const [upper,b]=HEATMAP_STOPS[i],[lower,a]=HEATMAP_STOPS[i-1];
  if(t<=upper){const blend=(t-lower)/(upper-lower);return a.map((x,j)=>x+(b[j]-x)*blend)}
 }
 return [...HEATMAP_STOPS.at(-1)[1]];
}
/** 0=within demo band, 1=outside configured alert range.
 * Unthresholded metrics are labelled as intensities rather than fault risk.
 */
export function heatmapScore(metric,value){
 if(!Number.isFinite(value))return null;
 if(metric==='temperature'){
  if(value<22)return .08+.92*ramp(22-value,0,6);
  if(value<=27)return 0;
  if(value<=30)return .08+.92*ramp(value,27,30);
  return 1;
 }
 if(metric==='humidity'){
  if(value<40)return .08+.92*ramp(40-value,0,15);
  if(value<=65)return 0;
  if(value<=75)return .08+.92*ramp(value,65,75);
  return 1;
 }
 if(metric==='co2')return value<=800?0:ramp(value,800,1200);
 if(metric==='water_leakage'||metric==='occupancy')return value>=.5?1:0;
 if(metric==='power')return value<=3?0:ramp(value,3,8);
 if(metric==='light')return ramp(value,0,800);
 const def=definitions[metric];
 if(def?.high!==undefined)return ramp(value,def.high*.7,def.high);
 return null;
}
export function heatmapSamples(points,navigationSensors,readings,metric){
 const byGuid=new Map(navigationSensors.map(n=>[n.guid,n]));
 const samples=[];
 for(const point of points){
  if(metric==='status'?!STATUS_METRICS.has(point.sensorType):point.sensorType!==metric)continue;
  const reading=readings?.[point.code],sensor=byGuid.get(point.guid);
  if(!sensor||!reading||reading.quality==='missing'||!Number.isFinite(reading.value))continue;
  const score=heatmapScore(point.sensorType,reading.value);
  if(score===null)continue;
  samples.push({code:point.code,guid:point.guid,room:point.roomGuid||null,
   floor:point.floor,x:sensor.position[0],z:sensor.position[2],score});
 }
 return samples;
}

/** Smooth floor-local inverse-distance interpolation. Never mix elevations. */
export function interpolateHeatmap(x,z,samples,radius=13){
 if(!samples.length)return null;
 let numerator=0,denominator=0,nearest=Infinity;
 for(const sample of samples){
  const distance=Math.hypot(x-sample.x,z-sample.z);
  nearest=Math.min(nearest,distance);
  if(distance<.12)return {score:sample.score,coverage:1};
  // Compact local Gaussian influence avoids extrapolating readings across
  // disconnected unmonitored IFC spaces.
  const weight=Math.exp(-Math.pow(distance/radius,2)*1.35);
  numerator+=sample.score*weight;denominator+=weight;
 }
 if(denominator<.0001||nearest>radius*2.4)return null;
 const coverage=clamp(Math.exp(-Math.pow(nearest/radius,2)*.9));
 return {score:clamp(numerator/denominator),coverage};
}

/** Subdivide real IFC triangles; no invented rectangular floor slab. */
export function subdivideFootprint(positions,indices,subdivisions=5,yOffset=.26){
 if(!Array.isArray(positions)||!Array.isArray(indices)||subdivisions<1)return {positions:[],normals:[],indices:[]};
 const out=[],normals=[],faces=[];
 const add=(a,b,c)=>{
  const u=out.length/3;
  for(const v of [a,b,c]){out.push(v[0],v[1]+yOffset,v[2]);normals.push(0,1,0)}
  faces.push(u,u+1,u+2);
 };
 for(let at=0;at+2<indices.length;at+=3){
  const vertices=indices.slice(at,at+3).map(id=>positions.slice(id*3,id*3+3));
  if(vertices.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n))))continue;
  const [a,b,c]=vertices;
  const point=(i,j)=>{
   const u=i/subdivisions,v=j/subdivisions,w=1-u-v;
   return [a[0]*w+b[0]*u+c[0]*v,a[1]*w+b[1]*u+c[1]*v,a[2]*w+b[2]*u+c[2]*v];
  };
  for(let i=0;i<subdivisions;i++)for(let j=0;j<subdivisions-i;j++){
   add(point(i,j),point(i+1,j),point(i,j+1));
   if(i+j<subdivisions-1)add(point(i+1,j),point(i+1,j+1),point(i,j+1));
  }
 }
 return {positions:out,normals,indices:faces};
}

/** Disc for markers without verified IFC room containment; visual vicinity only. */
export function sensorVicinity(center,radius=3.6,segments=32,rings=4){
 const positions=[],normals=[],indices=[];
 for(let ring=0;ring<=rings;ring++){
  const r=radius*ring/rings;
  for(let i=0;i<=segments;i++){
   const angle=Math.PI*2*i/segments;
   positions.push(center[0]+r*Math.cos(angle),center[1],center[2]+r*Math.sin(angle));
   normals.push(0,1,0);
  }
 }
 const width=segments+1;
 for(let ring=0;ring<rings;ring++)for(let i=0;i<segments;i++){
  const a=ring*width+i,b=a+1,c=a+width,d=c+1;
  indices.push(a,c,b,b,c,d);
 }
 return {positions,normals,indices};
}

export function heatmapVertexColours(positions,samples,metric){
 const rgba=[];
 for(let i=0;i<positions.length;i+=3){
  const x=positions[i],z=positions[i+2];
  const result=interpolateHeatmap(x,z,samples);
  if(!result){rgba.push(0,0,0,0);continue}
  const [r,g,b]=heatmapColour(result.score);
  const isBinary=metric==='occupancy'||metric==='water_leakage';
  // Alpha fades only, not a fabricated safe (green) value at unsupported
  // locations. Even binary overlays remain categorical at sensors.
  rgba.push(r,g,b,clamp((isBinary ? .65 : .78)*result.coverage,0,.80));
 }
 return rgba;
}
