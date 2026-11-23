import {Mesh,ReadableGeometry,PhongMaterial,Texture} from '@xeokit/xeokit-sdk';
import definitions from '../../shared/sensorDefinitions.json';
import {heatmapSamples,buildFloorHeatmapGrid,floorHeatmapPixels} from './heatmapField.js';

const TEXTURE_SIZE=160;

/**
 * Lightweight, floor-wide heatmap based on browser-generated RGBA textures.
 *
 * IMPORTANT: the earlier implementation assigned colour buffers to xeokit
 * meshes but displayed white and black plates in the user's WebGL screenshots.
 * xeokit's documented PhongMaterial.diffuseMap + ReadableGeometry.uv pipeline
 * is used instead. No geometry vertex colours or extra opaque slab faces.
 *
 * In all-floor view materials are deliberately more transparent, so coloured
 * layers do not block the 3D BIM. Selected-floor view may show more colour.
 * All colours outside sensor locations are labelled interpolated estimates.
 */
export function createHeatmapLayer(scene,navigation,points){
 const regions=new Map();
 let initialized=false;
 const setActive=(region,active)=>{
  if(region.mesh.visible!==active)region.mesh.visible=active;
 };
 return {
  setFloorSurfaces(surfaces){
   if(initialized)return;
   initialized=true;
   for(const entry of surfaces){
    const grid=buildFloorHeatmapGrid(entry.aabbs,entry.elevation);
    if(!grid.indices.length)continue;
    const canvas=document.createElement('canvas');
    canvas.width=TEXTURE_SIZE;canvas.height=TEXTURE_SIZE;
    const context=canvas.getContext('2d');
    if(!context)continue;
    const texture=new Texture(scene,{src:canvas.toDataURL('image/png'),flipY:true});
    const material=new PhongMaterial(scene,{
     diffuse:[1,1,1],ambient:[.88,.88,.88],emissive:[.07,.07,.07],
     diffuseMap:texture,alpha:.34,alphaMode:'blend',backfaces:false,shininess:0
    });
    const geometry=new ReadableGeometry(scene,{
     primitive:'triangles',positions:grid.positions,indices:grid.indices,
     normals:grid.normals,uv:grid.uv,compressGeometry:false
    });
    const mesh=new Mesh(scene,{
     geometry,material,visible:false,pickable:false,collidable:false,
     clippable:false,isObject:false,occluder:false,edges:false
    });
    regions.set(entry.floor,{
     mesh,geometry,material,texture,canvas,context,
     bounds:grid.bounds,source:entry.source,lastSignature:''
    });
   }
  },
  update({metric='status',readings={},floor='all',enabled=false}){
   for(const region of regions.values())setActive(region,false);
   if(!enabled)return;
   const samples=heatmapSamples(points,navigation.sensors,readings,metric,definitions);
   const byFloor=new Map();
   for(const point of samples){
    if(!byFloor.has(point.floor))byFloor.set(point.floor,[]);
    byFloor.get(point.floor).push(point);
   }
   for(const [floorId,region] of regions){
    if(floor!=='all'&&floor!==floorId)continue;
    const available=byFloor.get(floorId)||[];
    // A floor with no reading of this metric is left fully transparent:
    // no opaque grey/white plates hiding the building.
    if(!available.length)continue;
    const signature=metric+'|'+available.map(point=>point.code+':'+point.score.toFixed(4)).join(',');
    if(signature!==region.lastSignature){
     const pixels=floorHeatmapPixels(region.bounds,available,TEXTURE_SIZE,TEXTURE_SIZE);
     const data=region.context.createImageData(TEXTURE_SIZE,TEXTURE_SIZE);
     data.data.set(pixels);
     region.context.putImageData(data,0,0);
     // Updating Texture.src uploads the new browser raster to WebGL using
     // xeokit's supported texture path (rather than a colour-buffer rewrite).
     region.texture.src=region.canvas.toDataURL('image/png');
     region.lastSignature=signature;
    }
    region.material.alpha=floor==='all'?.34:.57;
    setActive(region,true);
   }
  },
  destroy(){
   for(const region of regions.values()){
    region.mesh.destroy();
    region.geometry.destroy();
    region.material.destroy();
    region.texture.destroy();
   }
   regions.clear();
  }
 };
}
