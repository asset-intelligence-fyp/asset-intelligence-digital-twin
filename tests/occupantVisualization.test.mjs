import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHARACTER_PROFILES,characterProfileGeometry,loftedPart} from '../src/viewer/characterGeometry.js';
import {CHARACTER_STYLES,CHARACTER_PLACEMENTS,CHARACTER_SCALES,characterMotion,mannequinLimbPose,boundWalkSegment,WALK_TIMING} from '../src/viewer/characterDesign.js';
import {TOUR_LEVELS,makeTourPlan,occupantViewCount} from '../src/viewer/occupantTour.js';

test('rounded mannequin geometry uses three simple body profiles',()=>{
 assert.deepEqual(Object.keys(CHARACTER_PROFILES),['torso','arm','leg']);
 const mesh=characterProfileGeometry();
 assert.deepEqual(Object.keys(mesh),['torso','arm','leg']);
 assert.ok(Object.values(mesh).every(g=>g.positions.length===g.normals.length));
 assert.ok(Object.values(mesh).every(g=>g.indices.length>100));
 assert.ok(new Set(mesh.torso.positions.filter((_,i)=>i%3===0).map(n=>n.toFixed(2))).size>=8);
 // Capsule-like tips are narrow, preventing visibly square shoulders and feet.
 for(const part of ['arm','leg']){
  const rings=CHARACTER_PROFILES[part];
  assert.ok(rings[0].rx<.025&&rings.at(-1).rx<.025);
 }
 assert.throws(()=>loftedPart([CHARACTER_PROFILES.torso[0]],4));
});

test('building-tour visual count spans five actual storeys without any sensor inputs',()=>{
 const levels=[{id:'Level_01',elevation:55.5},{id:'Level_02',elevation:59.7},{id:'Level_03',elevation:63.65},{id:'Level_04',elevation:67.6},{id:'Level_05',elevation:71.92}];
 const plan=makeTourPlan([0,51,0,40,82,30],levels);
 assert.deepEqual(Object.keys(plan),TOUR_LEVELS.map(p=>p.floor));
 assert.ok(Object.values(plan).every(a=>a.length>=2&&a.every(p=>p.start[1]>=50)));
 assert.equal(occupantViewCount('tour',{anything:999}),TOUR_LEVELS.reduce((a,b)=>a+b.count,0));
 assert.equal(occupantViewCount('sensor',{'L03-OPEN-01':7}),7);
});

test('tour positions prefer real BIM space-floor triangles rather than the building centre',()=>{
 const levels=[{id:'Level_01',elevation:55.5},{id:'Level_02',elevation:59.7},{id:'Level_03',elevation:63.65},{id:'Level_04',elevation:67.6},{id:'Level_05',elevation:71.92}];
 const footprints={rooms:{'office':{
  positions:[2,59.7,3,14,59.7,3,2,59.7,14,14,59.7,14],
  indices:[0,1,2,1,3,2]
 }}};
 const plan=makeTourPlan([0,51,0,40,82,30],levels,footprints);
 assert.equal(plan.Level_02.length,4);
 assert.ok(plan.Level_02.some(p=>p.source==='ifc-room'));
 assert.ok(plan.Level_02.filter(p=>p.source==='ifc-room').every(p=>
  p.start[0]>=2&&p.start[0]<=14&&p.start[2]>=3&&p.start[2]<=14));
 assert.ok(plan.Level_01.every(p=>p.source==='staged'));
 assert.ok(plan.Level_05.every(p=>p.source==='staged'));
 for(const item of TOUR_LEVELS)assert.equal(plan[item.floor].length,item.count);
});
test('tour ignores out-of-level geometry and malformed bounding values',()=>{
 const levels=TOUR_LEVELS.map((l,i)=>({id:l.floor,elevation:55.5+i*4}));
 const footprint={rooms:{bad:{positions:[0,900,0,10,900,0,0,900,10],indices:[0,1,2]}}};
 const p=makeTourPlan([0,40,0,50,100,60],levels,footprint);
 assert.ok(Object.values(p).flat().every(x=>x.source==='staged'));
 assert.deepEqual(makeTourPlan([0,NaN,0,50,100,60],levels,footprint),{});
});


