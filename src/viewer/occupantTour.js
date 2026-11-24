import {boundWalkSegment} from './characterDesign.js';
/** A clearly visual-only BIM demonstration: these people never affect sensors. */
export const TOUR_LEVELS=[
 {floor:'Level_01',count:3,label:'Arrival / lobby'},
 {floor:'Level_02',count:4,label:'Office activity'},
 {floor:'Level_03',count:4,label:'Meeting spaces'},
 {floor:'Level_04',count:3,label:'Shared facilities'},
 {floor:'Level_05',count:2,label:'Upper floor'}
];
export const TOUR_TOTAL=TOUR_LEVELS.reduce((sum,l)=>sum+l.count,0);
export function occupantViewCount(mode,headcounts={}){
 if(mode==='tour')return TOUR_TOTAL;
 return Object.values(headcounts||{}).reduce((a,v)=>a+Math.max(0,Math.round(Number(v)||0)),0);
}
/**
 * Prefer actual IFC-room floor triangles when available. The original concept
 * put every visitor near the bounding-box centre (often inside walls), which
 * made the five-floor tour difficult to see and geometrically unconvincing.
 *
 * Rooms not mapped in the supplied BIM remain staged display-only positions.
 * No algorithm infers unknown corridor geometry or asserts sensor coverage.
 */
export function makeTourPlan(bounds,levels,roomFootprints=null){
 if(!Array.isArray(bounds)||bounds.length!==6||bounds.some(x=>!Number.isFinite(x)))return {};
 const [x0,,z0,x1,,z1]=bounds,w=x1-x0,d=z1-z0;
 if(w<=0||d<=0)return {};
 const cx=(x0+x1)/2,cz=(z0+z1)/2,dx=Math.min(w*.15,5),dz=Math.min(d*.15,5);
 const offsets=[[-1,-.6],[.8,-.6],[-.7,.7],[.9,.7],[-.1,.05]];
 const floorRoomSamples=elevation=>{
  const candidates=[];
  for(const room of Object.values(roomFootprints?.rooms||{})){
   if(!room?.positions?.length||!room.indices?.length)continue;
   if(Math.abs(room.positions[1]-elevation)>.3)continue;
   for(let i=0;i+2<room.indices.length;i+=3){
    const ids=room.indices.slice(i,i+3);
    const pts=ids.map(k=>room.positions.slice(k*3,k*3+3));
    if(pts.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n))))continue;
    const [a,b,c]=pts,area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))*.5;
    if(area<.30)continue;
    // Both positions are strictly convex combinations of source triangle
    // vertices, so walking remains inside the supplied IFC room footprint.
    const p=(weights)=>[0,1,2].map(axis=>a[axis]*weights[0]+b[axis]*weights[1]+c[axis]*weights[2]);
    const start=p([.54,.23,.23]),end=p([.22,.39,.39]);
    start[1]+=.16;end[1]+=.16;
    candidates.push({...boundWalkSegment(start,end),area,source:'ifc-room'});
   }
  }
  return candidates.sort((a,b)=>b.area-a.area);
 };
 const result={};
 for(const item of TOUR_LEVELS){
  const level=levels.find(l=>l.id===item.floor);if(!level)continue;
  const selected=[];
  for(const candidate of floorRoomSamples(level.elevation)){
   if(selected.every(x=>Math.hypot(x.start[0]-candidate.start[0],x.start[2]-candidate.start[2])>=1.5))selected.push(candidate);
   if(selected.length>=item.count)break;
  }
  // Levels with no verified room triangles still have a clearly labelled
  // illustrative BIM tour; the fallback is not represented as an IFC room.
  for(let k=0;selected.length<item.count&&k<offsets.length;k++){
   const [sx,sz]=offsets[(k+TOUR_LEVELS.findIndex(x=>x.floor===item.floor))%offsets.length];
   const start=[cx+sx*dx,level.elevation+.18,cz+sz*dz];
   if(selected.some(p=>Math.hypot(p.start[0]-start[0],p.start[2]-start[2])<1.5))continue;
   selected.push({start,end:[start[0]+Math.min(.35,dx*.10),start[1],start[2]+Math.min(.33,dz*.10)],source:'staged'});
  }
  result[item.floor]=selected.slice(0,item.count);
 }
 return result;
}
