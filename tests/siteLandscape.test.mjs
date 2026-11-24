import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 makeSiteLayout,segmentDistance,pathDistance,buildGrassFacets,
 buildPavedPaths,buildFacetedFrustum,grassOutsideBuilding,buildGrassBaseBlocks
} from '../src/viewer/siteLandscapeMath.js';

const MODEL_BOUNDS=[-14,0,-9,67,21,38];
const layout=makeSiteLayout(MODEL_BOUNDS);

test('conceptual landscaping stays outside the IFC building and avoids footpaths',()=>{
 assert.ok(layout,'a valid model bounding box should produce a site');
 assert.ok(layout.trees.length>=8,'site should have several visible trees');
 assert.ok(layout.paths.length>=3);
 const [x0,z0,x1,z1]=layout.building;
 for(const tree of layout.trees){
  assert.ok(!(tree.x>x0-2&&tree.x<x1+2&&tree.z>z0-2&&tree.z<z1+2),
   'a decorative tree must never be placed in the BIM shell');
  assert.ok(pathDistance(tree.x,tree.z,layout.paths)>2.24,
   'tree trunks need clear space beside the pedestrian paths');
 }
 assert.ok(Math.abs(segmentDistance(3,4,[0,0],[0,8])-3)<1e-9);
 assert.equal(pathDistance(0,0,[]),Infinity);
 assert.equal(makeSiteLayout([0,0,0,0,1,1]),null);
 assert.equal(makeSiteLayout([0,0,0,1,1,Infinity]),null);
});

test('faceted site grass has a bounded palette of triangulated nonflat facets',()=>{
 const parts=buildGrassFacets(layout,{columns:19,rows:15});
 assert.equal(parts.length,5);
 const triangleCount=parts.reduce((sum,p)=>sum+p.indices.length/3,0);
 assert.ok(triangleCount>0,'landscape must still cover the exterior site');
 assert.ok(triangleCount<19*15*4,'facade clipping should not excessively triangulate the scene');
 for(const part of parts){
  assert.equal(part.primitive,'triangles');
  assert.equal(part.positions.length,part.normals.length);
  assert.ok(part.indices.every(v=>v>=0&&v<part.positions.length/3));
 }
 const heights=parts.flatMap(p=>p.positions.filter((_,i)=>i%3===1));
 assert.ok(Math.max(...heights)-Math.min(...heights)>.01,'turf should not be one flat green rectangle');
 const [west,north,east,south]=layout.bounds;
 for(const p of parts)for(let i=0;i<p.positions.length;i+=3){
  assert.ok(p.positions[i]>=west-.01&&p.positions[i]<=east+.01);
  assert.ok(p.positions[i+2]>=north-.01&&p.positions[i+2]<=south+.01);
 }
});

test('stone pavers are elevated 220mm from turf and expose real vertical sides',()=>{
 const turf=buildGrassFacets(layout);
 const pavers=buildPavedPaths(layout);
 assert.ok(pavers.tileCount>100,'paths must be present');
 assert.ok(pavers.edgeCount>0);
 assert.equal(pavers.stone.length,3);
 assert.equal(pavers.under.indices.length/6,pavers.tileCount);
 assert.equal(pavers.curbs.indices.length/6,pavers.edgeCount);
 assert.ok(pavers.pathTop-pavers.grassTop>.18,
  'path surface must sit visibly above the highest grass polygon');
 const maxGrass=Math.max(...turf.flatMap(p=>p.positions.filter((_,i)=>i%3===1)));
 const minStone=Math.min(...pavers.stone.flatMap(p=>p.positions.filter((_,i)=>i%3===1)));
 assert.ok(minStone-maxGrass>.18,'no Z-fighting or grass/path overlap');
 const edges=pavers.curbs.positions.filter((_,i)=>i%3===1);
 assert.ok(Math.min(...edges)<layout.grassY,'curb skirts must extend below grass top');
 assert.ok(Math.max(...edges)>=layout.walkwayY-.001);
});

test('walkway intersections are a union without repeated overlapping tile surfaces',()=>{
 const pavers=buildPavedPaths(layout);
 const seen=new Set();
 for(const part of pavers.stone){
  for(let i=0;i<part.positions.length;i+=18){
   const quad=part.positions.slice(i,i+18);
   const x=quad.filter((_,j)=>j%3===0);
   const z=quad.filter((_,j)=>j%3===2);
   const k=[Math.min(...x),Math.max(...x),Math.min(...z),Math.max(...z)].map(v=>v.toFixed(4)).join(',');
   assert.ok(!seen.has(k),'the crossing walkway tile may only be rendered once');
   seen.add(k);
  }
 }
 assert.equal(seen.size,pavers.tileCount);
});

test('angular vegetation contains valid tapered trunks and three-dimensional conifer tiers',()=>{
 const trunk=buildFacetedFrustum(.94,.59,1,7);
 const cone=buildFacetedFrustum(1,.035,1,7);
 for(const part of [trunk,cone]){
  assert.equal(part.positions.length,part.normals.length);
  assert.ok(part.positions.length>100);
  assert.ok(part.normals.every(Number.isFinite));
  assert.ok(part.indices.every(v=>v>=0&&v<part.positions.length/3));
 }
 assert.ok(layout.trees.some(t=>t.kind==='pine'));
 assert.ok(layout.trees.some(t=>t.kind==='broadleaf'));
});

