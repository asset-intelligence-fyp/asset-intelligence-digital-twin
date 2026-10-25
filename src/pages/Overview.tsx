import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Gauge, Layers, Maximize2, Radio, Thermometer, Activity } from 'lucide-react';
import { ASSETS, POINTS, displayTime, readingLabel, useTwin, type AssetId } from '../services/twin';
import { DemoBuilding } from '../components/DemoBuilding';
import { TelemetryChart } from '../components/TelemetryChart';
import { Eyebrow, Pill, StatusPill } from '../components/UI';
import type { Page } from '../components/Shell';

export function Overview({setPage,selectedAsset,onSelectAsset,selectedCode,onSelectCode}:{setPage:(page:Page)=>void;selectedAsset:AssetId;onSelectAsset:(id:AssetId)=>void;selectedCode:string;onSelectCode:(id:string)=>void}){
 const {mode,readings,events,mqttCoverage}=useTwin();
 const [assetFilter,setAssetFilter]=useState<'All'|'Running'|'Idle'|'Fault'>('All');
 const points=POINTS.filter(p=>p.assetId===selectedAsset);
 const filtered=ASSETS.filter(asset=>assetFilter==='All'||(assetFilter==='Running'&&readings[POINTS.find(p=>p.assetId===asset)?.code||'']));
 const open=events.filter(e=>!e.acknowledged&&e.level!=='Info').length;
 const updated=useMemo(()=>Object.values(readings).map(x=>x.timestamp).sort().at(-1),[readings]);
 return <div className="overview-page">
  <div className="page-heading overview-heading"><div><Eyebrow>DIGITAL TWIN</Eyebrow><h1>Building overview</h1><p>Snowdon Towers · Level 5 — last reading {displayTime(updated)}</p></div><div className="heading-actions"><Pill tone={mode==='mqtt'&&mqttCoverage<9?'warning':'teal'}><span className="status-dot"/>{mode==='random'?'Synthetic readings':`MQTT · ${mqttCoverage}/9`}</Pill><button className="dark-button" onClick={()=>document.querySelector<HTMLElement>('.model-card .small-outline')?.click()}><Maximize2 size={14}/> Twin view</button></div></div>
  <div className="overview-workbench"><section className="zone-list surface"><div className="zone-list-title"><span><Layers size={14}/> HRU ASSETS</span><span>3</span></div><div className="zone-items">{ASSETS.map(asset=>{
   const channels=POINTS.filter(p=>p.assetId===asset),current=channels.filter(p=>readings[p.code]).length;
   return <button key={asset} className={`zone-item ${selectedAsset===asset?'zone-item-selected':''}`} onClick={()=>{onSelectAsset(asset);onSelectCode(channels[0].code)}}><span className="zone-name"><i/>{asset}</span><span className="zone-percent">{current}/{channels.length} CHANNELS</span><span className="occupancy-track"><span style={{width:`${current/channels.length*100}%`}}/></span></button>;
  })}</div></section>
   <DemoBuilding selectedCode={selectedCode} onSelect={code=>{onSelectCode(code);const asset=POINTS.find(p=>p.code===code)?.assetId;if(asset)onSelectAsset(asset)}} />
   <div className="overview-aside"><section className="surface zone-detail"><div className="zone-detail-top"><div><Eyebrow>LEVEL 5 · EQUIPMENT</Eyebrow><h2>{selectedAsset}</h2></div><Pill tone="teal"><span className="status-dot"/>Monitoring</Pill></div>
    <div className="zone-stat-grid"><Stat icon={<Radio size={14}/>} label="Channels" value={String(points.length)} unit=""/><Stat icon={<Gauge size={14}/>} label="Reporting" value={String(points.filter(p=>readings[p.code]).length)} unit=""/><Stat icon={<Thermometer size={14}/>} label="Supply temp" value={readings[points.find(p=>p.code.startsWith('SAT'))?.code||'']?.value.toFixed(1)||'—'} unit="°C"/><Stat icon={<Activity size={14}/>} label="Data" value={mode==='random'?'Random':'MQTT'} unit=""/></div>
    <Eyebrow className="sys-zone-label">SENSORS IN ASSET</Eyebrow><div className="zone-system-rows">{points.map(p=><button className="twin-zone-sensor" key={p.code} onClick={()=>onSelectCode(p.code)}><span className="teal-bullet"/>{p.code}<code>{readingLabel(p.code,readings[p.code])}</code></button>)}</div>
   </section><section className="surface orders-panel"><div className="orders-top"><Eyebrow>RECENT EVENT ACTIVITY</Eyebrow><button title="Open event log" onClick={()=>setPage('events')}><ArrowUpRight size={16}/></button></div><div className="twin-compact-events"><strong>{open} open events</strong><p>{events[0]?.title||'No recorded events'}</p></div></section></div>
  </div>
  <section className="surface insights-panel twin-trends"><div className="insights-top"><div><h3>Sensor trends</h3><Eyebrow>REFRESHES AUTOMATICALLY</Eyebrow></div><button className="small-outline" onClick={()=>setPage('analytics')}>All charts <ArrowUpRight size={13}/></button></div><div className="twin-trend-grid"><TelemetryChart codes={['SAT-501A','SAT-504','SAT-507']} title="Supply-air temperature"/><TelemetryChart codes={['DP-504','DPCMD-504','CV-507']} title="Actuator positions (%)"/></div></section>
  <div className="systems-heading"><div><h3>Systems on this model</h3><p>Active Level 5 HRU assets</p></div><div className="segmented systems-tabs">{(['All','Running'] as const).map(option=><button key={option} className={assetFilter===option?'active':''} onClick={()=>setAssetFilter(option)}>{option}</button>)}</div></div>
  <div className="system-cards">{filtered.map(asset=>{const channels=POINTS.filter(p=>p.assetId===asset);const sat=channels.find(p=>p.code.startsWith('SAT'))!;return <button className="system-tile surface" key={asset} onClick={()=>{onSelectAsset(asset);setPage('assets')}}><div className="system-tile-top"><div><strong>{asset}</strong><Eyebrow>HEAT RECOVERY UNIT</Eyebrow></div><StatusPill status={readings[sat.code]?'Running':'Idle'}/></div><p className="system-reading">{readingLabel(sat.code,readings[sat.code])}</p><div className="system-tile-bottom"><span>{channels.length} channels</span><span>{channels.filter(p=>readings[p.code]).length} reporting</span><ArrowUpRight size={16}/></div></button>})}</div>
 </div>;
}
function Stat({icon,label,value,unit}:{icon:ReactNode;label:string;value:string;unit:string}){return <div className="zone-stat"><Eyebrow>{icon}{label}</Eyebrow><span>{value}<small>{unit}</small></span></div>}
