import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
import footprints from '../../shared/roomFootprints.json';
import {sensorDisplay} from './sensorPresentation.js';

/** Evidence-coloured IFC floor footprints. Never interpolate an unmeasured heat field. */
export function createHeatmapLayer(scene,navigation,points){
 const regions=new Map(),levelById=new Map(navigation.levels.map(l=>[l.id,l]));
 const navSensors=new Map(navigation.sensors.map(s=>[s.guid,s]));
 const owned=[];
 const geometryFor=(point)=>{
  const roomGuid=footprints.sensors[point.guid]?.roomGuid,room=footprints.rooms[roomGuid];
  if(room?.positions?.length&&room?.indices?.length){
   const positions=room.positions.map((v,i)=>i%3===1?v+.24:v);
   return {key:roomGuid,geometry:new ReadableGeometry(scene,{primitive:'triangles',positions,indices:room.indices,normals:positions.map((_,i)=>i%3===1?1:0)}),position:[0,0,0],scale:[1,1,1],source:'room'};
  }
  const marker=navSensors.get(point.guid),level=levelById.get(point.floor);
  if(!marker||!level)return null;
  const positions=[0,0,0],normals=[0,1,0],indices=[];
  for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;positions.push(Math.cos(a),0,Math.sin(a));normals.push(0,1,0);if(i<48)indices.push(0,i+2,i+1)}
  return {key:'sensor:'+point.guid,geometry:new ReadableGeometry(scene,{primitive:'triangles',positions,normals,indices}),position:[marker.position[0],level.elevation+.34,marker.position[2]],scale:[3.8,1,3.8],source:'sensor vicinity'};
 };
 const get=(point)=>{
  const key=footprints.sensors[point.guid]?.roomGuid||'sensor:'+point.guid;
  if(regions.has(key))return regions.get(key);
  const definition=geometryFor(point);if(!definition)return null;
  const material=new PhongMaterial(scene,{diffuse:[.18,.7,.75],ambient:[.07,.19,.2],emissive:[.18,.7,.75],alpha:.72,alphaMode:'blend',backfaces:true,shininess:0});
  const mesh=new Mesh(scene,{geometry:definition.geometry,material,position:definition.position,scale:definition.scale,pickable:false,collidable:false,clippable:false,isObject:false,visible:false});
  const entry={key,mesh,material,geometry:definition.geometry,source:definition.source};
  regions.set(key,entry);owned.push(entry);return entry;
 };
 return {
  update({metric,readings,floor,enabled}){
   for(const region of regions.values())region.mesh.visible=false;
   if(!enabled)return;
   for(const point of points.filter(p=>p.sensorType===metric&&(floor==='all'||p.floor===floor))){
    const display=sensorDisplay(point,readings[point.code]);if(!display.available)continue;
    const region=get(point);if(!region)continue;
    region.material.diffuse=display.rgb;
    region.material.emissive=display.rgb.map(v=>Math.min(1,v*.85+.05));
    region.mesh.visible=true;
   }
  },
  destroy(){for(const entry of owned){entry.mesh.destroy();entry.material.destroy();entry.geometry.destroy()}regions.clear()}
 };
}
