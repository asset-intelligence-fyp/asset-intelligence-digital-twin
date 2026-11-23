import {METRICS} from './sensorPresentation.js';
import {trimSlabsToEnvelope,limitFloorHeatmapToBuilding} from './heatmapField.js';
import {GHOST_COLOUR,XRAY_DEFAULT,xrayStyle} from './renderSettings.js';
import {storeyFor,floorBounds,frameBounds,frameSensor,layoutSensorPins} from './navigationMath.js';

/** One owner for floor visibility, selection and camera movement. No competing React flights. */
export function createNavigationController(viewer,{navigation,planes,onState=(_state)=>{},onPins=(_pins)=>{},points=[],heatmap={update(){},destroy(){}},floorGuides={update(){},destroy(){}},roomFocus={update(){},destroy(){},bounds(){return null},status(){return 'Room boundary unavailable'}},reducedMotion=false}){
 const scene=viewer.scene;
 const state={ready:false,floor:'all',mode:'solid',view:'orbit',selectedGuid:null,moving:false,cutaway:false,opacity:XRAY_DEFAULT,roomOutline:true,roomBoundary:'',hasRoomBoundary:false,floorGuides:true,metric:'status',foundMarkers:0,objectsOnFloor:0};
 let all=[],markerIds=[],architectureIds=[],floorIndex=new Map(),guidIndex=new Map(),flight=0,destroyed=false,pinSignature='',lastPins=0,slabIds=[],architecturalColours=[],glazingIds=[],heatReadings={};
 const sensors=new Map(navigation.sensors.map(p=>[p.guid,p]));
 const levelFor=id=>navigation.levels.find(p=>p.id===id);
 const emit=()=>{if(!destroyed)onState({...state})};
 const aspect=()=>Math.max(.25,(scene.canvas.canvas.clientWidth||800)/(scene.canvas.canvas.clientHeight||600));
 const visibleIds=()=>state.floor==='all'?all:(floorIndex.get(state.floor)||[]);
 function cancelFlight(){flight++;viewer.cameraFlight.cancel();if(viewer.camera?.projection==='customProjection')viewer.camera.projection=state.view==='plan'?'ortho':'perspective';state.moving=false;}
 function fly(frame){
  if(!frame)return;cancelFlight();const token=flight;state.moving=!reducedMotion;
  viewer.cameraControl.pivotPos=frame.look;
  if(reducedMotion){viewer.cameraFlight.jumpTo(frame);emit();return;}
  emit();viewer.cameraFlight.flyTo({...frame,duration:.28},()=>{if(token===flight&&!destroyed){state.moving=false;emit()}});
 }
 function clipping(){
  const level=levelFor(state.floor);
  planes.lower.active=!!level;
  if(level)planes.lower.pos=[0,level.elevation-.25,0];
  planes.upper.active=state.cutaway;
  if(state.cutaway){const roof=navigation.levels.at(-1);planes.upper.pos=[0,level?Math.min(level.ceiling-.12,level.elevation+2.8):roof.elevation-.12,0]}
 }
 function refreshHeatmap(){heatmap.update({metric:state.metric,readings:heatReadings,floor:state.floor,enabled:state.mode==='heatmap'})}
 function appearance(){
  const ghost=state.mode!=='solid',style=xrayStyle(state.mode==='heatmap'?.12:state.opacity);
  // A controlled, unlit emphasis material prevents source lighting/materials bleaching the shell.
  Object.assign(scene.xrayMaterial,{fill:true,fillColor:style.fillColor,fillAlpha:style.alpha,edges:true,edgeColor:style.edgeColor,edgeAlpha:style.edgeAlpha,edgeWidth:1,glowThrough:false});
  scene.setObjectsOpacity(architectureIds,1);
  scene.setObjectsXRayed(architectureIds,ghost);
  scene.setObjectsXRayed(markerIds,false);
  scene.setObjectsEdges(architectureIds,ghost);
  // In Building mode IFC element types are colour-coded as architectural
  // materials: glazing, wall/façade, roof, floor and structural members.
  // No unmeasured textures or fabricated walls are introduced.
  if(!ghost){
   scene.setObjectsColorized(architectureIds,[.79,.83,.84]);
   for(const group of architecturalColours)scene.setObjectsColorized(group.ids,group.rgb);
   scene.setObjectsOpacity(glazingIds,.82);
   scene.setObjectsEdges(glazingIds,true);
  }else{
   scene.setObjectsColorized(architectureIds,null);
   // Distinct, brighter real IFC slabs read as physical floor plates, while
   // walls remain finely translucent. Never recolour synthetic heat areas.
   if(state.mode==='heatmap'){
    // The heat layer supplies the floor colour. IFC slabs must not remain
    // opaque grey/black rectangles over (or under) that colour texture.
    // Keep original geometry pickable; only its presentation is subdued.
    // Hide the underlying IFC slabs entirely while the heatmap supplies
    // floor colour. Even 6% X-ray slab opacity was rendering as visible
    // grey/white rectangles in the user's screenshots.
    scene.setObjectsVisible(slabIds,false);
    scene.setObjectsXRayed(slabIds,false);
    scene.setObjectsColorized(slabIds,null);
    scene.setObjectsEdges(slabIds,false);
   }else{
    scene.setObjectsXRayed(slabIds,false);
    scene.setObjectsOpacity(slabIds,style.floorAlpha);
    scene.setObjectsColorized(slabIds,GHOST_COLOUR);
    scene.setObjectsEdges(slabIds,true);
   }
  }
  floorGuides.update(state.mode,state.floor,state.floorGuides);
  state.roomBoundary=state.selectedGuid?roomFocus.status(state.selectedGuid):'';
  state.hasRoomBoundary=!!(state.selectedGuid&&roomFocus.bounds(state.selectedGuid));
  roomFocus.update(state.selectedGuid,ghost&&state.roomOutline);
  refreshHeatmap();
 }
 function scope(){
  scene.setObjectsVisible(all,false);scene.setObjectsVisible(visibleIds(),true);
  state.objectsOnFloor=visibleIds().length;clipping();appearance();pinSignature='';
 }
 function unselect(){if(state.selectedGuid){const id=guidIndex.get(state.selectedGuid);if(id)scene.setObjectsSelected([id],false)}state.selectedGuid=null;}
 function bounds(){const ids=visibleIds();return ids.length?floorBounds(scene.getAABB(ids),levelFor(state.floor)):null}
 function sensorFrame(sensor){const room=roomFocus.bounds(sensor.guid);return room&&state.view==='plan'?frameBounds(room,aspect(),state.view):frameSensor(sensor,aspect(),state.view)}
 function fit(){
  if(!state.ready)return;
  const b=bounds();if(!b)return;
  // Margin reveals the illustrative site, without changing BIM geometry.
  if(state.mode==='solid'&&state.floor==='all'){
   const margin=Math.max(8,Math.max(b[3]-b[0],b[5]-b[2])*.14);
   fly(frameBounds([b[0]-margin,b[1],b[2]-margin,b[3]+margin,b[4],b[5]+margin],aspect(),state.view));
  }else fly(frameBounds(b,aspect(),state.view));
 }
 function focusSensor(guid){
  const sensor=sensors.get(guid),id=guidIndex.get(guid);
  if(!sensor||!id||!state.ready)return false;
  cancelFlight();unselect();state.floor=sensor.floor;state.selectedGuid=guid;state.mode=state.mode==='heatmap'?'heatmap':'xray';if(state.mode==='heatmap')state.metric=points.find(p=>p.guid===guid)?.sensorType||state.metric;state.cutaway=true;
  scope();scene.setObjectsSelected([id],true);
  fly(sensorFrame(sensor));return true;
 }
 function showFloor(id){
  if(id!=='all'&&!levelFor(id))return false;
  if(!state.ready)return false;cancelFlight();unselect();state.floor=id;state.cutaway=id!=='all';scope();emit();fit();return true;
 }
 function home(){if(!state.ready)return;cancelFlight();unselect();state.floor='all';state.view='orbit';state.mode='solid';state.cutaway=false;scope();fit()}
 function setView(view){state.view=view==='plan'?'plan':'orbit';if(!state.ready)return;const sensor=sensors.get(state.selectedGuid);fly(sensor?sensorFrame(sensor):frameBounds(bounds(),aspect(),state.view))}
 function updatePins(now=performance.now()){
  if(!state.ready||destroyed||now-lastPins<50)return;lastPins=now;
  const canvas=scene.canvas.canvas,width=canvas.clientWidth,height=canvas.clientHeight;
  const eye=viewer.camera.eye,look=viewer.camera.look;
  const representatives=points.filter(p=>state.mode!=='heatmap'||state.metric==='status'||p.sensorType===state.metric);
  const projected=representatives.flatMap(point=>{
   const p=sensors.get(point.guid);if(!p)return [];
   if(!guidIndex.has(p.guid)||(state.floor!=='all'&&p.floor!==state.floor))return [];
   const forward=p.position.reduce((sum,v,i)=>sum+(v-eye[i])*(look[i]-eye[i]),0);
   if(forward<=0)return [];
   const pos=viewer.camera.projectWorldPos(p.position);
   return [{code:p.code,guid:p.guid,index:points.indexOf(point)+1,anchorX:pos[0],anchorY:pos[1],selected:p.guid===state.selectedGuid}];
  });
  const pins=layoutSensorPins(projected,width,height),signature=JSON.stringify(pins.map(p=>[p.code,p.x,p.y,p.selected]));
  if(signature!==pinSignature){pinSignature=signature;onPins(pins)}
 }
 const tick=scene.on('tick',()=>updatePins());
 const input=scene.input?.on('mousedown',()=>{if(state.moving){cancelFlight();emit()}});
 return {
  load(){
   all=Object.keys(scene.objects);floorIndex=new Map();guidIndex=new Map();
   for(const id of all){
    const guid=id.split(/[.#]/).pop();guidIndex.set(guid,id);
    const floor=storeyFor(viewer.metaScene.metaObjects[id],viewer.metaScene.metaObjects);
    if(floor){if(!floorIndex.has(floor))floorIndex.set(floor,[]);floorIndex.get(floor).push(id)}
   }
   markerIds=navigation.sensors.map(p=>guidIndex.get(p.guid)).filter(Boolean);const markers=new Set(markerIds);architectureIds=all.filter(id=>!markers.has(id));
   const byType=new Map();
   for(const id of architectureIds){
    const type=viewer.metaScene.metaObjects[id]?.type||'';
    let group='other';
    if(/IfcWindow|IfcCurtainWall|IfcPlate/.test(type))group='glazing';
    else if(/IfcRoof|IfcCovering/.test(type))group='roof';
    else if(/IfcSlab/.test(type))group='floor';
    else if(/IfcDoor/.test(type))group='door';
    else if(/IfcColumn|IfcBeam|IfcMember/.test(type))group='structure';
    else if(/IfcWall/.test(type))group='wall';
    if(!byType.has(group))byType.set(group,[]);
    byType.get(group).push(id);
   }
   slabIds=byType.get('floor')||[];
   glazingIds=byType.get('glazing')||[];
   // Build colour planes from actual IFC slab coverage for each storey.
   // For a storey without exported slab meshes, use its model AABB
   // instead of rendering a tiny circular sensor vicinity.
   const floorSurfaces=navigation.levels.filter(l=>/^Level_0[1-5]$/.test(l.id)).map(level=>{
    const ids=floorIndex.get(level.id)||[];
    const slabs=ids.filter(id=>/IfcSlab/.test(viewer.metaScene.metaObjects[id]?.type||''))
     .map(id=>Array.from(scene.objects[id]?.aabb||[]))
     .filter(box=>box.length===6&&box.every(Number.isFinite)&&box[3]-box[0]>.35&&box[5]-box[2]>.35);
    const buildingEnvelope=ids.filter(id=>/IfcWall|IfcWindow|IfcCurtainWall|IfcColumn|IfcBeam|IfcDoor/.test(viewer.metaScene.metaObjects[id]?.type||''))
     .map(id=>Array.from(scene.objects[id]?.aabb||[]))
     .filter(box=>box.length===6&&box.every(Number.isFinite)&&box[3]>box[0]&&box[5]>box[2]);
    const monitoredSpaces=Object.fromEntries(navigation.sensors.filter(sensor=>{
     const b=sensor.roomAabb;return Array.isArray(b)&&b.length===6&&b.every(Number.isFinite);
    }).map(sensor=>{
     const b=sensor.roomAabb;
     return [sensor.guid,{positions:[b[0],b[1],b[2],b[3],b[4],b[5]]}];
    }));
    const clipped=limitFloorHeatmapToBuilding(trimSlabsToEnvelope(slabs,buildingEnvelope,1.1),monitoredSpaces);
    if(clipped.length)return {floor:level.id,elevation:level.elevation,aabbs:clipped,source:'clipped-ifc-slab'};
    if(!ids.length)return {floor:level.id,elevation:level.elevation,aabbs:[],source:'no-model-geometry'};
    const fallback=buildingEnvelope.length?Array.from(scene.getAABB(ids.filter(id=>/IfcWall|IfcWindow|IfcCurtainWall|IfcColumn|IfcBeam|IfcDoor/.test(viewer.metaScene.metaObjects[id]?.type||'')))):Array.from(scene.getAABB(ids));
    return {floor:level.id,elevation:level.elevation,aabbs:[fallback],source:'storey-architecture-bounds'};
   });
   heatmap.setFloorSurfaces?.(floorSurfaces);
   const palette={wall:[.79,.84,.87],glazing:[.41,.65,.74],roof:[.42,.51,.58],floor:[.69,.72,.72],door:[.55,.63,.62],structure:[.69,.76,.80]};
   architecturalColours=Object.entries(palette).map(([type,rgb])=>({ids:byType.get(type)||[],rgb})).filter(group=>group.ids.length);
   scene.setObjectsColorized(markerIds,[.15,.85,.95]);state.foundMarkers=markerIds.length;state.ready=true;scope();fit();emit();
  },focusSensor,showFloor,home,fit,setView,
  setMode(mode){
   const next=['xray','heatmap'].includes(mode)?mode:'solid';
   // Keep the user's existing floor selection. Heatmap supports all floors
   // concurrently; never redirect whole-building mode to a single storey.
   state.mode=next;pinSignature='';scope();emit();if(next==='heatmap')fit();
  },
  setCutaway(value){state.cutaway=!!value;clipping();emit()},
  setOpacity(value){state.opacity=xrayStyle(value).alpha;appearance();emit()},
  setRoomOutline(value){state.roomOutline=!!value;appearance();emit()},
  setFloorGuides(value){state.floorGuides=!!value;floorGuides.update(state.mode,state.floor,state.floorGuides);emit()},
  setHeatmap(metric,readings){const changed=metric!==state.metric;state.metric=METRICS[metric]?metric:'temperature';heatReadings=readings||{};if(changed){unselect();pinSignature='';appearance();emit()}else refreshHeatmap()},
  interact(){cancelFlight();emit()},
  zoom(factor){if(!state.ready||!Number.isFinite(factor))return;cancelFlight();const camera=viewer.camera;factor=Math.max(.7,Math.min(1.4,factor));if(state.view==='plan'){camera.ortho.scale=Math.max(2,Math.min(1500,camera.ortho.scale*factor))}else{const delta=Array.from(camera.eye,(v,i)=>v-camera.look[i]),distance=Math.hypot(...delta),target=Math.max(2,Math.min(1500,distance*factor));if(distance>0)camera.eye=Array.from(camera.look,(v,i)=>v+delta[i]*target/distance)}emit()},
  wheel(event){
   if(!state.ready)return;
   const scale=event.deltaMode===1?16:event.deltaMode===2?400:1,dx=event.deltaX*scale,dy=event.deltaY*scale;
   if(event.shiftKey||Math.abs(dx)>Math.abs(dy)*1.5){
    cancelFlight();const camera=viewer.camera,distance=state.view==='plan'?camera.ortho.scale:Math.hypot(...Array.from(camera.eye,(v,i)=>v-camera.look[i]));
    camera.pan([-dx*distance/900,dy*distance/900,0]);emit();
   }else{
    this.zoom(Math.exp(Math.max(-.3,Math.min(.3,dy*(event.ctrlKey ? .012 : .003)))));
   }
  },
  snapshot:()=>({...state}),
  floorObjectCount:id=>id==='all'?all.length:(floorIndex.get(id)||[]).length,
  destroy(){destroyed=true;cancelFlight();heatmap.destroy();roomFocus.destroy();scene.off(tick);if(input)scene.input.off(input);onPins([])},
 };
}
