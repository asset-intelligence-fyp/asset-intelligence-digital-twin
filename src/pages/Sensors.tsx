import { useState } from 'react';
import { Search } from 'lucide-react';
import { POINTS, ASSETS, readingLabel,displayTime,useTwin } from '../services/twin';
import {TelemetryChart} from '../components/TelemetryChart';
import {roomTitle,sensorTitle} from '../viewer/sensorPresentation.js';
import {Sparkline} from '../components/ValueMotion';
import {Eyebrow} from '../components/UI';
export function Sensors(){
 const {readings,mode,history}=useTwin();
 const [search,setSearch]=useState('');const [asset,setAsset]=useState<string>('all');
 const [selected,setSelected]=useState<string>('TEMP-L03-OPEN-01');
 const filtered=POINTS.filter(p=>(asset==='all'||p.assetId===asset)&&`${sensorTitle(p)} ${p.code} ${p.assetId} ${p.label}`.toLowerCase().includes(search.toLowerCase()));
 const point=POINTS.find(p=>p.code===selected)||POINTS[0];
 return <div className="assets-page"><div className="page-heading assets-heading"><div><Eyebrow>LIVE SENSOR DATA</Eyebrow><h1>Sensor monitoring</h1><p>18 whole-building sensor channels · {mode==='random'?'synthetic random values':'HTTP simulator stream'}</p></div><div className="asset-tools"><label className="searchbox"><Search size={18}/><input aria-label="Search sensors" placeholder="Search sensors" value={search} onChange={e=>setSearch(e.target.value)}/></label><select className="twin-select" aria-label="Filter by asset" value={asset} onChange={e=>setAsset(e.target.value)}><option value="all">All locations</option>{ASSETS.map(a=><option key={a} value={a}>{roomTitle(POINTS.find(p=>p.assetId===a)!)}</option>)}</select></div></div>
 <div className="assets-grid"><section className="surface register-list"><div className="twin-sensors-header"><span>SENSOR</span><span>ASSET</span><span>CURRENT VALUE</span><span>UPDATED</span></div>{filtered.map(p=><button className={`twin-monitor-row ${p.code===selected?'row-selected':''}`} key={p.code} onClick={()=>setSelected(p.code)}><div><strong>{p.label}</strong><small>{p.ifcSensorId}</small></div><span>{roomTitle(p)}</span><code>{readingLabel(p.code,readings[p.code])}<Sparkline rows={history.filter(r=>r.point_code===p.code).slice(-30)}/></code><span>{displayTime(readings[p.code]?.timestamp)}</span></button>)}</section>
 <aside className="surface asset-detail"><div className="asset-detail-header"><div><Eyebrow>SENSOR DETAILS</Eyebrow><h2>{point.label}</h2><p>{roomTitle(point)} · {point.floor.replaceAll('_',' ')}</p></div></div><div className="asset-detail-body"><div className="twin-sensor-detail-value">{readingLabel(point.code,readings[point.code])}</div><p className="twin-small">Last received: {displayTime(readings[point.code]?.timestamp)}</p><p className="twin-small">Source: {mode==='random'?'Random simulation':'HTTP'}</p><p className="twin-small">IFC location: {point.assetId} · {point.floor}</p><p className="twin-small">Simulator room: {point.simulatorRoomId}</p><p className="twin-small">Mapping: demonstration alias; floor arrangements differ.</p><p className="twin-small">BIM marker: {point.guid||'Not assigned'}</p><TelemetryChart codes={[point.code]} title={point.label}/></div></aside></div></div>;
}

