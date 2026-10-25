import { useEffect, useId, useRef, useState } from 'react';
import { POINTS } from '../services/twin';
// Reuse the tested, existing Digital Twin xeokit adapter. The installer keeps
// src/xeokitViewer.js, src/data/level5Sensors.js and the original XKT files.
import { initXeokitViewer, destroyActiveViewer } from '../xeokitViewer.js';

type ViewerController = {
 selectSensor:(guid:string)=>boolean;
 configureSensors:(items:unknown[])=>{matched:number;total:number};
 resetAllCuts:()=>void;
 showWholeBuilding:()=>void;
 model?: {on?:(event:string,callback:()=>void)=>void};
};
export function XeokitViewer({selectedCode,onSensorSelect}:{selectedCode?:string;onSensorSelect:(code:string)=>void}){
 const uid=useId().replace(/:/g,'');
 const stageId='twinlabs_stage_'+uid;
 const [loaded,setLoaded]=useState(false);
 const controller=useRef<ViewerController|null>(null);
 const callback=useRef(onSensorSelect);
 callback.current=onSensorSelect;
 useEffect(()=>{
  const instance=(initXeokitViewer as any)({stageId,onSelection:(selected:{entityId?:string})=>{
   const code=POINTS.find(p=>p.guid&&(p.guid===selected.entityId||selected.entityId?.endsWith("#"+p.guid)||selected.entityId?.endsWith("."+p.guid)))?.code;
   if(code)callback.current(code);
  }}) as ViewerController|null;
  controller.current=instance;
  if(instance){
   const configure=()=>{
    instance.configureSensors(POINTS.filter(x=>x.guid).map(point=>({guid:point.guid,label:point.label,sensorId:point.code,pointCodes:[point.code],assetId:point.assetId})));
    setLoaded(true);
   };
   instance.model?.on?.('loaded',configure);
  }
  return()=>{controller.current=null;destroyActiveViewer();};
 },[stageId]);
 useEffect(()=>{
  const guid=POINTS.find(x=>x.code===selectedCode)?.guid;
  if(guid&&loaded)controller.current?.selectSensor(guid);
 },[selectedCode,loaded]);
 return <div className="xeokit-wrapper viewer-panel" aria-label="Interactive Snowdon Towers Level 5 BIM model">
  <div id={stageId} className="viewer-stage twinlabs-legacy-stage">
   <canvas data-xeokit-canvas className="xeokit-canvas"/>
   <canvas data-navcube-canvas className="twinlabs-cube"/>
   <div className="twinlabs-bim-toolbar">
    <button data-viewer-action="home" title="Fit model">Fit</button>
    <button data-viewer-action="plan" title="Plan view">Plan</button>
    <button data-viewer-action="threeD" title="3D perspective">3D</button>
    <button data-viewer-action="resetAllCuts" title="Restore complete model">Reset cuts</button>
    <label className="twin-arch-toggle"><input type="checkbox" data-architecture-toggle defaultChecked/> Architecture</label>
   </div>
   <div className="twinlabs-bim-floor" data-floor-label>Level 5</div>
   <span className="twinlabs-bim-selected" data-selected-element>—</span>
   <div data-architecture-status className="twinlabs-arch-status"/>
   <div className="viewer-loading" data-viewer-loading><div className="xeokit-feedback"><strong className="viewer-loading-title">Loading BIM model</strong><p className="viewer-loading-sub">Snowdon Towers · Level 5</p></div></div>
  </div>
 </div>;
}
