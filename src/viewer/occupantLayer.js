import {Mesh,ReadableGeometry,PhongMaterial,buildSphereGeometry} from '@xeokit/xeokit-sdk';
import {characterProfileGeometry} from './characterGeometry.js';
import {CHARACTER_STYLES,CHARACTER_PLACEMENTS,CHARACTER_SCALES,characterMotion,characterLegPose,boundWalkSegment} from './characterDesign.js';
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
 shapes.sphere=own(new ReadableGeometry(scene,buildSphereGeometry({radius:1,widthSegments:10,heightSegments:8})));
 // One shared set of matte materials per architectural outfit variant.
 // This retains the original lightweight, texture-free rendering pipeline.
 const mats=CHARACTER_STYLES.map(style=>{
  const mat=rgb=>own(new PhongMaterial(scene,{
   diffuse:rgb,ambient:rgb.map(v=>v*.63),emissive:rgb.map(v=>v*.055),
   specular:[.095,.10,.11],backfaces:true,shininess:8
  }));
  const palette=style.palette;
  return {outer:mat(palette.outer),pants:mat(palette.trousers),skin:mat(palette.skin),
   hair:mat(palette.hair),shoes:mat(palette.shoes),trim:mat(palette.trim)};
 });
 function part(shape,material,name){
  const mesh=new Mesh(scene,{
   geometry:shapes[shape],material,pickable:false,collidable:false,
   clippable:false,isObject:false,visible:false,position:[0,0,0]
  });
  meshes.push(mesh);return {mesh,name};
 }
 function actor(anchor,i){
  const style=CHARACTER_STYLES[i%CHARACTER_STYLES.length],materials=mats[i%CHARACTER_STYLES.length];
  const items=[
   part('sphere',materials.skin,'head'),
   part(style.hair,materials.hair,'hair'),
   part('neck',materials.skin,'neck'),
   part(style.torso,materials.outer,'torso'),
   part('arm',materials.outer,'armL'),part('arm',materials.outer,'armR'),
   part('sphere',materials.skin,'handL'),part('sphere',materials.skin,'handR'),
   part('thigh',materials.pants,'thighL'),part('thigh',materials.pants,'thighR'),
   part('shin',materials.pants,'shinL'),part('shin',materials.pants,'shinR'),
   part('sphere',materials.shoes,'shoeL'),part('sphere',materials.shoes,'shoeR')
  ];
  if(style.collar)items.push(part('collar',materials.trim,'collar'));
  if(style.lapels)items.push(part('lapel',materials.trim,'lapelL'),part('lapel',materials.trim,'lapelR'));
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
  const {base,heading,gait,bob,sway}=pose;
  const radians=heading*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const world=(x,y,z)=>[
   base[0]+x*cos-z*sin,
   base[1]+y,
   base[2]+x*sin+z*cos
  ];
  // Compute the right/left hip-knee-ankle poses once per figure per frame.
  // The shoe is lifted by the same phase driving its shin and thigh.
  const legs={
   L:characterLegPose(pose.footL,character.height),
   R:characterLegPose(pose.footR,character.height)
  };
  for(const item of character.items){
   const name=item.name,side=name.endsWith('L')?'L':'R';
   const isLeg=name.startsWith('thigh')||name.startsWith('shin');
   const isShoe=name.startsWith('shoe');
   const isArm=name.startsWith('arm'),isHand=name.startsWith('hand');
   if(isLeg){
    const segment=name.startsWith('thigh')?legs[side].thigh:legs[side].shin;
    item.mesh.position=world(side==='L' ? -.114 : .114,segment.center[1],segment.center[2]);
    item.mesh.rotation=[segment.pitch,heading,0];
    item.mesh.scale=[1,segment.length,1];
    continue;
   }
   if(isShoe){
    const foot=legs[side].shoe;
    item.mesh.position=world(side==='L' ? -.114 : .114,foot[1],foot[2]);
    item.mesh.rotation=[(side==='L'?1:-1)*gait*.26,heading,0];
    const scale=CHARACTER_SCALES[name];
    item.mesh.scale=[scale[0],scale[1]*character.height,scale[2]];
    continue;
   }
   const local=CHARACTER_PLACEMENTS[name];
   // Arms counter-swing opposite the stepping feet, hands follow their
   // sleeves; upper body stays almost level instead of bobbing like a toy.
   const direction=side==='L'?-1:1;
   const forward=isArm?direction*.034*gait/8:isHand?direction*.075*gait/8:0;
   const y=local[1]*character.height+bob;
   item.mesh.position=world(local[0],y,local[2]-forward);
   const pitch=isArm?direction*9*gait/8:0;
   item.mesh.rotation=[pitch,heading+(name==='torso'?sway:0),0];
   const scale=CHARACTER_SCALES[name]||[1,1,1];
   item.mesh.scale=[scale[0],scale[1]*character.height,scale[2]];
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
