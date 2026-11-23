import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
import footprints from '../../shared/roomFootprints.json';
import sensorDefinitions from '../../shared/sensorDefinitions.json';
import {heatmapSamples,subdivideFootprint,sensorVicinity,heatmapVertexColours} from './heatmapField.js';

/**
 * Continuous floor-local vertex-colour heatmap on actual IFC space footprints.
 *
 * Unlike the previous one-colour-per-room fill, heatmap samples are
 * interpolated over tessellated triangles. Unmonitored rooms remain neutral;
 * partial influence fades into transparency, not invented green readings.
 *
 * The same regions are reused for whole-building and isolated-floor views.
 * Everything remains display-only, read-only, unpickable and separate from IFC.
 */
export function createHeatmapLayer(scene,navigation,points){
 const levels=navigation.levels;
 const floorForY=y=>levels.find(level=>Math.abs(level.elevation-y)<.34)?.id||null;
 const navSensors=new Map(navigation.sensors.map(sensor=>[sensor.guid,sensor]));
 const samplesPoints=points.map(p=>({...p,roomGuid:footprints.sensors[p.guid]?.roomGuid||null}));
 const regions=new Map(),owned=[];
 const material=new PhongMaterial(scene,{
  diffuse:[1,1,1],ambient:[.88,.88,.88],emissive:[.12,.12,.12],
  alpha:1,alphaMode:'blend',backfaces:true,shininess:0
 });
 const add=(key,floor,data,kind,roomGuid=null,sensorGuid=null)=>{
  if(!floor||!data.indices.length||regions.has(key))return;
  const vertexCount=data.positions.length/3;
  const geometry=new ReadableGeometry(scene,{
   primitive:'triangles',positions:data.positions,indices:data.indices,
   normals:data.normals,colors:Array.from({length:vertexCount},()=>[0,0,0,0]).flat(),
   compressGeometry:false
  });
  const mesh=new Mesh(scene,{
   geometry,material,pickable:false,collidable:false,clippable:false,
   isObject:false,visible:false
  });
  const region={key,floor,roomGuid,sensorGuid,kind,mesh,geometry,positions:data.positions};
  regions.set(key,region);owned.push(region);
 };
 // IFC geometry is the only source of filled room boundaries.
 for(const [guid,room] of Object.entries(footprints.rooms)){
  if(!room?.positions?.length||!room.indices?.length)continue;
  const floor=floorForY(room.positions[1]);
  if(!floor)continue;
  const geometry=subdivideFootprint(room.positions,room.indices,6,.28);
  add('room:'+guid,floor,geometry,'ifc-room',guid);
 }
 // A sensor without IFC containment gets only a small, labelled vicinity
 // rather than a fabricated room footprint. This covers the known meeting
 // temperature/RH/CO2 mapping exception in the demo asset.
 for(const point of points){
  if(footprints.sensors[point.guid]?.roomGuid)continue;
  const sensor=navSensors.get(point.guid),level=levels.find(l=>l.id===point.floor);
  if(!sensor||!level)continue;
  add('vicinity:'+point.guid,point.floor,
   sensorVicinity([sensor.position[0],level.elevation+.30,sensor.position[2]]),
   'sensor-vicinity',null,point.guid);
 }
 return {
  update({metric='status',readings={},floor='all',enabled=false}){
   for(const region of regions.values())region.mesh.visible=false;
   if(!enabled)return;
   const samples=heatmapSamples(samplesPoints,navigation.sensors,readings,metric,sensorDefinitions);
   const byFloor=new Map();
   for(const sample of samples){
    if(!byFloor.has(sample.floor))byFloor.set(sample.floor,[]);
    byFloor.get(sample.floor).push(sample);
   }
   for(const region of regions.values()){
    if(floor!=='all'&&region.floor!==floor)continue;
    const floorSamples=byFloor.get(region.floor)||[];
    // Do not colour an unmonitored room solely because a remote room has
    // a sensor. The spatial colour gradient is bounded by measured spaces.
    const present=region.kind==='ifc-room'?
     floorSamples.some(s=>s.room===region.roomGuid):
     floorSamples.some(s=>s.guid===region.sensorGuid);
    if(!present)continue;
    const colors=heatmapVertexColours(region.positions,floorSamples,metric);
    if(region.kind==='sensor-vicinity'){
     // The fallback disc has no IFC room boundary: fade out entirely at
     // the perimeter to avoid suggesting that the radius is measured.
     const center=navSensors.get(region.sensorGuid)?.position;
     if(center)for(let i=0;i<region.positions.length;i+=3){
      const distance=Math.hypot(region.positions[i]-center[0],region.positions[i+2]-center[2]);
      const edge=Math.min(1,Math.max(0,(3.6-distance)/1.5));
      colors[i/3*4+3]*=edge*edge*(3-2*edge);
     }
    }
    if(!colors.some((v,i)=>i%4===3&&v>.03))continue;
    // ReadableGeometry updates the GPU colour buffer without rebuilding
    // meshes. Vertex alpha controls soft edges and sensor coverage.
    region.geometry.colors=colors;
    region.mesh.visible=true;
   }
  },
  destroy(){
   for(const region of owned){region.mesh.destroy();region.geometry.destroy()}
   material.destroy();regions.clear();
  }
 };
}
