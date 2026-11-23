import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_PROFILES,characterProfileGeometry,loftedPart} from '../src/viewer/characterGeometry.js';
import {CHARACTER_STYLES,CHARACTER_PLACEMENTS,CHARACTER_SCALES,characterMotion} from '../src/viewer/characterDesign.js';
import {TOUR_LEVELS,makeTourPlan,occupantViewCount} from '../src/viewer/occupantTour.js';

test('authored character geometries are triangulated curved assets, not rectangular prisms',()=>{
 const mesh=characterProfileGeometry();
 assert.ok(Object.keys(mesh).length>=6);
 assert.ok(Object.values(mesh).every(g=>g.positions.length===g.normals.length));
 assert.ok(Object.values(mesh).every(g=>g.indices.length>100));
 const torso=mesh.jacket;
 assert.ok(new Set(torso.positions.filter((_,i)=>i%3===0).map(n=>n.toFixed(2))).size>=8);
 assert.throws(()=>loftedPart([CHARACTER_PROFILES.jacket[0]],4));
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

test('four professional occupant styles are shareable, distinct and fully authored',()=>{
 assert.equal(CHARACTER_STYLES.length,4);
 assert.equal(new Set(CHARACTER_STYLES.map(v=>v.name)).size,4);
 assert.equal(new Set(CHARACTER_STYLES.map(v=>v.torso)).size,4);
 const geometry=characterProfileGeometry();
 for(const style of CHARACTER_STYLES){
  assert.ok(geometry[style.torso]&&geometry[style.hair]);
  assert.ok(style.height>=.95&&style.height<=1.05);
  assert.ok(['jacket','blouse','cardigan','longline'].includes(style.torso));
  for(const key of ['outer','trousers','skin','hair','shoes','trim']){
   const colour=style.palette[key];
   assert.equal(colour.length,3);
   assert.ok(colour.every(n=>Number.isFinite(n)&&n>=.10&&n<=.95));
  }
 }
 // Smaller, architecturally-scaled head rather than the old toy-like ratio.
 assert.ok(CHARACTER_SCALES.head[0]*2<CHARACTER_PROFILES.jacket[3].rx*2*.75);
 assert.ok(CHARACTER_PLACEMENTS.head[1]+CHARACTER_SCALES.head[1]<1.9);
 assert.ok(CHARACTER_PLACEMENTS.shoeL[1]-CHARACTER_SCALES.shoeL[1]>=-.01);
});

test('occupants use a restrained deterministic gait and honour stationary mode',()=>{
 const anchor={start:[4,63.65,8],end:[4.35,63.65,8.15]};
 const first=characterMotion(anchor,2,1300,true);
 const repeat=characterMotion(anchor,2,1300,true);
 assert.deepEqual(first,repeat);
 assert.ok(first.base[0]>=4&&first.base[0]<=4.35);
 assert.ok(first.base[2]>=8&&first.base[2]<=8.15);
 for(let i=0;i<100;i++){
  const pose=characterMotion(anchor,2,i*55,true);
  assert.ok(Math.abs(pose.gait)<=8.001);
  assert.ok(Math.abs(pose.sway)<=.701);
  assert.ok(pose.bob>=0&&pose.bob<=.00701);
  assert.equal(pose.base[1],63.65,'walking must remain on the IFC floor');
 }
 const paused=characterMotion(anchor,2,1300,false);
 assert.deepEqual(paused.base,anchor.start);
 assert.equal(paused.gait,0);
 assert.equal(paused.sway,0);
 assert.equal(paused.bob,0);
});