test('landscaping stays display-only and preserves existing BIM visibility contract',()=>{
 const layer=readFileSync(new URL('../src/viewer/siteLandscapeLayer.js',import.meta.url),'utf8');
 const viewer=readFileSync(new URL('../src/viewer/wholeBuildingViewer.js',import.meta.url),'utf8');
 assert.ok(layer.includes('buildGrassFacets('));
 assert.ok(layer.includes('buildPavedPaths('));
 assert.ok(layer.includes('plantBroadleaf('));
 assert.ok(layer.includes('plantPine('));
 assert.ok(layer.includes('pickable:false,collidable:false,clippable:false,isObject:false'));
 assert.ok(viewer.includes("state.mode==='solid'&&state.floor==='all'"));
 assert.ok(viewer.includes('landscape.setVisible(site)'));
 assert.ok(viewer.includes('landscape.destroy()'));
});

test('site elevation follows Level 01 entrance, not basement foundation',()=>{
 const model=[-14,51,-9,67,83,38],entryLevel=55.5;
 const site=makeSiteLayout(model,{groundElevation:entryLevel});
 assert.equal(site.grassY,55.2,'grass should sit just below the Level 01 entrance');
 assert.ok(Math.abs(site.walkwayY-55.42)<1e-9,
  'raised pathways keep the same 22cm height above the lawn');
 const fallback=makeSiteLayout(model);
 assert.ok(Math.abs(fallback.grassY-50.12)<1e-9,
  'older models without known ground levels retain legacy positioning');
 const grass=buildGrassFacets(site),paving=buildPavedPaths(site);
 const maxTurf=Math.max(...grass.flatMap(p=>p.positions.filter((_,i)=>i%3===1)));
 const minPavers=Math.min(...paving.stone.flatMap(p=>p.positions.filter((_,i)=>i%3===1)));
 assert.ok(minPavers-maxTurf>.18,
  'moving landscaping upward must not create grass/paver intersections');
 const viewer=readFileSync(new URL('../src/viewer/wholeBuildingViewer.js',import.meta.url),'utf8');
 assert.ok(viewer.includes("level.id==='Level_01'"));
 assert.ok(viewer.includes('landscape.init(bounds,entryElevation)'));
});

test('raised turf never intersects the IFC building footprint',()=>{
 const model=[-14,51,-9,67,83,38];
 const site=makeSiteLayout(model,{groundElevation:55.5});
 const [bx0,bz0,bx1,bz1]=site.building;
 const parts=buildGrassFacets(site);
 for(const mesh of parts){
  for(let i=0;i<mesh.positions.length;i+=3){
   const x=mesh.positions[i],z=mesh.positions[i+2];
   assert.ok(x<=bx0-.20+1e-6||x>=bx1+.20-1e-6||
    z<=bz0-.20+1e-6||z>=bz1+.20-1e-6,
    'landscape mesh must leave clearance from the building walls');
  }
 }
 const inside=grassOutsideBuilding([
  [bx0+1,55.2,bz0+1],[bx0+2,55.2,bz0+1],[bx0+1,55.2,bz0+2]
 ],site.building);
 assert.equal(inside.length,0,'entirely internal turf faces are removed');
 const crossing=grassOutsideBuilding([
  [bx0-.8,55.2,bz0+1],[bx0+1,55.2,bz0+.5],[bx0+1,55.2,bz0+2]
 ],site.building);
 assert.ok(crossing.length>0,'turf can approach the exterior wall safely');
});

test('raised grass has a recessed centre filler without moving the paths or entrance',()=>{
 const site=makeSiteLayout([-14,51,-9,67,83,38],{groundElevation:55.5});
 const blocks=buildGrassBaseBlocks(site);
 const outer=blocks.filter(block=>!block.lowered);
 const centre=blocks.find(block=>block.lowered);
 assert.equal(outer.length,4,'four original raised exterior strips remain');
 assert.equal(blocks.length,5,'the missing rectangle is filled');
 assert.ok(centre,'a central recessed grass filler is present');
 const [bx0,bz0,bx1,bz1]=site.building;
 for(const block of outer){
  const [x0,z0,x1,z1]=block.footprint;
  assert.ok(x1<=bx0-.20+1e-8||x0>=bx1+.20-1e-8||
    z1<=bz0-.20+1e-8||z0>=bz1+.20-1e-8,
   'raised exterior ground must not pass under the building');
  assert.ok(Math.abs(block.position[1]+block.scale[1]/2-site.grassY)<1e-8,
   'exterior grass base stays at the approved elevation');
 }
 assert.deepEqual(centre.footprint,[bx0-.20,bz0-.20,bx1+.20,bz1+.20],
  'the filler matches the exact rectangular cutout');
 const centreTop=centre.position[1]+centre.scale[1]/2;
 assert.ok(Math.abs(centreTop-(site.grassY-.08))<1e-8,
  'central infill sits 8cm below the surrounding grass');
 assert.ok(centreTop<site.grassY&&centreTop<site.walkwayY,
  'the filler cannot overlap the raised paving');
 assert.ok(Math.abs(site.walkwayY-site.grassY-.22)<1e-8,
  'the original walkway elevation is unchanged');
 const area=blocks.reduce((sum,block)=>sum+block.scale[0]*block.scale[2],0);
 const [west,north,east,south]=site.bounds;
 assert.ok(Math.abs(area-(east-west)*(south-north))<1e-7,
  'the base now fills the entire rectangular site without gaps or overlapping footprints');
 const layer=readFileSync(new URL('../src/viewer/siteLandscapeLayer.js',import.meta.url),'utf8');
 assert.ok(layer.includes('block.lowered?turfColours[0]:grassEdge'),
  'the central filler should be green turf rather than a dark base slab');
});
