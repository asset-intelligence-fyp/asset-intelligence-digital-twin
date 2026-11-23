import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {math as xeokitMath} from '../node_modules/@xeokit/xeokit-sdk/src/viewer/scene/math/math.js';
import {createNavigationController} from '../src/viewer/navigationController.js';
import {xrayStyle} from '../src/viewer/renderSettings.js';
import {FLOOR_CLIP_DIRECTIONS} from '../src/viewer/renderSettings.js';
import {sensorDisplay,roomRepresentatives,sensorTitle} from '../src/viewer/sensorPresentation.js';
import {sensorHealth} from '../src/viewer/sensorHealth.js';
import {bindViewerGestures} from '../src/viewer/viewerGestures.js';
import {storeyFor,frameBounds,frameSensor,layoutPins} from '../src/viewer/navigationMath.js';
const navigation=JSON.parse(fs.readFileSync('shared/modelNavigation.json','utf8'));
const registry=JSON.parse(fs.readFileSync('shared/sensorRegistry.json','utf8'));
const frames=new Map();let nextFrame=1;
globalThis.requestAnimationFrame=fn=>{const id=nextFrame++;frames.set(id,fn);return id};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function fixture(reducedMotion=false,roomFocus){
 const objects={},metaObjects={},flightCalls=[],callbacks=[],updates=[],heatUpdates=[];
 const camera={eye:[100,90,100],look:[50,65,20],projection:'perspective',ortho:{scale:100},panDelta:null,pan(delta){this.panDelta=delta}};
 const levels=navigation.levels;
 for(const level of levels){
  metaObjects[level.id]={id:level.id,name:level.id,type:'IfcBuildingStorey'};
  const id='building#shell_'+level.id;objects[id]={aabb:[0,level.elevation,0,100,level.ceiling,40],visible:true};
  const room='room_'+level.id;metaObjects[room]={id:room,type:'IfcSpace',parent:level.id};metaObjects[id]={id,type:'IfcWall',parent:room};const slab='building#slab_'+level.id;objects[slab]={aabb:[0,level.elevation,0,100,level.elevation+.2,40],visible:true};metaObjects[slab]={id:slab,type:'IfcSlab',parent:room};
 }
 for(const sensor of navigation.sensors){const id='building#'+sensor.guid;objects[id]={aabb:sensor.aabb,visible:true};metaObjects[id]={id,type:'IfcBuildingElementProxy',parent:'room_'+sensor.floor}}
 const set=(ids,key,value)=>ids.forEach(id=>{objects[id][key]=value});
 const scene={objects,canvas:{canvas:{clientWidth:600,clientHeight:500}},xrayMaterial:{fillAlpha:.3},
  setObjectsEdges:(ids,v)=>set(ids,'edges',v),setObjectsOpacity:(ids,v)=>set(ids,'opacity',v),setObjectsVisible:(ids,v)=>set(ids,'visible',v),setObjectsXRayed:(ids,v)=>set(ids,'xrayed',v),setObjectsSelected:(ids,v)=>set(ids,'selected',v),setObjectsColorized:(ids,v)=>set(ids,'colour',v),
  getAABB:ids=>[Math.min(...ids.map(id=>objects[id].aabb[0])),Math.min(...ids.map(id=>objects[id].aabb[1])),Math.min(...ids.map(id=>objects[id].aabb[2])),Math.max(...ids.map(id=>objects[id].aabb[3])),Math.max(...ids.map(id=>objects[id].aabb[4])),Math.max(...ids.map(id=>objects[id].aabb[5]))],
  on:()=>1,off:()=>{},input:{on:()=>2,off:()=>{}}};
 const viewer={scene,camera,metaScene:{metaObjects},cameraControl:{pivotPos:[]},cameraFlight:{cancel(){},jumpTo(frame){flightCalls.push(frame)},flyTo(frame,cb){flightCalls.push(frame);callbacks.push(cb)}}};
 const planes={lower:{active:false,pos:[],dir:FLOOR_CLIP_DIRECTIONS.lower},upper:{active:false,pos:[],dir:FLOOR_CLIP_DIRECTIONS.upper}};
 const controller=createNavigationController(viewer,{navigation,planes,points:registry,roomFocus,heatmap:{update:s=>heatUpdates.push(s),destroy(){}},onState:s=>updates.push(s),reducedMotion});controller.load();if(callbacks.length)callbacks.shift()();flightCalls.length=0;
 return {controller,objects,scene,planes,flightCalls,callbacks,updates,camera,heatUpdates};
}
test('All 18 navigation anchors use actual IFC floors, with elevations enclosing the markers',()=>{
 assert.equal(navigation.levels.length,9);assert.equal(navigation.sensors.length,18);
 for(const p of registry){const anchor=navigation.sensors.find(s=>s.guid===p.guid),level=navigation.levels.find(l=>l.id===p.floor);assert.equal(anchor.code,p.code);assert.equal(anchor.floor,p.floor);assert.ok(anchor.position[1]>level.elevation&&anchor.position[1]<level.ceiling);}
});
test('Floor ancestry follows IfcSpace parents and terminates safely on broken cycles',()=>{
 const floor={id:'ifc-floor',name:'Level_04',type:'IfcBuildingStorey'},room={id:'room',type:'IfcSpace',parent:'ifc-floor'},marker={id:'sensor',parent:room};
 assert.equal(storeyFor(marker,{'ifc-floor':floor}), 'Level_04');
 assert.equal(storeyFor({id:'a',parent:'b'},{b:{id:'b',parent:'a'},a:{id:'a',parent:'b'}}),null);
});
test('Sensor selection reveals its native floor and issues exactly one camera flight',()=>{
 const f=fixture(),sensor=navigation.sensors.find(p=>p.floor==='Level_04');assert.equal(f.controller.focusSensor(sensor.guid),true);
 assert.equal(f.flightCalls.length,1);assert.ok(f.flightCalls[0].look.every((v,i)=>Math.abs(v-sensor.position[i])<1e-8));
 assert.equal(f.controller.snapshot().floor,'Level_04');assert.equal(f.controller.snapshot().mode,'xray');
 assert.equal(f.objects['building#shell_Level_02'].visible,false);assert.equal(f.objects['building#shell_Level_04'].visible,true);assert.equal(f.objects['building#shell_Level_04'].xrayed,true);assert.equal(f.objects['building#shell_Level_04'].edges,true);
 assert.equal(f.objects['building#'+sensor.guid].xrayed,false);assert.equal(f.objects['building#'+sensor.guid].selected,true);
 assert.ok(f.objects['building#slab_Level_04'].opacity<.35,'Subdue slabs so they do not blanket the room');assert.equal(f.objects['building#shell_Level_04'].colour,null,'Use the controlled X-ray material, independent of source colours');
 assert.equal(f.planes.lower.pos[1],67.6-.25);assert.ok(f.planes.upper.pos[1]>sensor.position[1]);f.controller.destroy();
});
test('Rapid cross-floor selections cancel old arrivals without overriding the newest selection',()=>{
 const f=fixture(),first=navigation.sensors[0],last=navigation.sensors.at(-1);
 f.controller.focusSensor(first.guid);f.controller.focusSensor(last.guid);
 assert.equal(f.flightCalls.length,2);f.callbacks[0]();assert.equal(f.controller.snapshot().moving,true);assert.equal(f.controller.snapshot().selectedGuid,last.guid);
 f.callbacks[1]();assert.equal(f.controller.snapshot().moving,false);assert.equal(f.controller.snapshot().floor,'Level_05');f.controller.destroy();
});
test('Manual floor navigation clears sensor focus; home restores the whole solid building',()=>{
 const f=fixture();f.controller.focusSensor(navigation.sensors[0].guid);f.controller.showFloor('Level_03');assert.equal(f.controller.snapshot().selectedGuid,null);assert.equal(f.controller.snapshot().floor,'Level_03');
 f.controller.setView('plan');assert.equal(f.flightCalls.at(-1).projection,'ortho');assert.deepEqual(f.flightCalls.at(-1).up,[0,0,-1]);
 f.controller.home();assert.equal(f.controller.snapshot().floor,'all');assert.equal(f.controller.snapshot().mode,'solid');assert.equal(f.planes.lower.active,false);assert.equal(f.planes.upper.active,false);assert.ok(Object.values(f.objects).every(o=>o.visible));f.controller.destroy();
});
test('Unknown marker and floor requests leave the current view unchanged',()=>{
 const f=fixture(),before=f.controller.snapshot();assert.equal(f.controller.focusSensor('missing'),false);assert.equal(f.controller.showFloor('Level_99'),false);assert.deepEqual(f.controller.snapshot(),before);assert.equal(f.flightCalls.length,0);f.controller.destroy();
});
test('Plan framing fits narrow canvases and sensor framing stays centred on the sensor',()=>{
 const wide=frameBounds([0,60,-40,100,64,0],2,'plan'),narrow=frameBounds([0,60,-40,100,64,0],.5,'plan');assert.ok(narrow.orthoScale>wide.orthoScale);assert.equal(narrow.eye[0],narrow.look[0]);assert.equal(narrow.eye[2],narrow.look[2]);
 for(const p of navigation.sensors){const frame=frameSensor(p,.5);assert.ok(frame.look.every((v,i)=>Math.abs(v-p.position[i])<1e-8));assert.ok(frame.eye.every(Number.isFinite));}
});
test('Room labels replace 18 numbered navigation pins with five named locations',()=>{
 const rooms=roomRepresentatives(registry,'temperature',registry[1].guid);assert.equal(rooms.length,5);assert.equal(rooms[0].code,registry[1].code);assert.match(sensorTitle(rooms[0]),/Open office.*Humidity/);
 const points=rooms.map((p,i)=>({index:i+1,anchorX:450,anchorY:300,selected:i===4})),pins=layoutPins(points,900,650);assert.equal(pins.length,5);
 for(let i=0;i<pins.length;i++)for(let j=0;j<i;j++)assert.ok(Math.abs(pins[i].x-pins[j].x)>=pins[i].width+7||Math.abs(pins[i].y-pins[j].y)>=53);
});

