/**
 * Four restrained office-occupant variants shared by live-simulator and
 * visual-only tour displays. All figures use the same reusable procedural
 * geometry. None represent identifiable people or measured headcounts.
 */
export const CHARACTER_STYLES=[
 {
  name:'Navy blazer',torso:'jacket',hair:'hairCrop',collar:true,lapels:true,height:1.00,
  palette:{outer:[.22,.30,.39],trousers:[.19,.23,.29],skin:[.74,.55,.43],
   hair:[.16,.19,.23],shoes:[.12,.15,.19],trim:[.72,.77,.79]}
 },
 {
  name:'Sage shirt',torso:'blouse',hair:'hairSide',collar:true,lapels:false,height:.97,
  palette:{outer:[.41,.54,.50],trousers:[.30,.35,.38],skin:[.86,.68,.56],
   hair:[.24,.19,.18],shoes:[.21,.24,.27],trim:[.82,.84,.81]}
 },
 {
  name:'Slate cardigan',torso:'cardigan',hair:'hairTaper',collar:false,lapels:true,height:1.025,
  palette:{outer:[.41,.47,.55],trousers:[.23,.27,.33],skin:[.61,.44,.34],
   hair:[.13,.15,.18],shoes:[.14,.16,.19],trim:[.67,.72,.76]}
 },
 {
  name:'Stone jacket',torso:'longline',hair:'hairSide',collar:true,lapels:true,height:.995,
  palette:{outer:[.53,.54,.51],trousers:[.27,.31,.34],skin:[.93,.76,.62],
   hair:[.27,.23,.20],shoes:[.21,.22,.22],trim:[.80,.82,.78]}
 }
];

/**
 * Anthropometric placement in metres, with floor at Y=0 and head around
 * 1.60m. Upper arm, leg and foot profiles are deliberately slender.
 */
export const CHARACTER_PLACEMENTS={
 head:[0,1.60,0],hair:[0,1.685,0],neck:[0,1.419,0],
 torso:[0,1.14,0],armL:[-.285,1.155,0],armR:[.285,1.155,0],
 handL:[-.285,.793,0],handR:[.285,.793,0],
 legL:[-.106,.431,0],legR:[.106,.431,0],
 shoeL:[-.106,.077,-.062],shoeR:[.106,.077,-.062],
 lapelL:[-.102,1.304,-.149],lapelR:[.102,1.304,-.149],
 collar:[0,1.443,0]
};

export const CHARACTER_SCALES={
 head:[.167,.203,.154],handL:[.070,.080,.072],handR:[.070,.080,.072],
 shoeL:[.136,.079,.203],shoeR:[.136,.079,.203]
};

/**
 * A quiet 3D walking pose with short IFC-contained paths. Arm/leg swing never
 * exceeds 9 degrees, and the body bob is under 8 mm. This function has no
 * side effects and is testable without WebGL.
 */
export function characterMotion(anchor,index,nowMs,walking){
 const start=anchor?.start||[0,0,0],end=anchor?.end||start;
 const dx=end[0]-start[0],dz=end[2]-start[2];
 const heading=Math.hypot(dx,dz)>.025?Math.atan2(dx,-dz)*180/Math.PI:(index%4)*90;
 if(!walking)return {base:[...start],heading,gait:0,sway:0,bob:0};
 const phase=nowMs*.00115+index*.61;
 const travel=(1-Math.cos(phase))*.5;
 const gait=Math.sin(phase*4.2);
 return {
  base:[start[0]+(end[0]-start[0])*travel,start[1],start[2]+(end[2]-start[2])*travel],
  heading,gait:8*gait,sway:.7*Math.sin(phase*2.1),bob:.007*Math.abs(gait)
 };
}
