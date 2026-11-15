import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {ArrowLeft,ArrowRight,Box,Eye,Home,Layers,LocateFixed,Scan,Map,Plus,Minus,Palette} from 'lucide-react';
import {POINTS,useTwin} from '../services/twin';
import navigation from '../../shared/modelNavigation.json';
import {createBuildingViewer} from './wholeBuildingViewer.js';
import {ValueMotion} from '../components/ValueMotion';
import {XRAY_DEFAULT,XRAY_MIN,XRAY_MAX} from './renderSettings.js';
import {bindViewerGestures} from './viewerGestures.js';
import {METRICS,sensorDisplay,roomTitle,sensorTitle} from './sensorPresentation.js';
import {sensorActivity,ACTIVITY_LABELS} from './sensorActivity.js';
import './sensorActivity.css';
type Pin={code:string;guid:string;index:number;anchorX:number;anchorY:number;x:number;y:number;width:number;selected:boolean};
type ViewState={ready:boolean;floor:string;mode:string;view:string;selectedGuid:string|null;moving:boolean;cutaway:boolean;opacity:number;roomOutline:boolean;roomBoundary:string;hasRoomBoundary:boolean;metric:string;foundMarkers:number;objectsOnFloor:number};
const initial:ViewState={ready:false,floor:'all',mode:'solid',view:'orbit',selectedGuid:null,moving:false,cutaway:false,opacity:XRAY_DEFAULT,roomOutline:true,roomBoundary:'',hasRoomBoundary:false,metric:'temperature',foundMarkers:0,objectsOnFloor:0};
const floorLabel=(id:string)=>navigation.levels.find(l=>l.id===id)?.label||'Whole building';
export function XeokitViewer({selectedCode,focusRequest=0,onSensorSelect,onFloorChange}:{selectedCode?:string;focusRequest?:number;onSensorSelect:(code:string)=>void;onFloorChange?:(floor:string)=>void}){
 const uid=useId().replace(/:/g,'');const canvas=useRef<HTMLCanvasElement>(null),nav=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null);
 const controller=useRef<ReturnType<typeof createBuildingViewer>|null>(null),callback=useRef(onSensorSelect);callback.current=onSensorSelect;
 const {readings,weather,weatherMotion,replayTime,demo}=useTwin();
 const [activityTime,setActivityTime]=useState(Date.now),[sensorMotion,setSensorMotion]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const timer=setInterval(()=>setActivityTime(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const activity=(code:string)=>sensorActivity(readings[code],{now:Math.max(activityTime,Date.now()),historical:replayTime!==null||demo});
 const [view,setView]=useState<ViewState>(initial),[pins,setPins]=useState<Pin[]>([]),[error,setError]=useState(''),[showLabels,setShowLabels]=useState(true);
 useEffect(()=>{
  if(!canvas.current||!nav.current)return;
  if(!canvas.current.getContext('webgl2')){setError('3D viewing needs WebGL 2. Enable browser graphics acceleration. Sensor readings remain available.');return;}
  let active=true;
  try{
   const c=createBuildingViewer({canvas:canvas.current,navCanvas:nav.current,navigation,onSelect:(guid:string)=>{const p=POINTS.find(p=>p.guid===guid);if(p)callback.current(p.code)},onLoad:()=>{},onError:(e:string)=>{if(active)setError(e)},onState:(state:ViewState)=>{if(active)setView(state)},onPins:(value:Pin[])=>{if(active)setPins(value)}});
   controller.current=c;return()=>{active=false;controller.current=null;c.destroy()};
  }catch(e){setError(e instanceof Error?e.message:String(e));}
 },[]);
 useEffect(()=>{
  if(!view.ready||focusRequest===0)return;const p=POINTS.find(p=>p.code===selectedCode);
  if(p){if(controller.current?.focusSensor(p.guid))setError('');else setError('This sensor marker was not found in the model.');}
 },[selectedCode,focusRequest,view.ready]);
 useEffect(()=>{if(view.ready)controller.current?.setHeatmap(view.metric,readings)},[view.ready,view.metric,readings]);
 useEffect(()=>{
  if(!view.ready||!stage.current)return;
  return bindViewerGestures(stage.current,{onWheel:(event:any)=>controller.current?.wheel(event),onPinch:(factor:number)=>controller.current?.zoom(factor),onInteract:()=>controller.current?.interact()});
 },[view.ready]);
 useEffect(()=>{if(view.ready)controller.current?.setWeather(weather,view.floor==='all',weatherMotion)},[weather,weatherMotion,view.ready,view.floor]);
 const metric=view.metric;
 const selected=POINTS.find(p=>p.guid===view.selectedGuid),selectedDisplay=selected?sensorDisplay(selected,readings[selected.code]):null;
 const scoped=POINTS.filter(p=>view.floor==='all'||p.floor===view.floor),colourPoints=scoped.filter(p=>p.sensorType===metric);
 const chooseFloor=(floor:string)=>{if(controller.current?.showFloor(floor))onFloorChange?.(floor)};
 const home=()=>{controller.current?.home();onFloorChange?.('all')};
 const step=(direction:number)=>{if(!scoped.length)return;const index=scoped.findIndex(p=>p.guid===view.selectedGuid),next=index<0?(direction>0?0:scoped.length-1):(index+direction+scoped.length)%scoped.length;onSensorSelect(scoped[next].code)};
 const metricInfo=METRICS[metric as keyof typeof METRICS];
 return <div className="xeokit-wrapper viewer-panel" aria-label="FYP whole building IFC model"><div ref={stage} className={`viewer-stage twinlabs-legacy-stage navigation-stage clarity-stage scene-${weather}`} data-weather={weather} tabIndex={0} aria-label="Interactive building viewer" onPointerDown={e=>{if(e.target===canvas.current)stage.current?.focus({preventScroll:true})}}>
  <canvas ref={canvas} id={'bim_'+uid} className="xeokit-canvas"/><canvas ref={nav} id={'nav_'+uid} className="twinlabs-cube"/>
  <div className="bim-view-controls"><label className="bim-floor-select"><Layers size={14}/><select aria-label="Choose floor" disabled={!view.ready} value={view.floor} onChange={e=>chooseFloor(e.target.value)}><option value="all">Whole building</option>{navigation.levels.map(f=>{const empty=view.ready&&controller.current?.floorObjectCount(f.id)===0;return <option key={f.id} value={f.id} disabled={empty}>{f.label}{empty?' · no model objects':''}</option>})}</select></label>
   <div className="bim-render-modes" aria-label="Building display"><button aria-pressed={view.mode==='solid'} disabled={!view.ready} onClick={()=>controller.current?.setMode('solid')}><Box size={13}/>Building</button><button aria-pressed={view.mode==='xray'} disabled={!view.ready} onClick={()=>controller.current?.setMode('xray')}><Eye size={13}/>X-ray</button><button aria-pressed={view.mode==='heatmap'} disabled={!view.ready} onClick={()=>controller.current?.setMode('heatmap')}><Palette size={13}/>Heatmap</button></div>
  </div>
  {view.ready&&<div className="bim-secondary-controls"><label><input type="checkbox" checked={view.cutaway} onChange={e=>controller.current?.setCutaway(e.target.checked)}/>{view.floor==='all'?'Hide roof':'Open ceilings'}</label><label><input type="checkbox" checked={showLabels} onChange={e=>setShowLabels(e.target.checked)}/>Sensor markers</label><label className="sensor-motion-toggle"><input type="checkbox" checked={sensorMotion} onChange={e=>setSensorMotion(e.target.checked)}/>Pulse sensors</label><span className="sensor-activity-key">Pulse = recent simulated data</span>{view.mode!=='solid'&&<label className="bim-opacity">Wall shading<input type="range" aria-label="Wall shading" min={XRAY_MIN} max={XRAY_MAX} step="0.01" value={view.opacity} onChange={e=>controller.current?.setOpacity(Number(e.target.value))}/><output>{Math.round(view.opacity*100)}%</output></label>}{view.mode!=='solid'&&selected&&<label title={view.roomBoundary}><input type="checkbox" checked={view.roomOutline} disabled={!view.hasRoomBoundary} onChange={e=>controller.current?.setRoomOutline(e.target.checked)}/>IFC room outline</label>}</div>}
  {view.mode==='heatmap' &&<div className="bim-colour-key"><label>Colour by<select aria-label="Colour sensors by" value={metric} onChange={e=>controller.current?.setHeatmap(e.target.value,readings)}>{Object.entries(METRICS).map(([id,m])=><option value={id} key={id}>{m.label}</option>)}</select></label><div className={`bim-colour-scale ${metric==='water_leakage'?'bim-colour-leak':metric==='occupancy'?'bim-colour-binary':''}`}/><span>{metricInfo.legend}</span><small>{colourPoints.length?`${colourPoints.length} sensor locations · simulated readings`:'No sensors of this type on this floor'}</small><small>Illustrative colour areas near sensors.</small></div>}
  {showLabels&&<div className={`bim-pin-layer ${sensorMotion?'':'sensor-motion-off'}`}><svg className="bim-pin-leaders" aria-hidden="true">{pins.map(p=>{const state=activity(p.code);return <g key={p.code} className={`${p.selected?'pin-target-selected':''} sensor-${state}`} style={{'--sensor-delay':`${-p.index*.17}s`} as CSSProperties}><line x1={p.anchorX} y1={p.anchorY} x2={p.x} y2={p.y}/><circle className="sensor-anchor-core" cx={p.anchorX} cy={p.anchorY} r={p.selected?12:5}/>{state==='receiving'&&<circle className="sensor-arrival-ring" cx={p.anchorX} cy={p.anchorY} r="10"/>}{p.selected&&<circle className="pin-target-outer" cx={p.anchorX} cy={p.anchorY} r="19"/>}</g>})}</svg>{pins.map(p=>{const point=POINTS.find(x=>x.code===p.code);if(!point)return null;const state=activity(p.code),description=ACTIVITY_LABELS[state];return <button key={p.code} className={`bim-sensor-pin ${p.selected?'bim-sensor-pin-selected':''} sensor-${state}`} style={{left:p.x,top:p.y,'--sensor-delay':`${-p.index*.17}s`} as CSSProperties} aria-label={`Select sensor ${p.index}: ${sensorTitle(point)}. ${description}`} aria-pressed={p.selected} title={`${String(p.index).padStart(2,'0')} · ${sensorTitle(point)} · ${description}`} onClick={()=>onSensorSelect(p.code)}>{String(p.index).padStart(2,'0')}</button>})}</div>}

  {!view.ready&&<div className="viewer-loading"><div className="xeokit-feedback"><strong>{error?'3D viewer unavailable':'Loading the building'}</strong><p>{error||'Preparing rooms and sensor readings…'}</p></div></div>}
  <div className="scene-weather-status" role="status">{weather==='rain'?'Rain':weather==='cloudy'?'Cloudy':weather==='night'?'Night':'Clear'} · simulated{view.floor!=='all'?' · exterior effects hidden in room view':''}</div>
  <div className="bim-view-status" aria-live="polite"><span className={view.moving?'bim-moving':''}/>{view.moving?'Moving to ':''}{floorLabel(view.floor)}{view.ready&&<small>{new Set(scoped.map(p=>p.assetId)).size} monitored locations</small>}{selected&&view.mode!=='solid'&&<small className="bim-room-boundary-note">{view.hasRoomBoundary?(view.roomBoundary.startsWith('Geometric')?'IFC space outline · geometric match; room name unverified':'IFC room boundary available'):'Room boundary unavailable · showing sensor surroundings'}</small>}</div>
  <div className="bim-gesture-help">Drag to rotate · Ctrl/⌘ + scroll to zoom · scroll to move page</div>
  <div className="bim-navigation-dock"><div className="bim-camera-actions"><button title="Whole building" aria-label="Whole building view" disabled={!view.ready} onClick={home}><Home size={15}/><span>Reset</span></button><button title="Fit the model" aria-label="Fit current view" disabled={!view.ready} onClick={()=>controller.current?.fit()}><Scan size={15}/><span>Fit</span></button><button aria-label="3D orbit view" aria-pressed={view.view==='orbit'} disabled={!view.ready} onClick={()=>controller.current?.setView('orbit')}><Box size={15}/><span>3D</span></button><button aria-label="Top-down view" aria-pressed={view.view==='plan'} disabled={!view.ready} onClick={()=>controller.current?.setView('plan')}><Map size={15}/><span>{selected?'Room plan':'Top'}</span></button><button aria-label="Zoom in" disabled={!view.ready} onClick={()=>controller.current?.zoom(.8)}><Plus size={16}/></button><button aria-label="Zoom out" disabled={!view.ready} onClick={()=>controller.current?.zoom(1.25)}><Minus size={16}/></button></div>
   <div className="bim-sensor-switcher"><button aria-label="Previous sensor" disabled={!view.ready||!scoped.length} onClick={()=>step(-1)}><ArrowLeft size={14}/></button><select aria-label="Choose room and sensor" value={selected?.code||''} disabled={!view.ready} onChange={e=>e.target.value&&onSensorSelect(e.target.value)}><option value="">Choose a room or sensor</option>{navigation.levels.map(level=>{const points=POINTS.filter(p=>p.floor===level.id);return points.length?<optgroup key={level.id} label={level.label}>{points.map(p=><option key={p.code} value={p.code}>{sensorTitle(p)}</option>)}</optgroup>:null})}</select><button aria-label="Next sensor" disabled={!view.ready||!scoped.length} onClick={()=>step(1)}><ArrowRight size={14}/></button></div>
  </div>
  {selected&&selectedDisplay&&<div className="bim-focus-reading" aria-live="polite"><LocateFixed size={14}/><div><strong>{roomTitle(selected)} · {METRICS[selected.sensorType as keyof typeof METRICS]?.label||selected.label}</strong><span>{floorLabel(selected.floor)} · {selectedDisplay.status}</span></div><code style={{color:selectedDisplay.colour}}>{readings[selected.code]?.value!=null&&selected.unit!=='binary'?<><ValueMotion value={readings[selected.code].value!}/>{' '+selected.unit}</>:selectedDisplay.value}</code></div>}
  {error&&view.ready&&<div role="status" className="bim-inline-error">{error}</div>}
 </div></div>;
}
