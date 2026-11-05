import type { ReactNode } from 'react';
import { useEffect,useMemo, useState } from 'react';
import { ArrowUpRight, Gauge, Layers, Maximize2, Radio, Thermometer, Activity } from 'lucide-react';
import { ASSETS, POINTS, displayTime, readingLabel, useTwin, type AssetId } from '../services/twin';
import { DemoBuilding } from '../components/DemoBuilding';
import { TelemetryChart } from '../components/TelemetryChart';
import { Eyebrow, Pill, StatusPill } from '../components/UI';
import {roomTitle} from '../viewer/sensorPresentation.js';
import {WeatherControls} from '../components/WeatherControls';
import type { Page } from '../components/Shell';

export function Overview({externalFocusRequest=0,setPage,selectedAsset,onSelectAsset,selectedCode,onSelectCode}:{externalFocusRequest?:number;setPage:(page:Page)=>void;selectedAsset:AssetId;onSelectAsset:(id:AssetId)=>void;selectedCode:string;onSelectCode:(id:string)=>void}){
 const {mode,readings,events,httpCoverage}=useTwin();
 const [focusRequest,setFocusRequest]=useState(0);
 const [viewFloor,setViewFloor]=useState('all');
 const focusSensor=(code:string)=>{const point=POINTS.find(p=>p.code===code);if(!point)return;onSelectCode(code);onSelectAsset(point.assetId);setViewFloor(point.floor);setFocusRequest(value=>value+1)};
 useEffect(()=>{if(externalFocusRequest)focusSensor(selectedCode)},[externalFocusRequest]);
 const floorChanged=(floor:string)=>{setViewFloor(floor);onSelectCode('');const first=POINTS.find(p=>p.floor===floor);if(first)onSelectAsset(first.assetId)};
 const [assetFilter,setAssetFilter]=useState<'All'|'Running'|'Idle'|'Fault'>('All');
 const points=POINTS.filter(p=>p.assetId===selectedAsset);
 const filtered=ASSETS.filter(asset=>assetFilter==='All'||(assetFilter==='Running'&&readings[POINTS.find(p=>p.assetId===asset)?.code||'']));
 const open=events.filter(e=>!e.acknowledged&&e.level!=='Info').length;
 const updated=useMemo(()=>Object.values(readings).map(x=>x.timestamp).sort().at(-1),[readings]);
 return <div className="overview-page">
  <div className="page-heading overview-heading"><div><Eyebrow>ASSET INTELLIGENCE / SIMULATION</Eyebrow><h1>Building overview</h1><p>FYP whole building · Levels 2–5 — simulation timestamp {displayTime(updated)}</p></div><div className="heading-actions"><Pill tone={mode==='http'&&httpCoverage<18?'warning':'teal'}><span className="status-dot"/>{mode==='random'?'Synthetic readings':`HTTP · ${httpCoverage}/18`}</Pill><button className="dark-button" onClick={()=>document.querySelector<HTMLElement>('.model-card .small-outline')?.click()}><Maximize2 size={14}/> Twin view</button></div></div>
  <WeatherControls/>
  <div className="overview-workbench"><section className="zone-list surface"><div className="zone-list-title"><span><Layers size={14}/> MONITORING LOCATIONS</span><span>5</span></div><div className="zone-items">{ASSETS.map(asset=>{
   const channels=POINTS.filter(p=>p.assetId===asset),current=channels.filter(p=>readings[p.code]).length;
   return <button key={asset} className={`zone-item ${selectedAsset===asset?'zone-item-selected':''}`} onClick={()=>focusSensor(channels[0].code)}><span className="zone-name"><i/>{roomTitle(channels[0])}</span><span className="room-floor-label">{channels[0].floor.replace('Level_0','Level ').replaceAll('_',' ')}</span><span className="zone-percent">{current}/{channels.length} CHANNELS</span><span className="occupancy-track"><span style={{width:`${current/channels.length*100}%`}}/></span></button>;
  })}</div></section>
   <DemoBuilding selectedCode={selectedCode} focusRequest={focusRequest} onFloorChange={floorChanged} onSelect={focusSensor} />
   <div className="overview-aside"><section className="surface zone-detail">{viewFloor!=='all'&&!POINTS.some(p=>p.floor===viewFloor)?<div className="bim-no-sensors"><Layers size={22}/><h2>{viewFloor.replaceAll('_',' ')}</h2><p>No configured sensors on this level. Choose another floor or inspect its geometry in the viewer.</p></div>:<><div className="zone-detail-top"><div><Eyebrow>SELECTED LOCATION</Eyebrow><h2>{points[0]?roomTitle(points[0]):selectedAsset}</h2><p className="room-floor-label">{points[0]?.floor.replace('Level_0','Level ').replaceAll('_',' ')}</p></div><Pill tone="teal"><span className="status-dot"/>Monitoring</Pill></div>
    <div className="zone-stat-grid"><Stat icon={<Radio size={14}/>} label="Channels" value={String(points.length)} unit=""/><Stat icon={<Gauge size={14}/>} label="Reporting" value={String(points.filter(p=>readings[p.code]).length)} unit=""/><Stat icon={<Thermometer size={14}/>} label="Room temp" value={readings[points.find(p=>p.sensorType==='temperature')?.code||'']?.value?.toFixed(1)||'—'} unit="°C"/><Stat icon={<Activity size={14}/>} label="Data" value={mode==='random'?'Generated':'Simulation'} unit=""/></div>
    <Eyebrow className="sys-zone-label">SENSORS IN LOCATION</Eyebrow><div className="zone-system-rows">{points.map(p=><button className="twin-zone-sensor" key={p.code} onClick={()=>focusSensor(p.code)} aria-pressed={selectedCode===p.code}><span className="sensor-list-number">{String(POINTS.indexOf(p)+1).padStart(2,'0')}</span>{p.sensorType==='co2'?'CO₂':p.label}<code>{readingLabel(p.code,readings[p.code])}</code></button>)}</div>
    {selectedCode&&points.some(p=>p.code===selectedCode)&&<div className="selected-sensor-detail"><Eyebrow>SELECTED SENSOR</Eyebrow><strong>{points.find(p=>p.code===selectedCode)?.label}</strong><code>{selectedCode}</code><p>The numbered marker and target ring identify its exact BIM position.</p><button className="small-outline" onClick={()=>focusSensor(selectedCode)}>Focus sensor <Maximize2 size={13}/></button></div>}
   </>}</section><section className="surface orders-panel"><div className="orders-top"><Eyebrow>RECENT EVENT ACTIVITY</Eyebrow><button title="Open event log" onClick={()=>setPage('events')}><ArrowUpRight size={16}/></button></div><div className="twin-compact-events"><strong>{open} open events</strong><p>{events[0]?.title||'No recorded events'}</p></div></section></div>
  </div>
  <section className="surface insights-panel twin-trends"><div className="insights-top"><div><h3>Sensor trends</h3><Eyebrow>REFRESHES AUTOMATICALLY</Eyebrow></div><button className="small-outline" onClick={()=>setPage('analytics')}>All charts <ArrowUpRight size={13}/></button></div><div className="twin-trend-grid"><TelemetryChart codes={['TEMP-L03-OPEN-01','TEMP-L03-MEET-01']} title="Room temperature"/><TelemetryChart codes={['RH-L03-OPEN-01','RH-L03-MEET-01','RH-L03-WC-01']} title="Relative humidity (%RH)"/></div></section>
  <div className="systems-heading"><div><h3>Systems on this model</h3><p>IFC locations with simulator room aliases</p></div><div className="segmented systems-tabs">{(['All','Running'] as const).map(option=><button key={option} className={assetFilter===option?'active':''} onClick={()=>setAssetFilter(option)}>{option}</button>)}</div></div>
  <div className="system-cards">{filtered.map(asset=>{const channels=POINTS.filter(p=>p.assetId===asset);const sat=(channels.find(p=>p.sensorType==='temperature')||channels[0]);return <button className="system-tile surface" key={asset} onClick={()=>{onSelectAsset(asset);setPage('assets')}}><div className="system-tile-top"><div><strong>{roomTitle(channels[0])}</strong><Eyebrow>{channels[0].floor.replace('Level_0','Level ').replaceAll('_',' ')}</Eyebrow></div><StatusPill status={readings[sat.code]?'Running':'Idle'}/></div><p className="system-reading">{readingLabel(sat.code,readings[sat.code])}</p><div className="system-tile-bottom"><span>{channels.length} channels</span><span>{channels.filter(p=>readings[p.code]).length} reporting</span><ArrowUpRight size={16}/></div></button>})}</div>
 </div>;
}
function Stat({icon,label,value,unit}:{icon:ReactNode;label:string;value:string;unit:string}){return <div className="zone-stat"><Eyebrow>{icon}{label}</Eyebrow><span>{value}<small>{unit}</small></span></div>}

