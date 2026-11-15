import test from 'node:test';
import assert from 'node:assert/strict';
import {rainGeometry} from '../src/viewer/weatherMath.js';
import {bindViewerGestures} from '../src/viewer/viewerGestures.js';
import {layoutSensorPins} from '../src/viewer/navigationMath.js';

test('Rain remains outside the building footprint and has repeatable finite geometry',()=>{
 const bounds=[-10,0,-20,30,40,20],a=rainGeometry(bounds),b=rainGeometry(bounds);
 assert.deepEqual(a,b);
 assert.equal(a.indices.length,240);
 for(let i=0;i<a.positions.length;i+=3){
  const [x,y,z]=a.positions.slice(i,i+3);
  assert.ok([x,y,z].every(Number.isFinite));
  assert.ok(x<bounds[0]||x>bounds[3]||z<bounds[2]||z>bounds[5]);
 }
 assert.throws(()=>rainGeometry([0,0,0,0,1,1]));
});

test('Unmodified scroll passes through; explicit camera gestures do not hijack controls',()=>{
 const handlers=new Map(),wheels=[];let prevented=0;
 const element={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:()=>{}};
 const cleanup=bindViewerGestures(element,{onWheel:e=>wheels.push(e),onPinch:()=>{}});
 const event={deltaY:100,target:{closest:()=>null},preventDefault:()=>prevented++,stopPropagation:()=>{}};
 handlers.get('wheel')(event);assert.equal(prevented,0);assert.equal(wheels.length,0);
 handlers.get('wheel')({...event,metaKey:true});assert.equal(prevented,1);assert.equal(wheels[0].ctrlKey,true);
 handlers.get('wheel')({...event,ctrlKey:true,target:{closest:()=>({})}});
 assert.equal(prevented,1);assert.equal(wheels.length,1);
 cleanup();
});

test('Crowded numbered pins preserve sensor identities and finite placement',()=>{
 const points=Array.from({length:18},(_,i)=>({code:'S'+i,index:i+1,anchorX:250,anchorY:250,selected:i===7}));
 const pins=layoutSensorPins(points,600,600);
 assert.equal(pins.length,18);
 assert.equal(new Set(pins.map(p=>p.code)).size,18);
 assert.ok(pins.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 assert.equal(pins.find(p=>p.code==='S7').selected,true);
});
