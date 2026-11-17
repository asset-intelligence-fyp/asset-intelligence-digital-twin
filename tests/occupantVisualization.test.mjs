import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_PROFILES,characterProfileGeometry,loftedPart} from '../src/viewer/characterGeometry.js';
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
