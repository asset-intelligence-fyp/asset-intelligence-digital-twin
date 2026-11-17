import {Mesh,ReadableGeometry,PhongMaterial,buildBoxGeometry,buildSphereGeometry} from '@xeokit/xeokit-sdk';

/**
 * Low-poly illustrative visitors driven by synthetic ROOM counts.
 * They are not detections or navigable people. Four proxies maximum per room.
 * All geometry is shared and excluded from BIM picking, telemetry and object metadata.
 */
export function createOccupantLayer(scene,navigation,footprints,points){
 const pointsByRoom=new Map(),groups=new Map(),ownedMeshes=[],ownedResources=[];
 const navByGuid=new Map(navigation.sensors.map(s=>[s.guid,s]));
 for(const point of points){
  if(!point.simulatorRoomId||point.sensorType==='power')continue;
  const previous=pointsByRoom.get(point.simulatorRoomId);
  const mapped=p=>!!footprints.rooms[footprints.sensors[p?.guid]?.roomGuid];
  if(!previous||(mapped(point)&&!mapped(previous)))pointsByRoom.set(point.simulatorRoomId,point);
 }
 const own=x=>(ownedResources.push(x),x);
 const shapes={
  head:own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:8,heightSegments:6}))),
  hand:own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:7,heightSegments:5}))),
  torso:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.49,ySize:.66,zSize:.29}))),
  shoulders:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.64,ySize:.16,zSize:.32}))),
  neck:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.18,ySize:.14,zSize:.18}))),
  hair:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.47,ySize:.10,zSize:.45}))),
  arm:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.145,ySize:.56,zSize:.16}))),
  waist:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.42,ySize:.16,zSize:.29}))),
  leg:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.18,ySize:.60,zSize:.20}))),
  shoe:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.24,ySize:.13,zSize:.39}))),
  badge:own(new ReadableGeometry(scene,buildBoxGeometry({xSize:.15,ySize:.13,zSize:.035}))),
 };
 const palette=[
  {shirt:[.13,.65,.69],trousers:[.19,.27,.39],skin:[.91,.73,.55],hair:[.13,.20,.28],badge:[.91,.68,.29]},
  {shirt:[.80,.45,.34],trousers:[.19,.28,.37],skin:[.62,.38,.26],hair:[.11,.15,.20],badge:[.97,.83,.45]},
  {shirt:[.39,.47,.74],trousers:[.26,.30,.38],skin:[.98,.83,.69],hair:[.29,.20,.15],badge:[.69,.92,.84]},
  {shirt:[.62,.62,.42],trousers:[.21,.27,.33],skin:[.73,.51,.37],hair:[.16,.16,.20],badge:[.93,.82,.60]},
 ];
 const mats=palette.map(set=>{
  const create=(colour,glow=.16)=>own(new PhongMaterial(scene,{
   diffuse:colour,ambient:colour.map(x=>x*.36),
   emissive:colour.map(x=>x*glow),backfaces:true,shininess:16
  }));
  return {shirt:create(set.shirt,.24),trousers:create(set.trousers,.11),skin:create(set.skin,.20),hair:create(set.hair,.08),badge:create(set.badge,.25)};
 });
 const make=(shape,material)=>{const mesh=new Mesh(scene,{
  geometry:shapes[shape],material,pickable:false,collidable:false,clippable:false,
  isObject:false,visible:false,position:[0,0,0]
 });ownedMeshes.push(mesh);return mesh;};
 // All anchor locations originate from the corresponding IFC floor triangulation.
 function positionsFor(point){
  const room=footprints.rooms[footprints.sensors[point.guid]?.roomGuid];
  if(room?.positions?.length&&room?.indices?.length){
   const candidates=[];
   for(let i=0;i+2<room.indices.length;i+=3){
    const tri=room.indices.slice(i,i+3).map(index=>room.positions.slice(index*3,index*3+3));
    if(tri.some(v=>v.length!==3||v.some(n=>!Number.isFinite(n))))continue;
    const [a,b,c]=tri;
    const area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))*.5;
    if(area<.14)continue;
    const start=a.map((v,n)=>(a[n]+b[n]+c[n])/3);
    // Barycentric path stays within this same known floor triangle.
    const end=a.map((v,n)=>a[n]*.22+b[n]*.39+c[n]*.39);
    candidates.push({start,end,area});
   }
   candidates.sort((a,b)=>b.area-a.area);
   const unique=[];
   for(const candidate of candidates){
    if(unique.every(item=>Math.hypot(item.start[0]-candidate.start[0],item.start[2]-candidate.start[2])>1.8))unique.push(candidate);
    if(unique.length===4)break;
   }
   if(unique.length)return unique;
  }
  // Fallback is around an actual BIM marker, never a fabricated room boundary.
  const marker=navByGuid.get(point.guid),level=navigation.levels.find(l=>l.id===point.floor);
  if(!marker||!level)return [];
  return [{start:[marker.position[0],level.elevation+.10,marker.position[2]],
   end:[marker.position[0]+.15,level.elevation+.10,marker.position[2]+.15]}];
 }
 function newActor(anchor,index){
  const m=mats[index%4],parts=[
   {mesh:make('head',m.skin),name:'head'},
   {mesh:make('hair',m.hair),name:'hair'},
   {mesh:make('neck',m.skin),name:'neck'},
   {mesh:make('torso',m.shirt),name:'torso'},
   {mesh:make('shoulders',m.shirt),name:'shoulders'},
   {mesh:make('waist',m.trousers),name:'waist'},
   {mesh:make('arm',m.shirt),name:'armL'},
   {mesh:make('arm',m.shirt),name:'armR'},
   {mesh:make('hand',m.skin),name:'handL'},
   {mesh:make('hand',m.skin),name:'handR'},
   {mesh:make('leg',m.trousers),name:'legL'},
   {mesh:make('leg',m.trousers),name:'legR'},
   {mesh:make('shoe',m.hair),name:'shoeL'},
   {mesh:make('shoe',m.hair),name:'shoeR'},
   {mesh:make('badge',m.badge),name:'badge'},
  ];
  const turn=(index%4)*Math.PI/2;
  return {anchor,index,turn,parts};
 }
 function init(roomId,point){
  const anchors=positionsFor(point);
  if(!anchors.length)return null;
  const group={floor:point.floor,actors:anchors.map((anchor,i)=>newActor(anchor,i))};
  groups.set(roomId,group);
  return group;
 }
 let enabled=false,animate=false,floor='all',latest={},last=0;
 const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
 const offsets={
  head:[0,1.78,0],hair:[0,1.99,0],neck:[0,1.51,0],
  torso:[0,1.16,0],shoulders:[0,1.47,0],waist:[0,.77,0],
  armL:[-.40,1.16,0],armR:[.40,1.16,0],handL:[-.40,.80,0],handR:[.40,.80,0],
  legL:[-.135,.43,0],legR:[.135,.43,0],shoeL:[-.135,.095,-.09],shoeR:[.135,.095,-.09],
  badge:[.14,1.25,-.16]
 };
 function pose(actor,now){
  const {start,end}=actor.anchor;
  const t=now*.0018+actor.index*.8,active=animate&&!reducedMotion;
  const travel=active?(1-Math.cos(t))*.5:0;
  const bounce=active?Math.sin(t*5)*.026:0;
  const base=[start[0]+(end[0]-start[0])*travel,start[1]+bounce,start[2]+(end[2]-start[2])*travel];
  const gait=active?Math.sin(t*5)*24:0,cy=Math.cos(actor.turn),sy=Math.sin(actor.turn);
  for(const part of actor.parts){
   const local=offsets[part.name],dx=local[0],dz=local[2];
   const x=dx*cy-dz*sy,z=dx*sy+dz*cy;
   part.mesh.position=[base[0]+x,base[1]+local[1],base[2]+z];
   part.mesh.rotation=[/^(arm|leg|shoe)/.test(part.name)?(part.name.endsWith('L')?gait:-gait)*(part.name.startsWith('arm')?-1:1):0,actor.turn*180/Math.PI,0];
   if(part.name==='head')part.mesh.scale=[.245,.27,.235];
   else if(part.name.startsWith('hand'))part.mesh.scale=[.105,.11,.105];
   else part.mesh.scale=[1,1,1];
  }
 }
 function refresh(now){
  for(const [id,point] of pointsByRoom){
   const count=Math.max(0,Number(latest[id])||0);
   const group=groups.get(id)||(enabled&&count>0?init(id,point):null);
   if(!group)continue;
   const shown=enabled&&(floor==='all'||group.floor===floor);
   const proxies=count>0?Math.min(4,group.actors.length,Math.max(1,Math.ceil(count/4))):0;
   for(const actor of group.actors){
    const visible=shown&&actor.index<proxies;
    for(const part of actor.parts)part.mesh.visible=visible;
    if(visible)pose(actor,now);
   }
  }
 }
 return {
  update({headcounts,enabled:show,animate:walk,floor:current}){
   latest=headcounts||{};enabled=!!show;animate=!!walk;floor=current||'all';
   refresh(performance.now());
  },
  tick(now){
   if(!enabled||!animate||reducedMotion||now-last<65)return;
   last=now;refresh(now);
  },
  destroy(){
   for(const mesh of ownedMeshes)mesh.destroy();
   for(const resource of ownedResources)resource.destroy();
   groups.clear();
  }
 };
}
