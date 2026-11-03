import { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { displayTime, useTwin, type EventRecord } from '../services/twin';
import { Eyebrow } from '../components/UI';
export function Events(){
 const {events,acknowledge,mode}=useTwin();
 const [filter,setFilter]=useState<'All events'|EventRecord['level']>('All events');
 const [onlyOpen,setOnlyOpen]=useState(false);
 const [error,setError]=useState('');
 const open=events.filter(x=>x.level!=='Info'&&!x.acknowledged).length;
 const filtered=events.filter(e=>(filter==='All events'||e.level===filter)&&(!onlyOpen||!e.acknowledged));
 const counts={Critical:events.filter(x=>x.level==='Critical').length,Warning:events.filter(x=>x.level==='Warning').length,Info:events.filter(x=>x.level==='Info').length};
 async function toggle(id:number){setError('');try{await acknowledge(id)}catch(e){setError(String(e))}}
 return <div className="events-page"><div className="page-heading event-heading"><div><Eyebrow>EVENTS</Eyebrow><h1>Event log</h1><p>Recorded anomalies and synthetic test alerts · {mode==='random'?'Random simulation':'MQTT'}</p></div><div className="event-counts"><button className={`event-count event-count-open ${onlyOpen?'count-active':''}`} onClick={()=>setOnlyOpen(v=>!v)}><AlertTriangle size={17}/>{open} open</button><button className={`event-count ${!onlyOpen?'count-active':''}`} onClick={()=>setOnlyOpen(false)}><ShieldCheck size={17}/>{events.filter(e=>e.acknowledged).length} acknowledged</button></div></div>{error&&<p role="alert" className="twin-error">{error}</p>}
 <div className="events-tabs surface">{(['All events','Critical','Warning','Info'] as const).map(f=><button key={f} onClick={()=>setFilter(f)} className={filter===f?'active':''}>{f}<span>{f==='All events'?events.length:counts[f]}</span></button>)}</div>
 <section className="surface events-list">{filtered.length?filtered.map(e=><div key={e.id} className={`event-entry event-${e.level.toLowerCase()} ${e.acknowledged?'acknowledged':''}`}><span className="event-dot"/><div className="event-main"><div className="event-title"><h3>{e.title}</h3><span className={`severity severity-${e.level.toLowerCase()}`}>{e.level.toUpperCase()}</span></div><p>{e.description}</p><div className="event-meta">{e.source} · {e.zone} · {displayTime(e.time)} · {e.synthetic?'Synthetic test':'Database record'}</div></div><button className="ack-button" onClick={()=>void toggle(e.id)}>{e.acknowledged?'Undo acknowledge':'Acknowledge'}</button></div>):<div className="empty-events">No events in this filter.</div>}</section></div>;
}

