import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 HEATMAP_STOPS,heatmapColour,heatmapScore,heatmapSamples,
 interpolateHeatmap,subdivideFootprint,sensorVicinity,heatmapVertexColours,
 buildFloorHeatmapGrid,interpolateWholeFloor,wholeFloorVertexColours
} from '../src/viewer/heatmapField.js';
const points=JSON.parse(readFileSync('shared/sensorRegistry.json','utf8'));
const navigation=JSON.parse(readFileSync('shared/modelNavigation.json','utf8'));
const footprints=JSON.parse(readFileSync('shared/roomFootprints.json','utf8'));
const definitions=JSON.parse(readFileSync('shared/sensorDefinitions.json','utf8'));

test('green-to-red palette is continuous, ordered and includes yellow and orange',()=>{
 assert.equal(HEATMAP_STOPS.length,5);
 assert.ok(heatmapColour(0)[1]>heatmapColour(0)[0]);
 assert.ok(heatmapColour(1)[0]>heatmapColour(1)[1]);
 for(const t of [0,.1,.25,.37,.5,.63,.75,.9,1]){
  assert.ok(heatmapColour(t).every(v=>v>=0&&v<=1));
 }
 for(const stop of HEATMAP_STOPS){
  for(const offset of [.000001,.00001]){
   const a=heatmapColour(Math.max(0,stop[0]-offset)),b=heatmapColour(Math.min(1,stop[0]+offset));
   assert.ok(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))<.0002,'no hard jumps in continuous heatmap');
  }
 }
});

test('threshold-aware scoring handles high, low, binary and intensity meanings',()=>{
 assert.equal(heatmapScore('temperature',24,definitions.temperature),0);
 assert.equal(heatmapScore('temperature',30,definitions.temperature),1);
 assert.equal(heatmapScore('temperature',16,definitions.temperature),1);
 assert.ok(heatmapScore('temperature',28,definitions.temperature)>.30);
 assert.equal(heatmapScore('humidity',55,definitions.humidity),0);
 assert.equal(heatmapScore('humidity',75,definitions.humidity),1);
 assert.equal(heatmapScore('humidity',25,definitions.humidity),1);
 assert.equal(heatmapScore('co2',700,definitions.co2),0);
 assert.equal(heatmapScore('co2',1200,definitions.co2),1);
 assert.equal(heatmapScore('water_leakage',0,definitions.water_leakage),0);
 assert.equal(heatmapScore('water_leakage',1,definitions.water_leakage),1);
 assert.equal(heatmapScore('power',8,definitions.power),1);
 assert.equal(heatmapScore('occupancy',1,definitions.occupancy),1);
 assert.equal(heatmapScore('light',400,definitions.light),.5);
 assert.equal(heatmapScore('humidity',null),null);
});

test('IDW-like floor field smoothly blends green and red readings',()=>{
 const sensors=[{x:0,z:0,score:0},{x:10,z:0,score:1}];
 assert.equal(interpolateHeatmap(0,0,sensors).score,0);
 assert.equal(interpolateHeatmap(10,0,sensors).score,1);
 const quarter=interpolateHeatmap(2.5,0,sensors);
 const middle=interpolateHeatmap(5,0,sensors);
 const threeQuarter=interpolateHeatmap(7.5,0,sensors);
 assert.ok(quarter.score>0&&quarter.score<.5);
 assert.ok(Math.abs(middle.score-.5)<1e-9);
 assert.ok(threeQuarter.score>.5&&threeQuarter.score<1);
 assert.ok(interpolateHeatmap(5,5,sensors).coverage<interpolateHeatmap(5,0,sensors).coverage);
 assert.equal(interpolateHeatmap(100,100,sensors),null);
 assert.equal(interpolateHeatmap(1,0,[]),null);
});

test('only measured metrics contribute to composite conditions; missing excluded',()=>{
 const enriched=points.map(p=>({...p,roomGuid:footprints.sensors[p.guid]?.roomGuid||null}));
 const values={temperature:24,humidity:55,co2:650,occupancy:1,light:400,water_leakage:0,power:3};
 const readings=Object.fromEntries(points.map(p=>[p.code,{value:values[p.sensorType],quality:'simulated'}]));
 const overall=heatmapSamples(enriched,navigation.sensors,readings,'status',definitions);
 assert.ok(overall.length>0);
 assert.ok(overall.every(p=>!['light','occupancy'].includes(points.find(x=>x.code===p.code).sensorType)));
 assert.deepEqual([...new Set(overall.map(p=>p.floor))].sort(),['Level_02','Level_03','Level_04','Level_05']);
 const humidity=heatmapSamples(enriched,navigation.sensors,readings,'humidity',definitions);
 assert.ok(humidity.every(p=>p.code.startsWith('RH-')));
 const noReadings=heatmapSamples(enriched,navigation.sensors,{},'status',definitions);
 assert.equal(noReadings.length,0);
 readings['RH-L03-OPEN-01']={value:null,quality:'missing'};
 assert.ok(!heatmapSamples(enriched,navigation.sensors,readings,'humidity',definitions).some(p=>p.code==='RH-L03-OPEN-01'));
});

