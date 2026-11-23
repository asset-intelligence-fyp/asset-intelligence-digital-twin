/**
 * Lightweight architectural entourage: four deliberately recognisable office
 * outfits, shared between sensor-linked occupancy and visual-only building tour.
 * The characters never change sensor values or claim measured people counts.
 */
export const CHARACTER_STYLES=[
 {
  name:'Cobalt blazer',torso:'jacket',hair:'hairCrop',collar:true,lapels:true,height:1,
  palette:{outer:[.19,.47,.73],trousers:[.20,.29,.39],skin:[.79,.58,.45],
   hair:[.18,.23,.29],shoes:[.22,.27,.35],trim:[.88,.91,.92]}
 },
 {
  name:'Sea-glass shirt',torso:'blouse',hair:'hairSide',collar:true,lapels:false,height:.97,
  palette:{outer:[.21,.64,.60],trousers:[.27,.38,.47],skin:[.90,.72,.60],
   hair:[.33,.24,.21],shoes:[.24,.33,.38],trim:[.91,.94,.88]}
 },
 {
  name:'Coral cardigan',torso:'cardigan',hair:'hairTaper',collar:false,lapels:true,height:1.025,
  palette:{outer:[.80,.43,.38],trousers:[.27,.35,.49],skin:[.67,.47,.35],
   hair:[.19,.21,.24],shoes:[.24,.29,.36],trim:[.94,.79,.67]}
 },
 {
  name:'Iris jacket',torso:'longline',hair:'hairSide',collar:true,lapels:true,height:.995,
  palette:{outer:[.48,.47,.74],trousers:[.31,.34,.47],skin:[.93,.77,.65],
   hair:[.28,.23,.25],shoes:[.25,.27,.36],trim:[.88,.86,.95]}
 }
];

/** Metre-scale positions; head, torso, and hands stay stable in a walking pose. */
export const CHARACTER_PLACEMENTS={
 head:[0,1.60,0],hair:[0,1.685,0],neck:[0,1.419,0],
 torso:[0,1.14,0],armL:[-.285,1.155,0],armR:[.285,1.155,0],
 handL:[-.285,.793,0],handR:[.285,.793,0],
 shoeL:[-.114,.069,-.055],shoeR:[.114,.069,-.055],
 lapelL:[-.102,1.304,-.149],lapelR:[.102,1.304,-.149],
 collar:[0,1.443,0]
};

export const CHARACTER_SCALES={
 head:[.167,.203,.154],handL:[.070,.080,.072],handR:[.070,.080,.072],
 // Separate shoes: the former oversized black shoes merged into an oval.
 shoeL:[.106,.057,.151],shoeR:[.106,.057,.151]
};

/**
 * Keep the original room-valid segment but limit the walking speed and
 * foot-sliding risk on unusually large IFC floor triangles. The new end
 * is an interpolation of two original in-triangle positions.
 */
export function boundWalkSegment(start,end,maxDistance=1.1){
 const dx=end[0]-start[0],dz=end[2]-start[2],distance=Math.hypot(dx,dz);
 const fraction=distance>maxDistance?maxDistance/distance:1;
 return {start:[...start],end:end.map((v,i)=>start[i]+(v-start[i])*fraction)};
}

const smooth=x=>x*x*(3-2*x);
const TURN_MS=500,TRAVEL_MS=2650,CYCLE_MS=2*(TURN_MS+TRAVEL_MS);
const stationary=(base,heading)=>({
 base:[...base],heading,gait:0,sway:0,bob:0,
 footL:{forward:0,lift:0},footR:{forward:0,lift:0}
});

/**
 * A walk / turn / walk-back / turn loop along the original IFC-safe segment.
 * Steps and forward progress share ONE phase; the previous implementation
 * animated legs much faster than the travel, creating a shuffling/moonwalk.
 *
 * At either end the figure stops and turns smoothly instead of walking
 * backward. Both feet stop moving during the turn.
 */
