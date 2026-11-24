import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 makeSiteLayout,segmentDistance,pathDistance,buildGrassFacets,
 buildPavedPaths,buildFacetedFrustum
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
 assert.equal(parts.reduce((sum,p)=>sum+p.indices.length/3,0),19*15*2);
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
