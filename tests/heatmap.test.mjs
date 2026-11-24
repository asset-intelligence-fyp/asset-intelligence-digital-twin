import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildHeatmapBands,bandMaterialColours,clipHeatmapPolygon} from '../src/viewer/heatmapBands.js';
import {facadeHull,clipToFacade,buildContainedFloorGrid} from '../src/viewer/heatmapFootprint.js';
import {
 HEATMAP_STOPS,heatmapColour,heatmapScore,heatmapSamples,
 interpolateHeatmap,subdivideFootprint,sensorVicinity,heatmapVertexColours,
 buildFloorHeatmapGrid,interpolateWholeFloor,wholeFloorVertexColours,
 trimSlabsToEnvelope,floorHeatmapPixels,limitFloorHeatmapToBuilding
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
 assert.ok(grid.positions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-59.9)<1e-8));
 assert.equal(grid.indices.length,grid.cellCount*6);
 assert.equal(grid.uv.length,grid.positions.length/3*2,'each floor vertex must have texture UVs');
 assert.ok(grid.uv.every(v=>v>=0&&v<=1));
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

test('oversized exterior slab bounds are clipped to storey wall envelope',()=>{
 const slabs=[[0,59.5,-100,100,60,-1],[250,59.5,-100,300,60,-1]];
 const walls=[[38,59.7,-74,69,62.9,-44],[43,59.7,-77,64,63,-42]];
 const trimmed=trimSlabsToEnvelope(slabs,walls,1.5);
 assert.equal(trimmed.length,1,'discard disjoint exterior slabs');
 assert.ok(trimmed[0][0]>=36.5&&trimmed[0][3]<=70.5);
 assert.ok(trimmed[0][2]>=-78.5&&trimmed[0][5]<=-40.5);
 assert.deepEqual(trimSlabsToEnvelope(slabs,[]),slabs);
});

test('browser texture pixel raster includes vivid green, yellow and red zones',()=>{
 const floor=[0,60,0,20,60.2,8];
 const samples=[{x:1,z:4,score:0},{x:19,z:4,score:1}];
 const pixels=floorHeatmapPixels(floor,samples,80,24);
 assert.equal(pixels.length,80*24*4);
 const get=(x,y)=>Array.from(pixels.slice((y*80+x)*4,(y*80+x)*4+4));
 const green=get(2,12),mid=get(40,12),red=get(77,12);
 assert.ok(green[1]>green[0]*1.5,'green region should be visibly green');
 assert.ok(mid[0]>130&&mid[1]>110,'middle should have a warm blend');
 assert.ok(red[0]>red[1]*1.5,'red region should be visibly red');
 assert.ok([green,mid,red].every(c=>c[3]===255),'RGBA texture source remains opaque; material controls transparency');
 const empty=floorHeatmapPixels(floor,[],16,16);
 assert.deepEqual(Array.from(empty.slice(0,4)),[138,150,163,255]);
});

test('actual heatmap renderer builds solid-colour 32-band polygons instead of blank textures',()=>{
 const grid=buildFloorHeatmapGrid([[0,60,0,24,60.3,12]],60,{cellSize:2});
 const samples=[{x:1,z:6,score:0},{x:23,z:6,score:1}];
 const bands=buildHeatmapBands(grid,samples,32);
 assert.ok(bands.length>=15,'normal-to-abnormal data must produce intermediate gradient bands');
 assert.ok(bands.every(b=>b.positions.length===b.normals.length));
 assert.ok(bands.every(b=>b.indices.length%3===0));
 assert.ok(new Set(bands.map(b=>b.index)).size===bands.length);
 const bandArea=bands.reduce((sum,band)=>{
  for(let i=0;i<band.positions.length;i+=9){
   const p=band.positions.slice(i,i+9);
   const signed=(p[3]-p[0])*(p[8]-p[2])-(p[5]-p[2])*(p[6]-p[0]);
   sum+=Math.abs(signed)/2;
  }
  return sum;
 },0);
 const originalArea=grid.cellCount*24/Math.ceil(24/2)*12/Math.ceil(12/2);
 assert.ok(Math.abs(bandArea-originalArea)<.01,'iso-band triangles must cover entire real floor footprint without gaps');
 const palette=bandMaterialColours(32);
 assert.equal(palette.length,32);
 assert.ok(palette[0][1]>palette[0][0],'first direct material is green');
 assert.ok(palette.at(-1)[0]>palette.at(-1)[1],'last direct material is red');
 assert.ok(palette[16][0]>.6&&palette[16][1]>.6,'middle direct material is yellow');
 const single=buildHeatmapBands(grid,[{x:10,z:5,score:.25}],32);
 assert.equal(single.length,1,'single-sensor floor should be uniform, never a fabricated gradient');
 assert.equal(buildHeatmapBands(grid,[],32).length,0,'no sensor means no visible floor plate');
});

test('iso-band clipping retains interpolated contour boundaries',()=>{
 const tri=[{x:0,y:60,z:0,score:0},{x:10,y:60,z:0,score:1},{x:0,y:60,z:10,score:0}];
 const higher=clipHeatmapPolygon(tri,.5,true);
 const lower=clipHeatmapPolygon(tri,.5,false);
 assert.ok(higher.length>=3&&lower.length>=3);
 assert.ok(higher.every(v=>v.score>=.5-1e-8));
 assert.ok(lower.every(v=>v.score<=.5+1e-8));
 assert.ok([...higher,...lower].some(v=>Math.abs(v.x-5)<1e-8&&Math.abs(v.score-.5)<1e-8));
});

