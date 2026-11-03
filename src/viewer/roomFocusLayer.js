import {Mesh,ReadableGeometry,PhongMaterial} from '@xeokit/xeokit-sdk';
/** Actual IFC floor triangles and boundary segments; never draw a guessed room rectangle. */
export function createRoomFocusLayer(scene,data){
 const meshes=new Map();
 const roomFor=guid=>data.rooms[data.sensors[guid]?.roomGuid];
 function create(room){
  const floorPositions=room.positions.map((v,i)=>i%3===1?v+.09:v);
  const floorGeometry=new ReadableGeometry(scene,{primitive:'triangles',positions:floorPositions,normals:floorPositions.map((_,i)=>i%3===1?1:0),indices:room.indices});
  const floorMaterial=new PhongMaterial(scene,{diffuse:[0,0,0],ambient:[0,0,0],emissive:[.08,.48,.46],alpha:.23,alphaMode:'blend',backfaces:true});
  const floor=new Mesh(scene,{geometry:floorGeometry,material:floorMaterial,pickable:false,collidable:false,clippable:false,visible:false});
  const positions=[],indices=[],height=Math.min(2.5,Math.max(.2,room.height));
  const add=(a,b)=>{const start=positions.length/3;positions.push(...a,...b);indices.push(start,start+1)};
  const corners=new Set();
  for(const [a,b] of room.boundary){
   const u=floorPositions.slice(a*3,a*3+3),v=floorPositions.slice(b*3,b*3+3);
   add(u,v);add([u[0],u[1]+height,u[2]],[v[0],v[1]+height,v[2]]);corners.add(a);corners.add(b);
  }
  for(const a of corners){const u=floorPositions.slice(a*3,a*3+3);add(u,[u[0],u[1]+height,u[2]])}
  const outlineGeometry=new ReadableGeometry(scene,{primitive:'lines',positions,indices});
  const outlineMaterial=new PhongMaterial(scene,{diffuse:[0,0,0],emissive:[.025,.26,.29],lineWidth:2});
  const outline=new Mesh(scene,{geometry:outlineGeometry,material:outlineMaterial,pickable:false,collidable:false,clippable:false,visible:false});
  return {floor,outline,floorGeometry,outlineGeometry,floorMaterial,outlineMaterial};
 }
 return {
  bounds(guid){const r=roomFor(guid);if(!r)return null;const p=r.positions;return [Math.min(...p.filter((_,i)=>i%3===0)),p[1],Math.min(...p.filter((_,i)=>i%3===2)),Math.max(...p.filter((_,i)=>i%3===0)),p[1]+r.height,Math.max(...p.filter((_,i)=>i%3===2))]},
  status(guid){return data.sensors[guid]?.status||'No IFC room boundary linked to this marker'},
  update(guid,enabled){
   for(const entry of meshes.values()){entry.floor.visible=false;entry.outline.visible=false}
   const room=roomFor(guid);if(!enabled||!room)return;
   if(!meshes.has(room.guid))meshes.set(room.guid,create(room));
   const entry=meshes.get(room.guid);entry.floor.visible=true;entry.outline.visible=true;
  },
  destroy(){for(const entry of meshes.values())for(const component of Object.values(entry))component.destroy();meshes.clear()}
 };
}
