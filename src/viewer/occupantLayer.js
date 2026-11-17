import {Mesh,ReadableGeometry,PhongMaterial,buildSphereGeometry} from '@xeokit/xeokit-sdk';
import {characterProfileGeometry} from './characterGeometry.js';
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
 const colours=[
  {shirt:[.22,.55,.74],pants:[.18,.27,.37],skin:[.88,.65,.47],hair:[.16,.17,.22],accessory:[.93,.73,.37]},
  {shirt:[.79,.48,.42],pants:[.32,.33,.42],skin:[.60,.39,.28],hair:[.12,.15,.19],accessory:[.94,.81,.51]},
  {shirt:[.50,.46,.72],pants:[.20,.27,.34],skin:[.96,.80,.65],hair:[.32,.20,.17],accessory:[.45,.80,.76]},
  {shirt:[.45,.63,.48],pants:[.28,.32,.43],skin:[.74,.53,.37],hair:[.19,.19,.21],accessory:[.90,.82,.67]}
 ];
 const mats=colours.map(c=>{
  const mat=(rgb,glow=.13)=>own(new PhongMaterial(scene,{
   diffuse:rgb,ambient:rgb.map(v=>v*.48),emissive:rgb.map(v=>v*glow),
   backfaces:true,shininess:14
  }));
  return {shirt:mat(c.shirt,.19),pants:mat(c.pants,.10),skin:mat(c.skin,.21),hair:mat(c.hair,.09),acc:mat(c.accessory,.18),eyes:mat([.10,.14,.19],.02)};
 });
 function part(shape,material,name){
  const mesh=new Mesh(scene,{
   geometry:shapes[shape],material,pickable:false,collidable:false,
   clippable:false,isObject:false,visible:false,position:[0,0,0]
  });
  meshes.push(mesh);return {mesh,name};
 }
 function actor(anchor,i){
  const c=mats[i%4],variant=i%4;
  const female=variant===1||variant===3;
  const shirt=female?'blouse':'jacket';
  const items=[
   part('sphere',c.skin,'head'),part('hair',c.hair,'hair'),
   part('neck',c.skin,'neck'),part(shirt,c.shirt,'torso'),
   part('arm',c.shirt,'armL'),part('arm',c.shirt,'armR'),
   part('sphere',c.skin,'handL'),part('sphere',c.skin,'handR'),
   part('leg',c.pants,'legL'),part('leg',c.pants,'legR'),
   part('sphere',c.hair,'shoeL'),part('sphere',c.hair,'shoeR'),
   part('sphere',c.eyes,'eyeL'),part('sphere',c.eyes,'eyeR'),
   part('nose',c.skin,'nose'),part('sphere',c.acc,'badge')
  ];
  if(female)items.push(part('skirt',c.pants,'skirt'));
  return {anchor,items,index:i,angle:(i%4)*Math.PI/2};
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
    const start=a.map((v,n)=>(v+b[n]+c[n])/3);
    const end=a.map((v,n)=>v*.22+b[n]*.39+c[n]*.39);
    candidates.push({start,end,area});
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
 const placements={
  head:[0,1.73,0],hair:[0,1.94,0],neck:[0,1.42,0],
  torso:[0,1.16,0],armL:[-.395,1.15,0],armR:[.395,1.15,0],
  handL:[-.395,.80,0],handR:[.395,.80,0],
  legL:[-.13,.39,0],legR:[.13,.39,0],
  shoeL:[-.13,.09,-.10],shoeR:[.13,.09,-.10],
  eyeL:[-.095,1.78,-.20],eyeR:[.095,1.78,-.20],
  nose:[0,1.67,-.255],badge:[.15,1.28,-.175],
  skirt:[0,.84,0]
 };
 const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
 let enabled=false,moving=false,floor='all',mode='sensor',headcounts={},last=0,tourPlan={};
 function place(character,now){
  const {start,end}=character.anchor;
  const t=now*.0016+character.index*.8,animated=moving&&!reducedMotion;
  const travel=animated?(1-Math.cos(t))*.5:0;
  const yLift=animated?Math.sin(t*5)*.02:0;
  const base=[start[0]+(end[0]-start[0])*travel,start[1]+yLift,start[2]+(end[2]-start[2])*travel];
  const gait=animated?Math.sin(t*5)*18:0,cos=Math.cos(character.angle),sin=Math.sin(character.angle);
  for(const part of character.items){
   const local=placements[part.name],dx=local[0],dz=local[2];
   part.mesh.position=[base[0]+dx*cos-dz*sin,base[1]+local[1],base[2]+dx*sin+dz*cos];
   const animatedLimb=/^(arm|leg|shoe)/.test(part.name);
   const direction=part.name.endsWith('L')?1:-1;
   const swing=animatedLimb?direction*gait*(part.name.startsWith('arm')?-1:1):0;
   part.mesh.rotation=[swing,character.angle*180/Math.PI,0];
   if(part.name==='head')part.mesh.scale=[.25,.29,.23];
   else if(part.name.startsWith('hand'))part.mesh.scale=[.102,.111,.103];
   else if(part.name.startsWith('shoe'))part.mesh.scale=[.155,.10,.245];
   else if(part.name.startsWith('eye'))part.mesh.scale=[.024,.031,.018];
   else if(part.name==='badge')part.mesh.scale=[.068,.075,.024];
   else part.mesh.scale=[1,1,1];
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
     group('sensor:'+id,point.floor,pointsFromIFC(point),pointsByRoom.size);
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
  setBounds(bounds){tourPlan=makeTourPlan(bounds,navigation.levels);refresh(performance.now())},
  update({headcounts:next,enabled:show,animate,floor:current,mode:source='sensor'}){
   headcounts=next||{};enabled=!!show;moving=!!animate;floor=current||'all';
   mode=source==='tour'?'tour':'sensor';refresh(performance.now());
  },
  tick(now){
   if(!enabled||!moving||reducedMotion||now-last<70)return;
   last=now;refresh(now);
  },
  destroy(){
   for(const mesh of meshes)mesh.destroy();
   for(const resource of resources)resource.destroy();
   groups.clear();
  }
 };
}
