import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
import {sensorDisplay} from './sensorPresentation.js';
/** Small, explicitly illustrative colour areas at sensor locations, not an inferred thermal field. */
export function createHeatmapLayer(scene,navigation,points){
 const zones=new Map(),levels=new Map(navigation.levels.map(p=>[p.id,p]));
 const positions=[0,0,0],normals=[0,1,0],indices=[];
 for(let i=0;i<=40;i++){const angle=i/40*Math.PI*2;positions.push(Math.cos(angle),0,Math.sin(angle));normals.push(0,1,0);if(i<40)indices.push(0,i+2,i+1)}
 const geometry=new ReadableGeometry(scene,{id:'sensor_colour_area',primitive:'triangles',positions,normals,indices});
 function create(point){
  const anchor=navigation.sensors.find(s=>s.guid===point.guid),level=levels.get(point.floor);if(!anchor||!level)return [];
  return [3.2,2.3,1.4].map((radius,index)=>{
   const material=new PhongMaterial(scene,{diffuse:[.1,.6,.6],emissive:[.06,.16,.16],alpha:[.10,.18,.36][index],alphaMode:'blend',backfaces:true,shininess:0});
   const mesh=new Mesh(scene,{id:'colour_'+point.guid+'_'+index,geometry,material,position:[anchor.position[0],level.elevation+.38+index*.012,anchor.position[2]],scale:[radius,1,radius],pickable:false,collidable:false,clippable:false,visible:false});
   return {mesh,material};
  });
 }
 return {
  update({metric,readings,floor,enabled}){
   for(const group of zones.values())for(const {mesh} of group)mesh.visible=false;
   if(!enabled)return;
   for(const point of points.filter(p=>p.sensorType===metric&&(floor==='all'||p.floor===floor))){
    const display=sensorDisplay(point,readings[point.code]);
    if(!display.available)continue;
    if(!zones.has(point.guid))zones.set(point.guid,create(point));
    for(const {mesh,material} of zones.get(point.guid)){material.diffuse=display.rgb;material.emissive=display.rgb.map(v=>v*.25);mesh.visible=true}
   }
  },
  destroy(){for(const group of zones.values())for(const {mesh,material} of group){mesh.destroy();material.destroy()}geometry.destroy();zones.clear()},
 };
}
