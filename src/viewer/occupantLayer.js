import {Mesh,ReadableGeometry,PhongMaterial,buildSphereGeometry} from '@xeokit/xeokit-sdk';
import {characterProfileGeometry} from './characterGeometry.js';
import {CHARACTER_STYLES,CHARACTER_PLACEMENTS,CHARACTER_SCALES,characterMotion,mannequinLimbPose,boundWalkSegment} from './characterDesign.js';
import {makeTourPlan,TOUR_LEVELS} from './occupantTour.js';

/**
 * Two strictly separate 3D occupancy presentations:
 * - sensor: scene proxies only where the hybrid simulator emits headcounts
 * - tour: fixed visual-only figures on each BIM level, independent of sensors
 *
 * Neither mode writes telemetry, alerts or IFC entities.
 * These are manually authored low-poly character meshes, not motion capture.
 */
export function createOccupantLayer(scene,navigation,footprints,points){
 const pointsByRoom=new Map(),groups=new Map(),meshes=[],resources=[];
 const navByGuid=new Map(navigation.sensors.map(p=>[p.guid,p]));
 for(const point of points){
  if(!point.simulatorRoomId||point.sensorType==='power')continue;
  const previous=pointsByRoom.get(point.simulatorRoomId);
  const mapped=p=>!!footprints.rooms[footprints.sensors[p?.guid]?.roomGuid];
  if(!previous||(mapped(point)&&!mapped(previous)))pointsByRoom.set(point.simulatorRoomId,point);
 }
 const own=x=>(resources.push(x),x);
 const profiles=characterProfileGeometry();
 const shapes=Object.fromEntries(Object.entries(profiles).map(([name,data])=>[name,own(new ReadableGeometry(scene,data))]));
 shapes.sphere=own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:18,heightSegments:14})));
 // A single soft blue, teal, coral or violet material covers each mannequin.
 // Shared geometry and six meshes per figure keep busy-building playback cheap.
 const materials=CHARACTER_STYLES.map(style=>own(new PhongMaterial(scene,{
  diffuse:style.colour,ambient:style.colour.map(v=>v*.56),
  emissive:style.colour.map(v=>v*.065),
  specular:[.14,.14,.15],shininess:12,backfaces:true
 })));
 function part(shape,material,name){
  const mesh=new Mesh(scene,{
   geometry:shapes[shape],material,pickable:false,collidable:false,
   clippable:false,isObject:false,visible:false,position:[0,0,0]
  });
  meshes.push(mesh);return {mesh,name};
 }
 function actor(anchor,i){
  const style=CHARACTER_STYLES[i%CHARACTER_STYLES.length];
  const material=materials[i%CHARACTER_STYLES.length];
  const items=[
   part('sphere',material,'head'),part('torso',material,'torso'),
   part('arm',material,'armL'),part('arm',material,'armR'),
   part('leg',material,'legL'),part('leg',material,'legR')
  ];
  return {anchor,items,index:i,height:style.height};
 }
 function pointsFromIFC(point){
  const room=footprints.rooms[footprints.sensors[point.guid]?.roomGuid];
  if(room?.positions?.length&&room?.indices?.length){
   const candidates=[];
   for(let i=0;i+2<room.indices.length;i+=3){
    const triangle=room.indices.slice(i,i+3).map(index=>room.positions.slice(index*3,index*3+3));
    if(triangle.some(v=>v.length!==3||v.some(n=>!Number.isFinite(n))))continue;
    const [a,b,c]=triangle;
    const area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))*.5;
    if(area<.14)continue;
    // Wider but still strictly convex IFC-triangle paths make the walking
    // legible, without placing figures outside the room's supplied geometry.
    const start=a.map((v,n)=>v*.56+b[n]*.22+c[n]*.22);
    const end=a.map((v,n)=>v*.22+b[n]*.39+c[n]*.39);
    candidates.push({...boundWalkSegment(start,end),area});
   }
   candidates.sort((a,b)=>b.area-a.area);
   const result=[];
   for(const candidate of candidates){
    if(result.every(x=>Math.hypot(x.start[0]-candidate.start[0],x.start[2]-candidate.start[2])>1.5))result.push(candidate);
    if(result.length===4)break;
   }
   if(result.length)return result;
  }
  const marker=navByGuid.get(point.guid),level=navigation.levels.find(l=>l.id===point.floor);
  if(!marker||!level)return [];
  return [{start:[marker.position[0],level.elevation+.15,marker.position[2]],
    end:[marker.position[0]+.15,level.elevation+.15,marker.position[2]+.15]}];
 }
 function group(key,floor,anchors,seed=0){
  if(!anchors?.length)return null;
  const obj={floor,actors:anchors.map((anchor,i)=>actor(anchor,seed+i))};
  groups.set(key,obj);return obj;
 }
 const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
 let enabled=false,moving=false,floor='all',mode='sensor',headcounts={},last=0,tourPlan={};
 function place(character,now){
  const pose=characterMotion(character.anchor,character.index,now,moving&&!reducedMotion);
  const {base,heading,legSwing,armSwing,bob}=pose;
  const radians=heading*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const height=character.height;
  const world=local=>[
   base[0]+local[0]*cos-local[2]*sin,
   base[1]+local[1]*height+bob,
   base[2]+local[0]*sin+local[2]*cos
  ];
  for(const item of character.items){
   const name=item.name;
   if(name==='head'||name==='torso'){
    item.mesh.position=world(CHARACTER_PLACEMENTS[name]);
    item.mesh.rotation=[0,heading,0];
    const scale=CHARACTER_SCALES[name];
    item.mesh.scale=[scale[0],scale[1]*height,scale[2]];
    continue;
   }
   const isLeft=name.endsWith('L'),isArm=name.startsWith('arm');
   const pivot=isArm?
    [isLeft?-.298:.298,1.390,0]:
    [isLeft?-.118:.118,.800,0];
   const pitch=(isLeft?1:-1)*(isArm?armSwing:legSwing);
   const limb=mannequinLimbPose(pivot,isArm ? .309 : .386,pitch);
   item.mesh.position=world(limb.center);
   item.mesh.rotation=[limb.pitch,heading,0];
   item.mesh.scale=[1,height,1];
  }
 }
 function refresh(now){
  const isTour=mode==='tour';
  if(isTour&&enabled){
   for(const entry of TOUR_LEVELS){
    const key='tour:'+entry.floor;
    if(!groups.has(key)&&tourPlan[entry.floor])group(key,entry.floor,tourPlan[entry.floor],TOUR_LEVELS.indexOf(entry));
   }
  }
  if(!isTour&&enabled){
   for(const [id,point] of pointsByRoom){
    if(Math.max(0,Number(headcounts[id])||0)>0&&!groups.has('sensor:'+id)){
     // Stable room-specific seed yields varied outfits without random flicker.
     const roomIndex=[...pointsByRoom.keys()].indexOf(id);
     group('sensor:'+id,point.floor,pointsFromIFC(point),roomIndex*3);
    }
   }
  }
  for(const [key,record] of groups){
   const tourGroup=key.startsWith('tour:');
   const sceneVisible=enabled&&(floor==='all'||record.floor===floor)&&(tourGroup===isTour);
   const count=tourGroup?record.actors.length:Math.max(0,Number(headcounts[key.slice(7)])||0);
   const proxies=tourGroup?record.actors.length:Math.min(record.actors.length,Math.max(0,Math.ceil(count/4)));
   record.actors.forEach((figure,index)=>{
    const show=sceneVisible&&index<proxies;
    for(const p of figure.items)p.mesh.visible=show;
    if(show)place(figure,now);
   });
  }
 }
 return {
  setBounds(bounds){tourPlan=makeTourPlan(bounds,navigation.levels,footprints);refresh(performance.now())},
  update({headcounts:next,enabled:show,animate,floor:current,mode:source='sensor'}){
   headcounts=next||{};enabled=!!show;moving=!!animate;floor=current||'all';
   mode=source==='tour'?'tour':'sensor';refresh(performance.now());
  },
  tick(now){
   if(!enabled||!moving||reducedMotion||now-last<40)return;
   last=now;refresh(now);
  },
  destroy(){
   for(const mesh of meshes)mesh.destroy();
   for(const resource of resources)resource.destroy();
   groups.clear();
  }
 };
}