test('site-sized floor rectangles are bounded by actual IFC room-derived building extent',()=>{
 const rooms={
  a:{positions:[40,60,-80,70,60,-80,70,60,-42,40,60,-42]},
  b:{positions:[27,64,-50,39,64,-50,39,64,-42]}
 };
 const giant=[[0,60,-120,120,60.3,20]];
 const clipped=limitFloorHeatmapToBuilding(giant,rooms,5);
 assert.deepEqual(clipped,[[22,60,-85,75,60.3,-37]]);
 assert.deepEqual(limitFloorHeatmapToBuilding([[20,60,-85,76,60.3,-38]],rooms,5),[[20,60,-85,76,60.3,-38]],'plausible IFC slabs must not be truncated');
 assert.deepEqual(limitFloorHeatmapToBuilding(giant,{},5),giant);
});

test('live floor overlay uses native xeokit colour materials rather than broken texture or vertex colours',()=>{
 const source=readFileSync(new URL('../src/viewer/heatmapLayer.js',import.meta.url),'utf8');
 assert.ok(source.includes('PhongMaterial(scene,'));
 assert.ok(source.includes('diffuse:rgb'));
 assert.ok(source.includes('buildHeatmapBands('));
 assert.ok(!source.includes('diffuseMap:'),'dynamic diffuse texture path previously rendered white');
 assert.ok(!source.includes('new Texture('));
 assert.ok(!source.includes('.geometry.colors='));
 assert.ok(!source.includes('region.mesh.opacity'));
});

test('floor overlays are clipped to IFC facade walls, not slab AABB rectangles',()=>{
 const slab=[[0,59.8,0,60,60.2,60]];
 const walls=[
  [10,60,20,30,63.5,20.3],[10,60,39.7,30,63.5,40],
  [10,60,20,10.3,63.5,40],[29.7,60,20,30,63.5,40]
 ];
 const grid=buildContainedFloorGrid(slab,walls,60,{cellSize:1.25});
 assert.ok(grid.cellCount>100,'interior should still be covered by a broad colour field');
 assert.ok(grid.cellCount<500,'site slab must not create a giant external sheet');
 assert.ok(['wall-enclosed','facade-hull'].includes(grid.source));
 const vertices=[];
 for(let i=0;i<grid.positions.length;i+=3)vertices.push([grid.positions[i],grid.positions[i+2]]);
 assert.ok(vertices.every(([x,z])=>x>=10.39&&x<=29.61&&z>=20.39&&z<=39.61),
  'every rendered triangle must be inset from exterior IFC walls');
 assert.ok(grid.positions.every(Number.isFinite));
 const hull=facadeHull(walls);
 assert.equal(hull.length,4);
 assert.equal(clipToFacade([{x:0,z:0},{x:2,z:0},{x:2,z:2},{x:0,z:2}],hull,.3).length,0);
 assert.ok(clipToFacade([{x:15,z:25},{x:20,z:25},{x:20,z:30},{x:15,z:30}],hull,.3).length>=3);
 const absent=buildContainedFloorGrid(slab,[],60);
 assert.equal(absent.cellCount,0,'missing wall geometry cannot silently justify an oversized heatmap');
});

test('closed concave IFC wall outline does not colour the outdoor L-shaped courtyard',()=>{
 const polygon=[[0,0],[20,0],[20,8],[8,8],[8,20],[0,20],[0,0]];
 const walls=[];
 for(let i=1;i<polygon.length;i++){
  const [a,b]=[polygon[i-1],polygon[i]];
  walls.push([Math.min(a[0],b[0])-.2,60,Math.min(a[1],b[1])-.2,
   Math.max(a[0],b[0])+.2,63.5,Math.max(a[1],b[1])+.2]);
 }
 const grid=buildContainedFloorGrid([[-3,60,-3,23,60.2,23]],walls,60,{cellSize:.65,inset:.25});
 assert.equal(grid.source,'wall-enclosed','the closed facade should be rasterised, not just convex-hulled');
 assert.ok(grid.cellCount>100);
 let courtyard=0,wing=0;
 for(let i=0;i<grid.positions.length;i+=3){
  const x=grid.positions[i],z=grid.positions[i+2];
  if(x>10&&z>10)courtyard++;
  if(x<5&&z>10)wing++;
 }
 assert.equal(courtyard,0,'do not draw colours over the outdoor concave recess');
 assert.ok(wing>0,'the interior upper wing must still be painted');
});

test('heatmap renderer consumes the wall-clipped mesh rather than the old slab grid',()=>{
 const source=readFileSync(new URL('../src/viewer/heatmapLayer.js',import.meta.url),'utf8');
 const navigationSource=readFileSync(new URL('../src/viewer/navigationController.js',import.meta.url),'utf8');
 assert.ok(source.includes('buildContainedFloorGrid(entry.aabbs,entry.facadeAabbs'));
 assert.ok(navigationSource.includes('facadeAabbs'));
 assert.ok(!source.includes('buildFloorHeatmapGrid(entry.aabbs'));
});
