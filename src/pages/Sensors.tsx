import { useState } from 'react';
import { Search } from 'lucide-react';
import { POINTS, ASSETS, readingLabel,displayTime,useTwin } from '../services/twin';
import {TelemetryChart} from '../components/TelemetryChart';
import {Eyebrow} from '../components/UI';
export function Sensors({selectedCode,onSelectCode}:{selectedCode:string;onSelectCode:(code:string)=>void}){
 const {readings,mode}=useTwin();
 const [search,setSearch]=useState('');const [asset,setAsset]=useState<string>('all');
 const selected=selectedCode;
 const filtered=POINTS.filter(p=>(asset==='all'||p.assetId===asset)&&`${p.code} ${p.assetId} ${p.label}`.toLowerCase().includes(search.toLowerCase()));
 const point=POINTS.find(p=>p.code===selected)||POINTS[0];
 return <div className="assets-page"><div className="page-heading assets-heading"><div><Eyebrow>LIVE SENSOR DATA</Eyebrow><h1>Sensor monitoring</h1><p>Nine Level 5 sensor channels · {mode==='random'?'synthetic random values':'MQTT stream'}</p></div><div className="asset-tools"><label className="searchbox"><Search size={18}/><input aria-label="Search sensors" placeholder="Search sensors" value={search} onChange={e=>setSearch(e.target.value)}/></label><select className="twin-select" aria-label="Filter by asset" value={asset} onChange={e=>setAsset(e.target.value)}><option value="all">All HRUs</option>{ASSETS.map(a=><option key={a} value={a}>{a}</option>)}</select></div></div>
 <div className="assets-grid"><section className="surface register-list"><div className="twin-sensors-header"><span>SENSOR</span><span>ASSET</span><span>CURRENT VALUE</span><span>UPDATED</span></div>{filtered.map(p=><button className={`twin-monitor-row ${p.code===selected?'row-selected':''}`} key={p.code} onClick={()=>onSelectCode(p.code)}><div><strong>{p.code}</strong><small>{p.label}</small></div><span>{p.assetId}</span><code>{readingLabel(p.code,readings[p.code])}</code><span>{displayTime(readings[p.code]?.timestamp)}</span></button>)}</section>
 <aside className="surface asset-detail"><div className="asset-detail-header"><div><Eyebrow>SENSOR DETAILS</Eyebrow><h2>{point.code}</h2><p>{point.assetId} · {point.label}</p></div></div><div className="asset-detail-body"><div className="twin-sensor-detail-value">{readingLabel(point.code,readings[point.code])}</div><p className="twin-small">Last received: {displayTime(readings[point.code]?.timestamp)}</p><p className="twin-small">Source: {mode==='random'?'Random simulation':'MQTT'}</p><p className="twin-small">BIM marker: {point.guid||'Not assigned'}</p><TelemetryChart codes={[point.code]} title={point.label}/></div></aside></div></div>;
}
