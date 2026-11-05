import {useEffect,useState} from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { POINTS, readingLabel, displayTime, useTwin } from '../services/twin';
import { Eyebrow } from '../components/UI';
import {BenchmarkPanel} from '../components/BenchmarkPanel';
import { TelemetryChart } from '../components/TelemetryChart';
export function Simulator(){
 const {readings,addTestEvent}=useTwin();
 const [producer,setProducer]=useState<{dataset?:string;dataset_timestamp?:string;release_interval_seconds?:number;name?:string}|null>(null);
 useEffect(()=>{let active=true;const check=async()=>{try{const r=await fetch('/api/live-status');if(r.ok){const d=await r.json();if(active)setProducer(d.producer)}}catch{}};void check();const t=setInterval(check,5000);return()=>{active=false;clearInterval(t)}},[]);
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>SIMULATION CONTROLS</Eyebrow><h1>Sensor simulator</h1><p>Simulated telemetry · 18 IFC-linked channels</p></div><div className="heading-actions"><span className="pill pill-teal"><span className="status-dot"/>Synthetic Python HTTP stream</span></div></div>
 <BenchmarkPanel/>
 <div className="twin-sim-grid"><section className="surface twin-sim-control"><Eyebrow>SIMULATED SOURCE</Eyebrow>
 <p>{producer?.name==='people_driven_v3.0_dataset_replay'?'Exact replay of the supplied people_driven_v3.0 dataset.':'Waiting for the dataset replay. Configure DATASET_PATH and start the simulator.'} No physical sensor feed is used.</p>
 <p><strong>Dataset:</strong> {producer?.dataset||'Not connected'}<br/><strong>Dataset time:</strong> {displayTime(producer?.dataset_timestamp)}</p>
 <p>Original samples are five minutes apart. Replay releases one complete 18-sensor batch every {producer?.release_interval_seconds??2} real seconds when delivery keeps up. Values and historical timestamps are preserved; no readings are invented between samples.</p>
 <p>Normal 2023–2025 and fault-injected January–March 2026 are separate runs. Fault labels are reserved for evaluation and never sent to the assistant. Scene weather does not change readings.</p>
 <p>Stop the Python process to pause. IFC locations remain demonstration room-type aliases; this replay does not validate physical sensor placement.</p>
 <Eyebrow>EVENT TESTING</Eyebrow><button className="small-outline twin-alert-button" onClick={addTestEvent}><AlertTriangle size={15}/> Generate test alert</button><p>Test alerts can be acknowledged in Event log. They are not AI predictions.</p></section>
 <section className="surface twin-sim-readings"><Eyebrow><Activity size={14}/> ACTIVE CHANNELS</Eyebrow>{POINTS.map(p=><div className="twin-sim-reading" key={p.code}><div><strong>{p.code}</strong><small>{p.assetId} · {p.label}</small></div><div><code>{readingLabel(p.code,readings[p.code])}</code><small>{readings[p.code]?new Date(readings[p.code].timestamp).toLocaleTimeString():'—'}</small></div></div>)}<p className="twin-small">Updated {displayTime(Object.values(readings).map(r=>r.timestamp).sort().at(-1))}</p></section></div>
 <section className="surface chart-panel twin-sim-chart"><div className="chart-heading"><h3>Simulated room temperatures</h3><span>°C · auto-refresh</span></div><TelemetryChart codes={['TEMP-L03-OPEN-01','TEMP-L03-MEET-01']}/></section></div>;
}

