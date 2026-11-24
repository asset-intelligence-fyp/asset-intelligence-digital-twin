/**
 * Shared single-colour architectural mannequins.
 * A colour is the only figure variant; no skin/hair/clothing accessories.
 * They are synthetic occupancy proxies, not representations of individuals.
 */
export const CHARACTER_STYLES=[
 {name:'Blue',colour:[.22,.51,.86],height:1},
 {name:'Teal',colour:[.17,.70,.68],height:.985},
 {name:'Coral',colour:[.89,.49,.43],height:1.015},
 {name:'Violet',colour:[.53,.48,.83],height:1.00}
];

export const CHARACTER_PLACEMENTS={
 head:[0,1.626,0],torso:[0,1.169,0],
 armL:[-.298,1.144,0],armR:[.298,1.144,0],
 legL:[-.118,.414,0],legR:[.118,.414,0]
};

export const CHARACTER_SCALES={
 head:[.19,.215,.185],
 torso:[1,1,1],
 armL:[1,1,1],armR:[1,1,1],
 legL:[1,1,1],legR:[1,1,1]
};

/** Original IFC-triangle endpoints remain inside the same triangle. */
export function boundWalkSegment(start,end,maxDistance=1.1){
 const dx=end[0]-start[0],dz=end[2]-start[2],length=Math.hypot(dx,dz);
 const portion=length>maxDistance?maxDistance/length:1;
 return {start:[...start],end:end.map((v,i)=>start[i]+(v-start[i])*portion)};
}

const smooth=t=>t*t*(3-2*t);
export const WALK_TIMING={travelMs:3000,turnMs:550,strides:2};
const PERIOD=2*(WALK_TIMING.travelMs+WALK_TIMING.turnMs);
const stationary=(base,heading)=>({base:[...base],heading,legSwing:0,armSwing:0,bob:0,walking:false});

/**
 * A deliberately simple mannequin walk. The two rigid capsule legs swing
 * around the hips and the capsule arms counter-swing at the shoulders.
 * One shared phase controls the movement and gait, avoiding disconnected
 * knee/shin pieces and visually sliding backwards.
 *
 * A figure walks toward the end, stands still and turns, then walks back.
 * The zero-velocity ease at either end prevents sudden direction reversals.
 */
export function characterMotion(anchor,index,nowMs,walking){
 const start=anchor?.start||[0,0,0],end=anchor?.end||start;
 const dx=end[0]-start[0],dz=end[2]-start[2],distance=Math.hypot(dx,dz);
 // The mannequin's local forward direction is -Z. Face the direction
 // of actual travel, not the opposite heading of the previous iteration.
 const forwardHeading=distance>.001?Math.atan2(-dx,-dz)*180/Math.PI:(index%4)*90;
 if(!walking||distance<.07)return stationary(start,forwardHeading);
 const tick=((nowMs+index*673)%PERIOD+PERIOD)%PERIOD;
 const travelMs=WALK_TIMING.travelMs,turnMs=WALK_TIMING.turnMs;
 let portion,heading,walkFraction=null;
 if(tick<travelMs){
  const t=tick/travelMs;portion=smooth(t);heading=forwardHeading;walkFraction=t;
 }else if(tick<travelMs+turnMs){
  portion=1;heading=forwardHeading+180*smooth((tick-travelMs)/turnMs);
 }else if(tick<2*travelMs+turnMs){
  const t=(tick-travelMs-turnMs)/travelMs;portion=1-smooth(t);
  heading=forwardHeading+180;walkFraction=t;
 }else{
  portion=0;heading=forwardHeading+180+180*smooth((tick-2*travelMs-turnMs)/turnMs);
 }
 const base=[start[0]+dx*portion,start[1],start[2]+dz*portion];
 if(walkFraction===null)return stationary(base,heading);
 const fade=Math.min(1,walkFraction*8,(1-walkFraction)*8);
 const stride=Math.sin(walkFraction*WALK_TIMING.strides*2*Math.PI);
 const legSwing=17*fade*stride;
 return {
  base,heading,legSwing,armSwing:-12*fade*stride,
  bob:.006*fade*(1-Math.cos(walkFraction*WALK_TIMING.strides*4*Math.PI))*.5,
  walking:true
 };
}

/**
 * Place a rigid capsule at a hip/shoulder pivot. Its centre offsets with the
 * limb rotation so the rounded end remains connected to the torso. No IK,
 * detached white joints, or rotating meshes around the wrong anchor.
 *
 * Leg and arm shape profiles are centred on their own Y axes.
 */
export function mannequinLimbPose(pivot,halfLength,pitchDegrees){
 const radians=pitchDegrees*Math.PI/180;
 return {
  center:[pivot[0],pivot[1]-halfLength*Math.cos(radians),pivot[2]-halfLength*Math.sin(radians)],
  pitch:pitchDegrees
 };
}
