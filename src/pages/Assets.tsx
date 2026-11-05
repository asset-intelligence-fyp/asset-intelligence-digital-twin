import type { ReactNode } from 'react';
import { useState } from 'react';
import { Gauge, MapPin, Search, Activity, Radio } from 'lucide-react';
import { ASSETS, POINTS, readingLabel, displayTime, useTwin, type AssetId } from '../services/twin';
import { Eyebrow, EmptyState, StatusPill } from '../components/UI';
export function Assets({selectedAsset,onSelect,selectedCode,onSelectCode}:{selectedAsset:AssetId;onSelect:(x:AssetId)=>void;selectedCode:string;onSelectCode:(x:string)=>void}){
 const {readings,assets,maintenance}=useTwin();
 const [filter,setFilter]=useState<'All'|'Running'|'Idle'>('All');
 const [search,setSearch]=useState('');
 const visible=ASSETS.filter(id=>{
  const point=POINTS.find(p=>p.assetId===id)!;
  const active=Boolean(readings[point.code]);
  return (filter==='All'||(filter==='Running'&&active)||(filter==='Idle'&&!active))&&(id+' '+point.locationLabel).toLowerCase().includes(search.toLowerCase());
 });
 const selected=assets.find(a=>a.asset_id===selectedAsset);
 const channels=POINTS.filter(p=>p.assetId===selectedAsset);
 return <div className="assets-page"><div className="page-heading assets-heading"><div><Eyebrow>SYSTEMS</Eyebrow><h1>Asset register</h1><p>Five monitoring locations · 18 IFC-linked synthetic sensor points</p></div><div className="asset-tools"><label className="searchbox"><Search size={18}/><input placeholder="Search locations" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search assets"/></label><div className="segmented">{(['All','Running','Idle'] as const).map(f=><button key={f} onClick={()=>setFilter(f)} className={f===filter?'active':''}>{f}</button>)}</div></div></div>
 <div className="assets-grid"><section className="surface register-list"><div className="register-header"><span>ASSET</span><span>LEVEL</span><span>LATEST READING</span><span>STATUS</span><span>CHANNELS</span></div>{visible.length?visible.map(id=>{const points=POINTS.filter(p=>p.assetId===id),sat=(points.find(p=>p.sensorType==='temperature')||points[0]);return <button key={id} className={`register-row ${selectedAsset===id?'row-selected':''}`} onClick={()=>{onSelect(id);onSelectCode(sat.code)}}><div className="register-name"><span><i className="asset-bullet running"/>{points[0].locationLabel}</span><Eyebrow>{id}</Eyebrow></div><div>{points[0]?.floor.replace('_',' ')}</div><div className="mono">{readingLabel(sat.code,readings[sat.code])}</div><div><StatusPill status={readings[sat.code]?'Running':'Idle'}/></div><div className="register-health"><span>{points.filter(p=>readings[p.code]).length}/{points.length} live</span><span className="register-arrow">↗</span></div></button>}):<EmptyState message="No matching assets"/>}</section>
 <aside className="surface asset-detail"><div className="asset-detail-header"><div><Eyebrow>MONITORING LOCATION</Eyebrow><h2>{channels[0]?.locationLabel||selectedAsset}</h2><p><MapPin size={15}/> FYP whole building · {channels[0]?.floor.replace('_',' ')}</p></div><StatusPill status={channels.some(p=>readings[p.code])?'Running':'Idle'}/></div><div className="asset-detail-body"><div className="asset-metrics"><Metric icon={<Radio size={15}/>} label="Channels" value={String(channels.length)}/><Metric icon={<Activity size={15}/>} label="Reporting" value={String(channels.filter(p=>readings[p.code]).length)}/><Metric icon={<Gauge size={15}/>} label="BIM markers" value={String(channels.filter(p=>p.guid).length)}/><Metric icon={<MapPin size={15}/>} label="Location ID" value={selectedAsset}/></div>
  <div className="asset-detail-section"><Eyebrow>MEASUREMENT CHANNELS</Eyebrow><div className="twin-sensor-list">{channels.map(p=><button key={p.code} onClick={()=>onSelectCode(p.code)} className={`twin-sensor-row ${selectedCode===p.code?'active':''}`}><span><strong>{p.code}</strong><small>{p.label}</small></span><code>{readingLabel(p.code,readings[p.code])}</code></button>)}</div></div>
  <div className="asset-detail-section"><Eyebrow>MONITORING DETAILS</Eyebrow><div className="twin-metadata"><span>Location</span><strong>{selected?.asset_name||selectedAsset}</strong><span>IFC floor</span><strong>{channels[0]?.floor.replaceAll('_',' ')}</strong><span>Sensor objects</span><strong>{channels.length} linked markers</strong></div><p className="twin-small">This is a monitoring location, not a manufactured equipment record.</p></div>
  <div className="asset-detail-section"><Eyebrow>MAINTENANCE HISTORY</Eyebrow><div className="twin-history">{maintenance.filter(x=>x.asset_id===selectedAsset).slice(0,6).map(m=><div key={m.maintenance_id}><strong>{displayTime(m.event_date)}</strong><p>{m.description||m.event_type}</p></div>)}{!maintenance.some(x=>x.asset_id===selectedAsset)&&<p>No linked maintenance history for this monitoring location.</p>}</div></div>
 </div></aside></div></div>;
}
function Metric({icon,label,value}:{icon:ReactNode;label:string;value:string}){return <div className="detail-metric"><Eyebrow>{icon}{label}</Eyebrow><strong>{value}</strong></div>}