export function characterMotion(anchor,index,nowMs,walking){
 const start=anchor?.start||[0,0,0],end=anchor?.end||start;
 const dx=end[0]-start[0],dz=end[2]-start[2],distance=Math.hypot(dx,dz);
 const baseHeading=distance>.025?Math.atan2(dx,-dz)*180/Math.PI:(index%4)*90;
 if(!walking||distance<.085)return stationary(start,baseHeading);
 const cycle=((nowMs+index*637)%CYCLE_MS+CYCLE_MS)%CYCLE_MS;
 let route,heading,walkProgress=null;
 if(cycle<TRAVEL_MS){
  const t=cycle/TRAVEL_MS;route=smooth(t);heading=baseHeading;walkProgress=t;
 }else if(cycle<TRAVEL_MS+TURN_MS){
  route=1;heading=baseHeading+180*smooth((cycle-TRAVEL_MS)/TURN_MS);
 }else if(cycle<2*TRAVEL_MS+TURN_MS){
  const t=(cycle-TRAVEL_MS-TURN_MS)/TRAVEL_MS;
  route=1-smooth(t);heading=baseHeading+180;walkProgress=t;
 }else{
  route=0;heading=baseHeading+180+180*smooth((cycle-2*TRAVEL_MS-TURN_MS)/TURN_MS);
 }
 const base=[start[0]+dx*route,start[1],start[2]+dz*route];
 if(walkProgress===null)return stationary(base,heading);
 // Ease the gait to a full stop at the turn; alternating shoes get separate
 // horizontal and vertical trajectories, instead of merely scissoring in place.
 const gain=Math.min(1,walkProgress*8,(1-walkProgress)*8);
 const phase=walkProgress*4*Math.PI;
 const stride=Math.sin(phase);
 const forward=.125*gain*stride;
 const leftLift=.052*gain*Math.max(0,stride)**2;
 const rightLift=.052*gain*Math.max(0,-stride)**2;
 return {
  base,heading,gait:8*gain*stride,sway:.65*gain*Math.sin(phase),bob:.005*gain*Math.abs(stride),
  footL:{forward,lift:leftLift},footR:{forward:-forward,lift:rightLift}
 };
}

/**
 * Two-segment leg pose, using simple sagittal-plane IK. The ankle follows a
 * lifted shoe, the knee bends forward, and both shin and thigh connect to
 * actual joint positions. This prevents feet floating away from rigid legs.
 *
 * Returned centres and pitch angles are for geometry whose long axis is Y,
 * with the thigh/shin local mesh spanning -0.5..0.5.
 */
export function characterLegPose(foot,height=1){
 const hip=[0,.805*height,.015],ankle=[0,.137*height+foot.lift,-.02-foot.forward];
 const dy=ankle[1]-hip[1],dz=ankle[2]-hip[2];
 const raw=Math.hypot(dy,dz),upper=.359*height,lower=.359*height;
 const d=Math.min(upper+lower-.001,Math.max(.02,raw));
 const ay=(upper*upper-lower*lower+d*d)/(2*d),bend=Math.sqrt(Math.max(0,upper*upper-ay*ay));
 const uy=dy/(raw||1),uz=dz/(raw||1);
 const knee=[0,hip[1]+ay*uy-bend*uz,hip[2]+ay*uz+bend*uy];
 const segment=(top,bottom)=>{
  const length=Math.hypot(top[1]-bottom[1],top[2]-bottom[2]);
  return {center:[0,(top[1]+bottom[1])/2,(top[2]+bottom[2])/2],
   length,pitch:Math.atan2(top[2]-bottom[2],top[1]-bottom[1])*180/Math.PI};
 };
 return {hip,knee,ankle,thigh:segment(hip,knee),shin:segment(knee,ankle),
  shoe:[0,.069*height+foot.lift,-.075-foot.forward]};
}
