/** Visual-only Building Tour: never derive these figures from sensors. */
export const TOUR_LEVELS=[
 {floor:'Level_01',count:3,label:'Arrival / lobby'},
 {floor:'Level_02',count:4,label:'Office activity'},
 {floor:'Level_03',count:4,label:'Meeting spaces'},
 {floor:'Level_04',count:3,label:'Shared facilities'},
 {floor:'Level_05',count:2,label:'Upper floor'}
];
export const TOUR_TOTAL=TOUR_LEVELS.reduce((sum,level)=>sum+level.count,0);
export function occupantViewCount(mode,headcounts={}){
 if(mode==='tour')return TOUR_TOTAL;
 return Object.values(headcounts||{}).reduce((a,v)=>a+Math.max(0,Math.round(Number(v)||0)),0);
}
/** 
 * Intentional mock population for a BIM presentation.
 * The plan uses the model's bounding envelope and actual storey elevations,
 * not claims about room occupancy or people trajectories.
 */
export function makeTourPlan(bounds,levels){
 if(!Array.isArray(bounds)||bounds.length!==6||bounds.some(x=>!Number.isFinite(x)))return {};
 const [x0,,z0,x1,,z1]=bounds,w=x1-x0,d=z1-z0;
 if(w<=0||d<=0)return {};
 const cx=(x0+x1)/2,cz=(z0+z1)/2;
 const dx=Math.min(w*.12,4),dz=Math.min(d*.12,4);
 const offsets=[[-1,-.6],[.8,-.6],[-.7,.7],[.9,.7],[-.1,.05]];
 const result={};
 for(const item of TOUR_LEVELS){
  const floor=levels.find(x=>x.id===item.floor);
  if(!floor)continue;
  result[item.floor]=offsets.slice(0,item.count).map(([sx,sz],i)=>{
   const anchor=[cx+sx*dx,floor.elevation+.18,cz+sz*dz];
   return {start:anchor,end:[anchor[0]+Math.min(.45,dx*.15),anchor[1],anchor[2]+Math.min(.4,dz*.15)],index:i};
  });
 }
 return result;
}