test('Reduced-motion preference keeps floor reveal and selection without animated flights',()=>{
 const f=fixture(true);f.controller.focusSensor(navigation.sensors.at(-1).guid);assert.equal(f.callbacks.length,0);assert.equal(f.controller.snapshot().moving,false);assert.equal(f.controller.snapshot().floor,'Level_05');assert.equal(f.flightCalls.length,1);f.controller.destroy();
});

test('Installed renderer clipping convention keeps every sensor, while rejecting above and below its floor',()=>{
 const renderer=fs.readFileSync('node_modules/@xeokit/xeokit-sdk/src/viewer/scene/webgl/WebGLRenderer.js','utf8');assert.match(renderer,/clamp\(dot\(-/);
 const distance=(plane,p)=>Math.max(0,plane.dir.reduce((sum,d,i)=>sum-d*(p[i]-plane.pos[i]),0));
 const f=fixture(true);
 for(const sensor of navigation.sensors){f.controller.focusSensor(sensor.guid);for(const plane of [f.planes.lower,f.planes.upper]){const constant=-plane.dir.reduce((sum,d,i)=>sum+d*plane.pos[i],0);assert.ok(xeokitMath.planeAABB3Intersect(plane.dir,constant,sensor.aabb)>=0,sensor.code+' culled by CPU layer test')}assert.equal(distance(f.planes.lower,sensor.position),0,sensor.code+' removed by lower clip');assert.equal(distance(f.planes.upper,sensor.position),0,sensor.code+' removed by upper clip');
  assert.ok(distance(f.planes.lower,[sensor.position[0],f.planes.lower.pos[1]-1,sensor.position[2]])>0);assert.ok(distance(f.planes.upper,[sensor.position[0],f.planes.upper.pos[1]+1,sensor.position[2]])>0);
 }f.controller.destroy();
});
test('Trackpad wheel and pinch are captured non-passively inside the viewer and cleaned up',()=>{
 const handlers=new Map(),removed=[],wheels=[],pinches=[];const element={addEventListener(type,fn,options){assert.equal(options.passive,false);assert.equal(options.capture,true);handlers.set(type,fn)},removeEventListener(type){removed.push(type)}};
 const unbind=bindViewerGestures(element,{onWheel:e=>wheels.push(e),onPinch:r=>pinches.push(r)});
 let prevented=0,stopped=0;const event={deltaX:0,deltaY:20,ctrlKey:true,preventDefault(){prevented++},stopPropagation(){stopped++},target:{closest:()=>null}};
 handlers.get('wheel')(event);assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(wheels[0].ctrlKey,true);
 handlers.get('gesturestart')(event);handlers.get('gesturechange')({...event,scale:2});assert.equal(pinches[0],.5);
 handlers.get('wheel')({...event,target:{closest:()=>({})}});assert.equal(wheels.length,1,'A select or slider should not move the camera');
 unbind();assert.equal(removed.length,4);
});
test('Zoom changes perspective distance or plan scale, and shifted scrolling pans the camera',()=>{
 const f=fixture(true),distance=()=>Math.hypot(...f.camera.eye.map((v,i)=>v-f.camera.look[i]));const initial=distance();
 f.controller.wheel({deltaX:0,deltaY:-20,deltaMode:0,ctrlKey:true,shiftKey:false});assert.ok(distance()<initial);
 f.controller.setView('plan');const before=f.camera.ortho.scale;f.controller.zoom(.8);assert.ok(f.camera.ortho.scale<before);
 f.controller.wheel({deltaX:5,deltaY:10,deltaMode:0,ctrlKey:false,shiftKey:true});assert.ok(f.camera.panDelta);f.controller.destroy();
});
test('Sensor colours follow actual values, preserve no-data states, and distinguish occupancy from faults',()=>{
 const temp=registry.find(p=>p.sensorType==='temperature'),occupancy=registry.find(p=>p.sensorType==='occupancy'),leak=registry.find(p=>p.sensorType==='water_leakage');
 assert.notEqual(sensorDisplay(temp,{value:20}).colour,sensorDisplay(temp,{value:30}).colour);assert.equal(sensorDisplay(temp).available,false);assert.equal(sensorDisplay(temp,{value:NaN}).value,'No reading');
 assert.equal(sensorDisplay(occupancy,{value:0}).value,'Vacant');assert.equal(sensorDisplay(occupancy,{value:1}).status,'Occupied');assert.equal(sensorDisplay(leak,{value:0}).value,'Dry');assert.equal(sensorDisplay(leak,{value:1}).value,'Leak detected');
 const f=fixture(true),readings={[temp.code]:{value:28}};f.controller.setHeatmap('temperature',readings);f.controller.setMode('heatmap');assert.equal(f.heatUpdates.at(-1).enabled,true);assert.equal(f.heatUpdates.at(-1).readings[temp.code].value,28);f.controller.showFloor('Level_04');assert.equal(f.heatUpdates.at(-1).floor,'Level_04');f.controller.setMode('solid');assert.equal(f.heatUpdates.at(-1).enabled,false);f.controller.destroy();
});

test('X-ray wall slider changes emphasis shading across the full range without an opaque slab blanket',()=>{
 const f=fixture();f.controller.setMode('xray');
 f.controller.setOpacity(.08);const faint=f.scene.xrayMaterial.fillAlpha;
 const floor=f.objects['building#slab_Level_04'].opacity;
 f.controller.setOpacity(.85);
 assert.ok(f.scene.xrayMaterial.fillAlpha-faint>.7,'The slider must change actual rendered fill alpha');
 assert.ok(f.objects['building#slab_Level_04'].opacity>floor);
 assert.ok(f.objects['building#slab_Level_04'].opacity<.4);
 assert.equal(f.scene.xrayMaterial.edges,true);
 assert.ok(f.scene.xrayMaterial.fillColor.every(v=>v<.4),'Avoid pale / white emphasis fills');
 f.controller.setOpacity(999);assert.equal(f.controller.snapshot().opacity,.85);
 f.controller.setOpacity(-1);assert.equal(f.controller.snapshot().opacity,.08);
 f.controller.setMode('solid');
 assert.equal(f.objects['building#shell_Level_04'].xrayed,false);
 assert.equal(f.objects['building#slab_Level_04'].opacity,1);
 // Solid mode intentionally restores the new neutral architectural floor palette.
 assert.deepEqual(f.objects['building#slab_Level_04'].colour,[.69,.72,.72]);
 f.controller.destroy();
});

test('Selected room outline follows selection, frames the room plan and clears on floor / metric changes',()=>{
 const updates=[],bounds=[10,60,-40,34,63,-20];let destroyed=false;
 const layer={bounds:()=>bounds,status:()=> 'IFC spatial containment',update:(guid,enabled)=>updates.push({guid,enabled}),destroy:()=>{destroyed=true}};
 const f=fixture(false,layer),sensor=navigation.sensors[0];
 f.controller.focusSensor(sensor.guid);
 assert.deepEqual(updates.at(-1),{guid:sensor.guid,enabled:true});
 assert.equal(f.controller.snapshot().hasRoomBoundary,true);
 f.controller.setView('plan');
 assert.deepEqual(f.flightCalls.at(-1).look,[22,61.5,-30]);
 assert.equal(f.flightCalls.at(-1).projection,'ortho');
 f.controller.setRoomOutline(false);assert.equal(updates.at(-1).enabled,false);
 f.controller.setRoomOutline(true);f.controller.setHeatmap('co2',{});
 assert.equal(updates.at(-1).guid,null,'Changing the metric must remove the previous room outline');
 f.controller.focusSensor(sensor.guid);f.controller.showFloor('Level_04');
 assert.equal(updates.at(-1).guid,null);
 f.controller.destroy();assert.equal(destroyed,true);
});

test('IFC footprint meshes contain valid triangles and perimeter edges, with missing rooms explicit',()=>{
 const data=JSON.parse(fs.readFileSync('shared/roomFootprints.json','utf8'));
 assert.equal(Object.keys(data.sensors).length,18);
 for(const room of Object.values(data.rooms)){
  assert.ok(room.positions.length>=9&&room.positions.length%3===0);
  assert.ok(room.indices.length>=3&&room.indices.length%3===0);
  assert.ok(room.positions.every(Number.isFinite));
  const counts=new Map();
  for(let i=0;i<room.indices.length;i+=3){
   const [a,b,c]=room.indices.slice(i,i+3);
   for(const n of [a,b,c])assert.ok(n>=0&&n<room.positions.length/3);
   for(const edge of [[a,b],[b,c],[c,a]]){const key=edge.sort((a,b)=>a-b).join(',');counts.set(key,(counts.get(key)||0)+1)}
  }
  const actual=[...counts].filter(([,count])=>count===1).map(([edge])=>edge).sort();
  assert.deepEqual(room.boundary.map(edge=>[...edge].sort((a,b)=>a-b).join(',')).sort(),actual,'Do not outline triangle diagonals');
 }
 const temp=registry.find(p=>p.code==='TEMP-L03-MEET-01');
 assert.equal(data.sensors[temp.guid].roomGuid,null,'Do not fabricate a room footprint for the uncontained meeting temperature marker');
 for(const point of registry){const link=data.sensors[point.guid];assert.ok(link);if(link.roomGuid)assert.ok(data.rooms[link.roomGuid]);}
});

test('BIM dots reflect active abnormal conditions, not acknowledgements or manual test records',()=>{
 const definitions=JSON.parse(fs.readFileSync('shared/sensorDefinitions.json','utf8'));
 const humidity=registry.find(p=>p.sensorType==='humidity');
 const leak=registry.find(p=>p.sensorType==='water_leakage');
 const co2=registry.find(p=>p.sensorType==='co2');
 const normal=(value)=>({value,quality:'simulated'});
 assert.equal(sensorHealth(humidity,normal(55),[],definitions),'normal');
 assert.equal(sensorHealth(humidity,normal(78),[],definitions),'abnormal');
 assert.equal(sensorHealth(co2,normal(1250),[],definitions),'abnormal');
 assert.equal(sensorHealth(leak,normal(1),[],definitions),'abnormal');
 assert.equal(sensorHealth(leak,normal(0),[],definitions),'normal');
 assert.equal(sensorHealth(humidity,null,[],definitions),'unavailable');
 assert.equal(sensorHealth(humidity,normal(55),[],definitions,'stale'),'unavailable');
 const acknowledged={point_code:humidity.code,automatic:true,synthetic:true,acknowledged:true,resolved_at:null};
 assert.equal(sensorHealth(humidity,normal(55),[acknowledged],definitions),'abnormal','acknowledgement must not indicate recovery');
 assert.equal(sensorHealth(humidity,normal(55),[{...acknowledged,resolved_at:'2026-11-23T10:00:00Z'}],definitions),'normal');
 assert.equal(sensorHealth(humidity,normal(55),[{point_code:humidity.code,synthetic:true,automatic:false,resolved_at:null}],definitions),'normal','manual test records must not trigger BIM health');
 assert.equal(sensorHealth(humidity,{value:null,quality:'missing'},[{...acknowledged,rule:'missing'}],definitions),'abnormal','unresolved missing-reading alerts stay visible');
});

test('Heatmap preserves whole-building and floor selection instead of forcing a floor',()=>{
 const f=fixture(true);
 assert.equal(f.controller.snapshot().floor,'all');
 assert.equal(f.controller.snapshot().metric,'status');
 f.controller.setMode('heatmap');
 assert.equal(f.controller.snapshot().floor,'all','whole-building heatmap must show sampled levels concurrently');
 assert.equal(f.controller.snapshot().view,'orbit','do not overwrite the user camera');
 assert.equal(f.heatUpdates.at(-1).floor,'all');
 assert.equal(f.heatUpdates.at(-1).enabled,true);
 f.controller.showFloor('Level_04');
 assert.equal(f.controller.snapshot().floor,'Level_04');
 assert.equal(f.heatUpdates.at(-1).floor,'Level_04');
 f.controller.setHeatmap('humidity',{});
 assert.equal(f.controller.snapshot().floor,'Level_04');
 assert.equal(f.heatUpdates.at(-1).metric,'humidity');
 f.controller.setMode('solid');
 assert.equal(f.heatUpdates.at(-1).enabled,false);
 f.controller.setMode('heatmap');
 assert.equal(f.controller.snapshot().floor,'Level_04','switching back does not reset floor');
 f.controller.showFloor('all');
 assert.equal(f.heatUpdates.at(-1).floor,'all');
 f.controller.destroy();
});
