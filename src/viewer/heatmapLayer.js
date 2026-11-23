import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
import definitions from '../../shared/sensorDefinitions.json';
import {heatmapSamples,buildFloorHeatmapGrid,wholeFloorVertexColours} from './heatmapField.js';

/**
 * Full-floor simulated heatmap drawn on floor-slab coverage, not around
 * individual markers. Each visible storey has one shared-grid colour mesh;
 * vertex colours update from the current sensor samples without new meshes.
 *
 * A whole floor is an *estimate* outside observed points. Uninstrumented
 * storeys are grey. This layer never changes IFC objects, persistence, or
 * sensor readings.
 */
export function createHeatmapLayer(scene,navigation,points){
 const regions=new Map(),resources=[];
 const owned=x=>(resources.push(x),x);
 const material=owned(new PhongMaterial(scene,{
  diffuse:[1,1,1],ambient:[.72,.72,.72],emissive:[.21,.21,.21],
  // IMPORTANT: xeokit routes meshes to transparent rendering only when
  // material.alpha < 1 (or mesh.opacity < 1). The previous alpha=1 meant
  // vertex-alpha alone could not reliably make the overlay visible.
  alpha:.91,alphaMode:'blend',backfaces:true,shininess:0
 }));
 let initialized=false;
 return {
  setFloorSurfaces(surfaces){
   if(initialized)return;
   initialized=true;
   for(const entry of surfaces){
    const geometryData=buildFloorHeatmapGrid(entry.aabbs,entry.elevation);
    if(!geometryData.indices.length)continue;
    const count=geometryData.positions.length/3;
    const geometry=owned(new ReadableGeometry(scene,{
     primitive:'triangles',
     positions:geometryData.positions,indices:geometryData.indices,
     normals:geometryData.normals,
     colors:Array.from({length:count*4},(_,i)=>i%4===3?.72:.5),
     compressGeometry:false
    }));
    const mesh=owned(new Mesh(scene,{
     geometry,material,visible:false,pickable:false,collidable:false,
     clippable:false,isObject:false,occluder:false,edges:false,
     // Render above the underlying XKT floor slabs as a transparent overlay.
     opacity:.99
    }));
    regions.set(entry.floor,{geometry,mesh,positions:geometryData.positions,source:entry.source||'ifc-slab'});
   }
  },
  update({metric='status',readings={},floor='all',enabled=false}){
   for(const region of regions.values())region.mesh.visible=false;
   if(!enabled)return;
   const samples=heatmapSamples(points,navigation.sensors,readings,metric,definitions);
   const byFloor=new Map();
   for(const point of samples){
    if(!byFloor.has(point.floor))byFloor.set(point.floor,[]);
    byFloor.get(point.floor).push(point);
   }
   for(const [floorId,region] of regions){
    if(floor!=='all'&&floor!==floorId)continue;
    const onFloor=byFloor.get(floorId)||[];
    // Grey means no eligible sensor for this metric; when data exists,
    // interpolate it across the full actual slab area instead of a disc.
    region.geometry.colors=wholeFloorVertexColours(region.positions,onFloor);
    region.mesh.visible=true;
   }
  },
  destroy(){
   // Child meshes and geometries are destroyed before shared materials.
   for(const region of regions.values())region.mesh.destroy();
   for(const region of regions.values())region.geometry.destroy();
   material.destroy();regions.clear();resources.length=0;
  }
 };
}