test('original IFC triangles are subdivided without inventing new floor polygons',()=>{
 const source=[0,60,0,10,60,0,0,60,10];
 const mesh=subdivideFootprint(source,[0,1,2],5,.28);
 assert.equal(mesh.indices.length/3,25);
 assert.equal(mesh.positions.length,mesh.normals.length);
 assert.equal(Math.min(...mesh.positions.filter((_,i)=>i%3===1)),60.28);
 for(let i=0;i<mesh.positions.length;i+=3){
  const x=mesh.positions[i],z=mesh.positions[i+2];
  assert.ok(x>=0&&z>=0&&x+z<=10.00000001);
 }
 const fallback=sensorVicinity([2,60.3,3]);
 assert.ok(fallback.indices.length>100);
 assert.ok(fallback.positions.filter((_,i)=>i%3===1).every(y=>y===60.3));
});

test('per-vertex colours have RGBA gradient with alpha fading, not unsupported green',()=>{
 const mesh=subdivideFootprint([0,60,0,10,60,0,0,60,10],[0,1,2],4);
 const readings=[{x:0,z:0,score:0},{x:10,z:0,score:1}];
 const rgba=heatmapVertexColours(mesh.positions,readings,'status');
 assert.equal(rgba.length,mesh.positions.length/3*4);
 assert.ok(rgba.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 const remote=heatmapVertexColours([200,60,300],readings,'status');
 assert.deepEqual(remote,[0,0,0,0]);
 assert.ok(heatmapVertexColours([0,60,0],[{x:0,z:0,score:1}],'water_leakage')[3]>.5);
});

test('full-floor grid spans actual slab bounds instead of sensor-centred circles',()=>{
 const slab=[10,59.7,-50,90,59.92,-10],grid=buildFloorHeatmapGrid([slab],59.7);
 assert.ok(grid.cellCount>800,'the heatmap must cover the entire large floor');
 assert.deepEqual([grid.bounds[0],grid.bounds[2],grid.bounds[3],grid.bounds[5]],[10,-50,90,-10]);
 assert.ok(grid.positions.every(Number.isFinite));
 assert.ok(grid.positions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-60.16)<1e-8));
 assert.equal(grid.indices.length,grid.cellCount*6);
 // The union of two separated IFC slabs must not paint the gap as measured.
 const separate=buildFloorHeatmapGrid([[0,60,0,10,60.2,10],[20,60,0,30,60.2,10]],60);
 assert.ok(separate.cellCount>0);
 for(let i=0;i<separate.indices.length;i+=3){
  const ids=separate.indices.slice(i,i+3),center=ids.map(id=>separate.positions[id*3]).reduce((a,b)=>a+b,0)/3;
  assert.ok(center<=10.5||center>=19.5,'no synthetic floor material in slab gap');
 }
 assert.equal(buildFloorHeatmapGrid([],60).cellCount,0);
});

test('floor-wide gradient reaches boundaries without circular alpha fading',()=>{
 const floor=buildFloorHeatmapGrid([[0,60,0,50,60.2,30]],60);
 const sensors=[{x:7,z:14,score:0},{x:43,z:14,score:1}];
 const colors=wholeFloorVertexColours(floor.positions,sensors);
 assert.equal(colors.length,floor.positions.length/3*4);
 const at=(x,z)=>{
  let best=-1,distance=Infinity;
  for(let i=0;i<floor.positions.length;i+=3){
   const d=Math.hypot(floor.positions[i]-x,floor.positions[i+2]-z);
   if(d<distance){best=i/3;distance=d;}
  }
  return colors.slice(best*4,best*4+4);
 };
 const left=at(0,15),center=at(25,15),right=at(50,15);
 assert.ok(left[1]>left[0],'left portion green');
 assert.ok(center[0]>0&&center[1]>0,'middle blends both channels');
 assert.ok(right[0]>right[1],'right portion red');
 assert.ok([left,center,right].every(c=>c[3]>=.9),'colours remain visible at floor edges');
 const onlyOne=wholeFloorVertexColours(floor.positions,[sensors[0]]);
 assert.ok(onlyOne.every((n,i)=>i%4===3?n>=.9:n>=0));
 assert.equal(interpolateWholeFloor(0,0,[]),null);
 assert.equal(interpolateWholeFloor(1000,1000,sensors)>0,true,'estimate extends across the complete floor');
});

test('unmonitored floor is neutral grey, not an invented healthy zone',()=>{
 const grid=buildFloorHeatmapGrid([[0,60,0,10,60.2,10]],60);
 const colors=wholeFloorVertexColours(grid.positions,[]);
 assert.ok(colors.every((v,i)=>i%4===3?v===.45:v>=.45&&v<=.56));
});