test('exactly four bright single-colour variants contain no hair, skin or trim',()=>{
 assert.deepEqual(CHARACTER_STYLES.map(x=>x.name),['Blue','Teal','Coral','Violet']);
 for(const style of CHARACTER_STYLES){
  assert.equal(style.colour.length,3);
  assert.ok(style.colour.every(v=>v>=.10&&v<=.95));
  assert.ok(Math.max(...style.colour)-Math.min(...style.colour)>.20);
  assert.ok(style.height>=.97&&style.height<=1.03);
  assert.deepEqual(Object.keys(style).sort(),['colour','height','name']);
 }
 assert.deepEqual(Object.keys(CHARACTER_PLACEMENTS).sort(),['armL','armR','head','legL','legR','torso'].sort());
 assert.deepEqual(Object.keys(CHARACTER_SCALES).sort(),Object.keys(CHARACTER_PLACEMENTS).sort());
 const source=readFileSync(new URL('../src/viewer/occupantLayer.js',import.meta.url),'utf8');
 assert.equal((source.match(/\bpart\('/g)||[]).length,6,'only six scene parts per mannequin');
 assert.ok(!source.includes('part(style.hair'));
 assert.ok(!source.includes("part('lapel'"));
 assert.ok(!source.includes("part('collar'"));
});

test('simple walk stays inside its room segment, pauses and faces both directions',()=>{
 const anchor={start:[4,63.65,8],end:[5,63.65,8]};
 const frozen=characterMotion(anchor,0,1500,false);
 assert.deepEqual(frozen.base,anchor.start);
 assert.equal(frozen.legSwing,0);
 assert.equal(frozen.armSwing,0);
 assert.equal(frozen.bob,0);
 const atEnd=characterMotion(anchor,0,WALK_TIMING.travelMs,true);
 const halfTurn=characterMotion(anchor,0,WALK_TIMING.travelMs+WALK_TIMING.turnMs/2,true);
 const reverse=characterMotion(anchor,0,WALK_TIMING.travelMs+WALK_TIMING.turnMs,true);
 assert.deepEqual(atEnd.base,anchor.end);
 assert.deepEqual(halfTurn.base,anchor.end);
 assert.deepEqual(reverse.base,anchor.end);
 assert.ok(Math.abs(halfTurn.heading-atEnd.heading-90)<1e-8);
 assert.ok(Math.abs(reverse.heading-atEnd.heading-180)<1e-8);
 assert.equal(halfTurn.legSwing,0);
 assert.equal(halfTurn.armSwing,0);
 assert.ok(characterMotion(anchor,0,WALK_TIMING.travelMs+WALK_TIMING.turnMs+500,true).base[0]<5);
 for(let i=0;i<=200;i++){
  const motion=characterMotion(anchor,0,i*37,true);
  assert.ok(motion.base[0]>=4&&motion.base[0]<=5);
  assert.equal(motion.base[1],63.65);
  assert.ok(Math.abs(motion.legSwing)<=17.001);
  assert.ok(Math.abs(motion.armSwing)<=12.001);
  assert.ok(motion.bob>=0&&motion.bob<=.006001);
 }
 assert.deepEqual(characterMotion(anchor,0,700,true),characterMotion(anchor,0,700,true));
});

test('rounded limbs rotate from fixed shoulder and hip pivots',()=>{
 for(const half of [.309,.386]){
  for(const pitch of [-17,-10,0,10,17]){
   const pivot=[.12,.9,0],pose=mannequinLimbPose(pivot,half,pitch);
   const radians=pitch*Math.PI/180;
   // Rotating the upper mesh tip about its centre recovers its pivot.
   assert.ok(Math.abs(pose.center[1]+half*Math.cos(radians)-pivot[1])<1e-10);
   assert.ok(Math.abs(pose.center[2]+half*Math.sin(radians)-pivot[2])<1e-10);
  }
 }
 const resting=mannequinLimbPose([-.118,.800,0],.386,0);
 assert.ok(resting.center[1]-.386>.01&&resting.center[1]-.386<.05,'feet should nearly touch the BIM floor');
});

test('room-safe walking endpoints cap distance without leaving IFC triangle',()=>{
 const long=boundWalkSegment([0,60,0],[8,60,5]);
 const length=Math.hypot(long.end[0]-long.start[0],long.end[2]-long.start[2]);
 assert.ok(length<=1.100001);
 assert.ok(long.end[0]>=0&&long.end[0]<=8&&long.end[2]>=0&&long.end[2]<=5);
 assert.deepEqual(boundWalkSegment([0,60,0],[.5,60,.1]),{start:[0,60,0],end:[.5,60,.1]});
});
