import {createExteriorLayer} from './exteriorLayer.js';
import {Viewer,XKTLoaderPlugin,NavCubePlugin,SectionPlane} from '@xeokit/xeokit-sdk';
import {FLOOR_CLIP_DIRECTIONS} from './renderSettings.js';
import {createRoomFocusLayer} from './roomFocusLayer.js';
import footprints from '../../shared/roomFootprints.json';
import {createHeatmapLayer} from './heatmapLayer.js';
import {createOccupantLayer} from './occupantLayer.js';
import points from '../../shared/sensorRegistry.json';
import {createNavigationController} from './navigationController.js';
export function createBuildingViewer({canvas,navCanvas,navigation,onSelect,onLoad,onError,onState,onPins}){
 const viewer=new Viewer({canvasId:canvas.id,transparent:true});
 viewer.camera.perspective.fov=35;
 viewer.cameraControl.navMode='orbit';viewer.cameraControl.doublePickFlyTo=false;viewer.cameraControl.smartPivot=false;viewer.cameraControl.zoomOnMouseWheel=false;
 Object.assign(viewer.scene.edgeMaterial,{edgeColor:[.23,.36,.48],edgeAlpha:.9,edgeWidth:1});
 viewer.cameraFlight.easing=true;
 Object.assign(viewer.scene.selectedMaterial,{fill:true,fillColor:[.15,.85,.95],fillAlpha:1,edges:true,edgeColor:[.45,.90,1],edgeAlpha:1,glowThrough:true});
 const planes={lower:new SectionPlane(viewer.scene,{id:'floor_lower',dir:FLOOR_CLIP_DIRECTIONS.lower,active:false}),upper:new SectionPlane(viewer.scene,{id:'floor_upper',dir:FLOOR_CLIP_DIRECTIONS.upper,active:false})};
 const occupants=createOccupantLayer(viewer.scene,navigation,footprints,points);
 const occupantTick=viewer.scene.on('tick',()=>occupants.tick(performance.now()));
 const exterior=createExteriorLayer(viewer.scene);
 const weatherTick=viewer.scene.on('tick',()=>exterior.tick(performance.now()));
 const control=createNavigationController(viewer,{navigation,planes,points,heatmap:createHeatmapLayer(viewer.scene,navigation,points),roomFocus:createRoomFocusLayer(viewer.scene,footprints),onState,onPins,reducedMotion:window.matchMedia('(prefers-reduced-motion: reduce)').matches});
 new NavCubePlugin(viewer,{canvasId:navCanvas.id,visible:true,cameraFly:true,cameraFlyDuration:.28});
 const model=new XKTLoaderPlugin(viewer).load({id:'fyp_whole_building',src:'/models/FYP_WholeBuilding_18Sensors.xkt',edges:true});
 model.on('loaded',()=>{control.load();exterior.init(viewer.scene.getAABB(Object.keys(viewer.scene.objects)));onLoad()});model.on('error',e=>onError(String(e)));
 viewer.cameraControl.on('picked',e=>{if(e.entity){const guid=e.entity.id.split(/[.#]/).pop();if(navigation.sensors.some(p=>p.guid===guid))onSelect(guid)}});
 return {...control,setOccupants:(headcounts,enabled,animate,floor)=>occupants.update({headcounts,enabled,animate,floor}),setWeather:(weather,showExterior,motion)=>exterior.set(weather,showExterior,motion),destroy(){viewer.scene.off(weatherTick);viewer.scene.off(occupantTick);occupants.destroy();exterior.destroy();control.destroy();viewer.destroy()}};
}
