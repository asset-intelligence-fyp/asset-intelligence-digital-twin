import {useEffect, useRef, useState} from 'react';
import {ASSETS, POINTS, useTwin} from '../services/twin';
import '../room-ai-velvet.css';

type Evidence = {id:string; tool:string; [key:string]:unknown};
type Trace = {tool:string; reason:string; source:string};
type Analysis = {
 status:string; sensor_id:string; assessment:string; finding:string;
 possible_explanations:string[]; recommended_checks:string[];
 evidence:Evidence[]; trace:Trace[]; limitations:string[];
 llm_used:boolean; cited_evidence_ids?:string[];
};
type Projection = {
 status:string; sensor_id:string; unit:string; target_time:string;
 projected_value?:number; lower_scenario?:number; upper_scenario?:number;
 explanation?:string; reason?:string; direction?:string;
 limitations:string[]; assumptions?:string[];
 coverage?:{observed_samples:number;span_minutes:number;historical_months:number};
};
type Health = {connected:boolean;agentic_supported?:boolean;historical_reference_available?:boolean;error?:string};
const print = (n:number|undefined, unit='') => typeof n==='number' && Number.isFinite(n)
 ? n.toFixed(2)+(unit?' '+unit:'') : 'Unavailable';

export function RoomAIWorkspace({onSensor,draft}:{onSensor:(code:string)=>void;draft?:{question:string;scope:string;nonce:number}|null}){
 const twin=useTwin();
 const [sensorId,setSensorId]=useState('');
 const [question,setQuestion]=useState('Compare the current readings with historical patterns and explain the likely operating causes.');
 const [analysis,setAnalysis]=useState<Analysis|null>(null);
 const [forecast,setForecast]=useState<Projection|null>(null);
 const [health,setHealth]=useState<Health>({connected:false});
 const [busy,setBusy]=useState<'investigate'|'forecast'|null>(null);
 const [error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 const points=POINTS.filter(p=>p.assetId===twin.selectedRoom);
 const selected=points.find(p=>p.code===sensorId)||points[0];
 const eligible=selected && ['temperature','humidity','co2','power','light'].includes(selected.sensorType);
 const source=twin.scenario?'what_if':twin.replayTime!==null?'historical_replay':twin.demo||twin.mode==='random'?'browser_demo':'http';
 useEffect(()=>{
  let active=true;
  const refresh=()=>fetch('/api/assistant/health').then(r=>r.json()).then(d=>{if(active)setHealth(d)}).catch(()=>{if(active)setHealth({connected:false})});
  void refresh();const timer=setInterval(refresh,20000);
  return()=>{active=false;clearInterval(timer)};
 },[]);
 useEffect(()=>{request.current?.abort();setBusy(null);setAnalysis(null);setForecast(null);setError('')},[twin.selectedRoom,source]);
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{
  if(!draft)return;
  const point=POINTS.find(p=>p.code===draft.scope);
  const asset=point?.assetId || (ASSETS.includes(draft.scope)?draft.scope:null);
  if(asset)twin.setSelectedRoom(asset);
  if(point)setSensorId(point.code);
  if(draft.question)setQuestion(draft.question);
 },[draft?.nonce]);
 const cutoff=()=>{
  const roomCodes=new Set(points.map(p=>p.code));
  const latest=twin.replayTime??Math.max(...Object.values(twin.readings).filter(r=>roomCodes.has(r.point_code)).map(r=>Date.parse(r.timestamp)));
  if(!Number.isFinite(latest))throw Error('No sensor data yet. Start the simulator, then retry.');
  return new Date(latest).toISOString();
 };
 const run=async(task:'investigate'|'forecast')=>{
  if(busy||!selected)return;
  setError('');setAnalysis(null);setForecast(null);
  const controller=new AbortController();request.current?.abort();request.current=controller;
  setBusy(task);
  try {
   const as_of=cutoff(), codes=new Set(points.map(p=>p.code));
   const snapshot=source==='historical_replay'
    ?twin.history.filter(r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=Date.parse(as_of)).slice(-18000)
    :Object.values(twin.readings).filter(r=>codes.has(r.point_code));
   const reply=await fetch('/api/assistant/agentic/'+task,{
    method:'POST',headers:{'Content-Type':'application/json'},
    signal:controller.signal,
    body:JSON.stringify({room_id:twin.selectedRoom,sensor_id:selected.code,question,
     as_of,source,...(source==='http'?{}:{snapshot})}),
   });
   const data=await reply.json();
   if(!reply.ok)throw Error(data.error||'The AI service returned an error.');
   if(!controller.signal.aborted){
    if(task==='investigate')setAnalysis(data as Analysis);
    else setForecast(data as Projection);
   }
  }catch(e){
   if(!controller.signal.aborted)setError(e instanceof Error?e.message:'AI request failed');
  }finally{
   if(request.current===controller)setBusy(null);
  }
 };
 const setExample=(s:string)=>{setQuestion(s);setError('')};
 return <div className="room-ai-velvet" aria-label="TwinLabs contextual Agentic RAG and one-month forecasting">
  <header className="room-ai-intro">
   <strong>Qwen3 1.7B · Agentic building intelligence</strong>
   <p>Investigate sensor behaviour using current conditions and retrieved history, or explore a one-month-ahead forecast.</p>
   <span className={health.connected?'room-ai-connected':'room-ai-offline'}>
    {health.connected&&health.agentic_supported?'Agentic service connected':health.connected?'Qwen connected; verify agentic bridge':'Local model unavailable'}
   </span>
   <small>Normal-history reference: {health.historical_reference_available?'connected':'not configured or not confirmed'} · Advisory synthetic-data research</small>
  </header>

  <section className="room-ai-block">
   <h3>Select what to investigate</h3>
   <label className="room-ai-field">Monitoring location
    <select value={twin.selectedRoom} onChange={e=>twin.setSelectedRoom(e.target.value)}>
     {ASSETS.map(a=><option key={a} value={a}>{POINTS.find(p=>p.assetId===a)?.locationLabel||a}</option>)}
    </select>
   </label>
   <label className="room-ai-field">Sensor
    <select value={selected?.code||''} onChange={e=>setSensorId(e.target.value)}>
     {points.map(p=><option key={p.code} value={p.code}>{p.label} · {p.code}</option>)}
    </select>
   </label>
   {selected&&<button type="button" className="room-ai-secondary" onClick={()=>onSensor(selected.code)}>View selected sensor in 3D twin</button>}
  </section>

  <section className="room-ai-block">
   <h3>Contextual Agentic RAG investigation</h3>
   <p>Qwen can request relevant history, related sensors or previous rule alerts. The answer describes observed behaviour separately from a confirmed fault.</p>
   <label className="room-ai-field">Investigation question
    <input value={question} maxLength={900} onChange={e=>setQuestion(e.target.value)}
     placeholder="Why is this sensor changing?"/>
   </label>
   <div className="room-ai-actions">
    <button type="button" className="room-ai-secondary" onClick={()=>setExample('What changed recently, and can the current occupancy, HVAC or weather explain it?')}>Explain current conditions</button>
    <button type="button" className="room-ai-secondary" onClick={()=>setExample('Has a similar pattern occurred before, and what evidence should I check?')}>Compare history</button>
   </div>
   <div className="room-ai-actions">
    <button type="button" className="room-ai-primary" disabled={!!busy||!selected||!question.trim()} onClick={()=>void run('investigate')}>
     {busy==='investigate'?'Investigating…':'Investigate with Agentic RAG'}
    </button>
   </div>
   {analysis&&<article className="room-ai-result" aria-live="polite">
    <strong>{analysis.llm_used?'Qwen investigation':'Observed evidence · model fallback'}</strong>
    <p>{analysis.finding}</p>
    <p className="room-ai-subtle">Assessment: {(analysis.assessment||'insufficient_evidence').replaceAll('_',' ')} · Not an automatic fault alert</p>
    {analysis.possible_explanations?.length>0&&<><h4>Possible operating causes</h4><ul>{analysis.possible_explanations.map((x,i)=><li key={i}>{x}</li>)}</ul></>}
    {analysis.recommended_checks?.length>0&&<><h4>Suggested checks</h4><ul>{analysis.recommended_checks.map((x,i)=><li key={i}>{x}</li>)}</ul></>}
    <details><summary>Agent retrieval trace · {analysis.trace?.length||0} tools</summary>
     <ol>{analysis.trace?.map((x,i)=><li key={i}><strong>{x.tool}</strong> — {x.reason} ({x.source})</li>)}</ol>
    </details>
    <details><summary>Evidence inspected · {analysis.evidence?.length||0} sources</summary>
     {analysis.evidence?.map((x,i)=><div key={i}><strong>{x.id} · {x.tool}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:'0.78rem'}}>{JSON.stringify(x,null,2)}</pre></div>)}
    </details>
    <details><summary>Limitations</summary><ul>{analysis.limitations?.map((x,i)=><li key={i}>{x}</li>)}</ul></details>
   </article>}
  </section>

  <section className="room-ai-block">
   <h3>Separate one-month forecasting pipeline</h3>
   <p>Qwen estimates one sensor value one calendar month ahead. With limited history, it returns a clearly labelled exploratory scenario rather than a validated prediction.</p>
   <div className="room-ai-actions">
    <button type="button" className="room-ai-primary" disabled={!!busy||!eligible} onClick={()=>void run('forecast')}>
     {busy==='forecast'?'Forecasting…':'Forecast +1 month'}
    </button>
   </div>
   {!eligible&&<p className="room-ai-subtle">Choose temperature, humidity, CO₂, light or power to generate a numeric projection.</p>}
   {forecast&&<article className="room-ai-result" aria-live="polite">
    <strong>{forecast.status==='llm_projection'?'Historical-context projection':forecast.status==='exploratory_scenario'?'Low-evidence exploratory scenario':'Projection unavailable'}</strong>
    {typeof forecast.projected_value==='number'?<>
     <p className="room-ai-value">{print(forecast.projected_value,forecast.unit)}</p>
     <p>For {new Date(forecast.target_time).toLocaleString('en-MY',{timeZone:'Asia/Kuching',dateStyle:'medium',timeStyle:'short'})}</p>
     <p>Lower–upper illustrative scenarios: {print(forecast.lower_scenario,forecast.unit)} – {print(forecast.upper_scenario,forecast.unit)}</p>
     <p>Direction: {forecast.direction||'uncertain'} · {forecast.explanation}</p>
     {forecast.coverage&&<p className="room-ai-subtle">Evidence: {forecast.coverage.observed_samples} recent samples; {forecast.coverage.historical_months} reference months</p>}
    </>:<p>{forecast.reason||'Not enough valid information to display a projection.'}</p>}
    {forecast.assumptions?.length>0&&<details><summary>Projection assumptions</summary><ul>{forecast.assumptions.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
    <details><summary>Forecast limitations</summary><ul>{forecast.limitations?.map((x,i)=><li key={i}>{x}</li>)}</ul></details>
   </article>}
  </section>
  {busy&&<p className="room-ai-subtle" role="status">Running local Qwen… <button type="button" className="room-ai-secondary" onClick={()=>request.current?.abort()}>Cancel</button></p>}
  {error&&<p role="alert" className="room-ai-error">{error}</p>}
  <p className="room-ai-caution">Synthetic data only. The agent is read-only and cannot confirm a physical fault. Forecast scenarios are not calibrated confidence intervals. E8-A research accuracy does not transfer to this integration.</p>
 </div>;
}
