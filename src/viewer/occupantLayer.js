import {Mesh,ReadableGeometry,PhongMaterial,buildBoxGeometry,buildSphereGeometry} from '@xeokit/xeokit-sdk';

/** Bounded illustrative avatars. They are not tracked people or real BIM occupants. */
export function createOccupantLayer(scene,navigation,footprints,points){
 const roomPoints=new Map(),groups=new Map();
 const sensorNav=new Map(navigation.sensors.map(s=>[s.guid,s]));
 for(const p of points){if(!p.simulatorRoomId||p.sensorType==='power')continue;if(!roomPoints.has(p.simulatorRoomId))roomPoints.set(p.simulatorRoomId,p)}
 const torsoGeo=new ReadableGeometry(scene,buildBoxGeometry({xSize:.35,ySize:.7,zSize:.22}));
 const legGeo=new ReadableGeometry(scene,buildBoxGeometry({xSize:.13,ySize:.55,zSize:.16}));
 const headGeo=new ReadableGeometry(scene,buildSphereGeometry({radius:.16,widthSegments:10,heightSegments:8}));
 const shirt=new PhongMaterial(scene,{diffuse:[.06,.76,.76],ambient:[.08,.26,.28],emissive:[.02,.06,.06]});
 const pants=new PhongMaterial(scene,{diffuse:[.17,.27,.38],ambient:[.07,.1,.15]});
 const skin=new PhongMaterial(scene,{diffuse:[.87,.7,.56],ambient:[.24,.16,.1]});
 const make=(g,m)=>new Mesh(scene,{geometry:g,material:m,position:[0,0,0],pickable:false,collidable:false,clippable:false,isObject:false,visible:false});
 let enabled=false,animate=false,floor='all',last=0;
 const candidates=(p)=>{
  const roomId=footprints.sensors[p.guid]?.roomGuid,room=footprints.rooms[roomId];
  if(room?.indices?.length&&room.positions?.length){
   const candidates=[];
   for(let i=0;i<room.indices.length;i+=3){
    const vertices=room.indices.slice(i,i+3).map(index=>room.positions.slice(index*3,index*3+3));
    if(vertices.length!==3||vertices.some(v=>v.length!==3))continue;
    const [a,b,c]=vertices;
    const area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
    if(area<.08)continue;
    const centre=a.map((v,n)=>(v+b[n]+c[n])/3);
    const destination=a.map((v,n)=>v*.2+b[n]*.4+c[n]*.4);
    candidates.push({start:centre,end:destination,area});
   }
   candidates.sort((a,b)=>b.area-a.area);
   const selected=[];
   for(const c of candidates){if(selected.every(e=>Math.hypot(e.start[0]-c.start[0],e.start[2]-c.start[2])>1.8))selected.push(c);if(selected.length===4)break}
   if(selected.length)return selected;
  }
  const loc=sensorNav.get(p.guid),level=navigation.levels.find(l=>l.id===p.floor);
  if(!loc||!level)return [];
  return [{start:[loc.position[0],level.elevation+.1,loc.position[2]],end:[loc.position[0]+.2,level.elevation+.1,loc.position[2]+.2],area:1}];
 };
 function init(roomId,point){
  const anchors=candidates(point);if(!anchors.length)return null;
  const actors=anchors.map((anchor,i)=>({anchor,parts:[make(torsoGeo,shirt),make(legGeo,pants),make(legGeo,pants),make(headGeo,skin)],index:i}));
  const group={actors,level:point.floor};groups.set(roomId,group);return group;
 }
 const position=(actor,t)=>{
  const {start,end}=actor.anchor;
  const f=animate?(1-Math.cos(t*.0015+actor.index*.9))/2:0;
  const x=start[0]+(end[0]-start[0])*f,y=start[1],z=start[2]+(end[2]-start[2])*f;
  const sway=animate?Math.sin(t*.007+actor.index)*.055:0;
  const coords=[[x,y+.96+sway,z],[x-.10,y+.39-sway,z],[x+.10,y+.39+sway,z],[x,y+1.48+sway,z]];
  actor.parts.forEach((mesh,j)=>{mesh.position=coords[j]});
 };
 const refresh=(headcounts={},time=0)=>{
  for(const [id,p] of roomPoints){
   const count=Number(headcounts[id])||0;
   const group=groups.get(id)||(enabled&&count>0?init(id,p):null);
   if(!group)continue;
   const visible=enabled&&(floor==='all'||group.level===floor);
   // Up to four proxies, not one avatar per actual simulated person.
   const proxies=count>0?Math.min(group.actors.length,Math.max(1,Math.ceil(count/4))):0;
   for(const actor of group.actors){
    const show=visible&&actor.index<proxies;
    for(const mesh of actor.parts)mesh.visible=show;
    if(show)position(actor,time);
   }
  }
 };
 let latest={};
 return {
  update({headcounts,enabled:show,animate:move,floor:which}){latest=headcounts||{};enabled=!!show;animate=!!move;floor=which||'all';refresh(latest,performance.now())},
  tick(now){if(!enabled||!animate||now-last<60)return;last=now;refresh(latest,now)},
  destroy(){for(const group of groups.values())for(const actor of group.actors)for(const mesh of actor.parts)mesh.destroy();groups.clear();for(const x of [torsoGeo,legGeo,headGeo,shirt,pants,skin])x.destroy()}
 };
}
