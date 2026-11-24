import {useState} from 'react';
import {Activity,AlertTriangle,ArrowUpRight,BrainCircuit,CheckCircle2,Clock3,FlaskConical,Radio,TrendingUp} from 'lucide-react';
import {POINTS,displayTime,readingLabel,useTwin,type EventRecord} from '../services/twin';
import {AlertEvidence} from '../components/AlertEvidence';
import {Eyebrow} from '../components/UI';

type MonitorFilter='active'|'all';
export function AIMonitoring({onEvent,onAssistant,onFocus}:{onEvent:(id:number)=>void;onAssistant:()=>void;onFocus:(code:string)=>void}){
 const {events,readings,httpCoverage,backendConnected,acknowledge}=useTwin();
 const [filter,setFilter]=useState<MonitorFilter>('active');
 const [selectedId,setSelectedId]=useState<number|null>(null);
 const [error,setError]=useState('');
 const monitored=events.filter(e=>e.automatic||!e.synthetic);
 const active=monitored.filter(e=>!e.acknowledged&&!e.resolved_at);
 const visible=filter==='active'?active:monitored;
 const selected=visible.find(e=>e.id===selectedId)||visible[0];
 const point=selected&&POINTS.find(p=>p.code===selected.point_code);
 const severity=(event:EventRecord)=>event.level==='Critical'?'critical':event.level==='Warning'?'warning':'info';
 const toggle=async(id:number)=>{setError('');try{await acknowledge(id)}catch(e){setError(e instanceof Error?e.message:String(e))}};
 return <div className="monitoring-page">
  <div className="page-heading"><div><Eyebrow>BUILDING INTELLIGENCE</Eyebrow><h1>AI monitoring</h1><p>Automatic sensor alerts, supporting incident evidence, and experimental forecasting. All telemetry is simulated.</p></div><button className="dark-button" onClick={onAssistant}><BrainCircuit size={15}/> Open assistant</button></div>
  <div className="monitoring-kpis">
   <div className="surface monitoring-kpi"><Radio size={18}/><div><small>Channels reporting</small><strong>{httpCoverage}/18</strong><span>{backendConnected?'HTTP simulator connected':'API connection unavailable'}</span></div></div>
   <div className="surface monitoring-kpi"><AlertTriangle size={18}/><div><small>Active rule alerts</small><strong>{active.length}</strong><span>{active.filter(e=>e.level==='Critical').length} critical</span></div></div>
   <div className="surface monitoring-kpi"><Activity size={18}/><div><small>Rule-based detection</small><strong>{backendConnected?'Automatic rules':'Unavailable'}</strong><span>Based on live simulated readings</span></div></div>
  </div>
  <div className="monitoring-workspace">
   <section className="surface monitoring-queue"><div className="monitoring-panel-head"><div><Eyebrow>ALERT INBOX</Eyebrow><h2>Incidents</h2></div><div className="segmented"><button className={filter==='active'?'active':''} onClick={()=>{setFilter('active');setSelectedId(null)}}>Active</button><button className={filter==='all'?'active':''} onClick={()=>{setFilter('all');setSelectedId(null)}}>History</button></div></div>
   {visible.length?visible.map(e=><button key={e.id} className={'monitoring-incident '+(selected?.id===e.id?'is-selected':'')} aria-pressed={selected?.id===e.id} onClick={()=>setSelectedId(e.id)}><span className={'overview-alert-dot severity-'+severity(e)}/><span className="monitoring-incident-body"><strong>{e.title}</strong><small>{e.source} · {e.automatic?'Automatic rule':'Recorded result'}</small><em>{displayTime(e.time)} · {e.resolved_at?'Recovered':e.acknowledged?'Acknowledged':e.level}</em></span><ArrowUpRight size={14}/></button>):<div className="monitoring-empty"><CheckCircle2 size={24}/><h3>No alerts in this view</h3><p>Automatic rule events appear when the simulator produces a matching sensor condition. No result does not prove all systems are fault-free.</p></div>}
   </section>
   <aside className="surface monitoring-evidence"><Eyebrow>VERIFIED EVENT DETAILS</Eyebrow>{selected?<><h2>{selected.title}</h2><p>{selected.description}</p><div className="monitoring-details"><div><small>Detection time</small><strong>{displayTime(selected.time)}</strong></div><div><small>Source</small><strong>{selected.automatic?'Automatic sensor rule':'Stored result'}</strong></div><div><small>Condition</small><strong>{selected.resolved_at?'Recovered':selected.acknowledged?'Acknowledged':'Active'}</strong></div>{point&&<div><small>Current sensor reading</small><strong>{readingLabel(point.code,readings[point.code])}</strong></div>}</div><AlertEvidence event={selected}/>
   {error&&<p role="alert" className="twin-error">{error}</p>}
   <div className="monitoring-actions"><button className="dark-button" onClick={()=>onEvent(selected.id)}>Full incident details <ArrowUpRight size={13}/></button>{point&&<button className="small-outline" onClick={()=>onFocus(point.code)}>Locate in BIM</button>}<button className="small-outline" onClick={()=>void toggle(selected.id)}>{selected.acknowledged?'Undo acknowledgement':'Acknowledge'}</button></div>
   </>:<div className="monitoring-empty"><Clock3 size={23}/><h3>Select an incident</h3><p>Event evidence and the related sensor will appear here.</p></div>}</aside>
  </div>
  <section className="surface monitoring-forecast"><div><Eyebrow>EXPERIMENTAL FORECASTING</Eyebrow><h2><TrendingUp size={18}/> One-month sensor projections</h2><p>The Qwen room assistant can generate on-demand one-month point projections for eligible temperature, humidity and CO₂ sensors. These are exploratory estimates, not automatic forecast alerts or statistically calibrated ranges. Short-term operational forecasting is not connected.</p></div><button className="small-outline" onClick={onAssistant}>Open projections <ArrowUpRight size={13}/></button></section>
  <p className="monitoring-provenance"><FlaskConical size={13}/> Synthetic input · sensor/BIM aliases are demonstration mappings · investigate model interpretations before acting.</p>
 </div>;
}
