import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
import definitions from '../../shared/sensorDefinitions.json';
import {heatmapSamples} from './heatmapField.js';
import {buildContainedFloorGrid} from './heatmapFootprint.js';
import {buildHeatmapBands,bandMaterialColours} from './heatmapBands.js';

const BAND_COUNT=32;

/**
 * Reliable, floor-wide colour overlay made from small contiguous isobands.
 *
 * The previous two approaches (runtime vertex RGBA and PNG diffuse textures)
 * produced only white/grey plates on the target WebGL renderer. Each band
 * instead uses a plain xeokit PhongMaterial with a fixed diffuse/emissive RGB
 * colour. This is the same core rendering path as the other visible BIM
 * presentation objects, with no asynchronous texture decoding.
 *
 * The isobands are clipped to the per-storey IFC wall/glazing enclosure;
 * slab bounding boxes alone must never define the visible footprint.
 * No floor is drawn unless that floor has an eligible sensor reading. A
 * one-sensor floor is uniform; multiple sensors create a smooth 32-step
 * gradient along scalar-field contour boundaries, not square tiles.
 */
export function createHeatmapLayer(scene,navigation,points){
 const palette=bandMaterialColours(BAND_COUNT).map(rgb=>new PhongMaterial(scene,{
  diffuse:rgb,
  ambient:rgb.map(v=>v*.75),
  emissive:rgb.map(v=>v*.28),
  specular:[0,0,0],
  shininess:0,
  alpha:.45,
  alphaMode:'blend',
  backfaces:true
 }));
 const floors=new Map();
 let initialized=false;
 const clearFloor=region=>{
  for(const part of region.parts){
   part.mesh.destroy();
   part.geometry.destroy();
  }
  region.parts=[];
  region.signature='';
 };
 return {
  setFloorSurfaces(surfaces){
   if(initialized)return;
   initialized=true;
   for(const entry of surfaces){
    const grid=buildContainedFloorGrid(entry.aabbs,entry.facadeAabbs||[],entry.elevation,{cellSize:1.25,offset:.10,inset:.40});
    if(!grid.indices.length)continue;
    floors.set(entry.floor,{grid,source:entry.source,parts:[],signature:''});
   }
  },
  update({metric='status',readings={},floor='all',enabled=false}){
   if(!enabled){
    for(const region of floors.values())for(const part of region.parts)part.mesh.visible=false;
    return;
   }
   const samples=heatmapSamples(points,navigation.sensors,readings,metric,definitions);
   const byFloor=new Map();
   for(const sample of samples){
    if(!byFloor.has(sample.floor))byFloor.set(sample.floor,[]);
    byFloor.get(sample.floor).push(sample);
   }
   // In whole-building view, lower alpha allows the architecture and lower
   // storeys to show through. Single-floor view enhances selected floor.
   const alpha=floor==='all'?.34:.58;
   for(const material of palette)material.alpha=alpha;
   for(const [id,region] of floors){
    const visible=floor==='all'||floor===id;
    const inputs=byFloor.get(id)||[];
    if(!visible||!inputs.length){
     for(const part of region.parts)part.mesh.visible=false;
     continue;
    }
    const signature=metric+'|'+inputs.map(p=>p.code+':'+p.score.toFixed(5)).join(',');
    if(region.signature!==signature){
     clearFloor(region);
     const bands=buildHeatmapBands(region.grid,inputs,BAND_COUNT);
     for(const band of bands){
      const geometry=new ReadableGeometry(scene,{
       primitive:'triangles',positions:band.positions,
       normals:band.normals,indices:band.indices,compressGeometry:false
      });
      const mesh=new Mesh(scene,{
       geometry,material:palette[band.index],
       visible:true,pickable:false,collidable:false,clippable:false,
       isObject:false,occluder:false,edges:false
      });
      region.parts.push({mesh,geometry});
     }
     region.signature=signature;
    }else{
     for(const part of region.parts)part.mesh.visible=true;
    }
   }
  },
  destroy(){
   for(const region of floors.values())clearFloor(region);
   for(const material of palette)material.destroy();
   floors.clear();
  }
 };
}
