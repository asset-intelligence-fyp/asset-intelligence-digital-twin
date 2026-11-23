import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowRight,BarChart3,BrainCircuit,CheckCircle2,ChevronDown,Clock3,Database,ExternalLink,FileText,History,Info,Layers3,MessageSquareText,RefreshCw,Search,ShieldAlert,Sparkles,TrendingUp,WifiOff,X} from 'lucide-react';
import {ASSETS,POINTS,useTwin,readingLabel,type Reading} from '../services/twin';
import '../room-ai-velvet.css';

type Mode = 'report'|'forecast'|'investigate';
type Model = 'qwen3:1.7b'|'qwen3:4b';
type Point = (typeof POINTS)[number];
type Evidence = {id:string;tool:string;[key:string]:unknown};
type Trace = {tool:string;reason:string;source:string};
type Analysis = {
 status:string;sensor_id:string;assessment:string;finding:string;
 possible_explanations:string[];recommended_checks:string[];
 evidence:Evidence[];trace:Trace[];limitations:string[];
 llm_used:boolean;as_of?:string;cited_evidence_ids?:string[];
};
type Projection = {
 status:string;sensor_id:string;unit:string;model?:string;target_time:string;
 projected_value?:number;lower_scenario?:number;upper_scenario?:number;
 explanation?:string;reason?:string;direction?:string;
 limitations:string[];assumptions?:string[];
 coverage?:{observed_samples:number;span_minutes:number;historical_months:number};
};
type Health = {connected:boolean;agentic_supported?:boolean;model?:string;
 available_forecast_models?:string[];historical_reference_available?:boolean;
 history_status?:string;error?:string};
type AnalysisRun = {sensor:string;source:string;asOf:string;data:Analysis;completed:string};
type ForecastRun = {sensor:string;source:string;asOf:string;data:Projection;completed:string;model:Model};
const DEFAULT_QUESTION = 'Explain the latest readings using historical patterns and available occupancy, HVAC and weather context. Distinguish observations from hypotheses.';
const MODELS:Model[]=['qwen3:1.7b','qwen3:4b'];

function prettyDate(value?:string) {
 if(!value)return '—';
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toLocaleString('en-MY',{timeZone:'Asia/Kuching',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
}
function numeric(value:number|undefined,unit='') {
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-MY',{maximumFractionDigits:2})+(unit?' '+unit:''):'Not available';
}
function active(reading?:Reading) {
 return !!reading&&typeof reading.value==='number'&&Number.isFinite(reading.value)&&Number.isFinite(Date.parse(reading.timestamp))&&
  !['missing','invalid','bad','error','fault'].includes((reading.quality||'').toLowerCase());
}
function assessmentLabel(value:string) {
 if(value==='explained_variation')return 'Contextual variation';
 if(value==='investigate')return 'Further review suggested';
 return 'Evidence incomplete';
}
function groupLabel(asset:string) {return POINTS.find(p=>p.assetId===asset)?.locationLabel||asset;}
function trendRecords(history:Reading[],code:string) {
 return history.filter(r=>r.point_code===code&&active(r)).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-480);
}
function SensorChart({history,code,projection}:{history:Reading[];code:string;projection?:Projection|null}) {
 const points=useMemo(()=>trendRecords(history,code),[history,code]);
 if(points.length<2)return <div className="bi-chart-empty"><History size={22}/><strong>Not enough history for a trend</strong><span>Start the simulator or load saved readings. No synthetic chart values are added.</span></div>;
 const sampled=points.length>100?points.filter((_,i)=>i%Math.ceil(points.length/100)===0||i===points.length-1):points;
 const ys=sampled.map(x=>x.value as number);
 const predicted=typeof projection?.projected_value==='number'&&Number.isFinite(projection.projected_value)?projection.projected_value:null;
 const lo=Math.min(...ys,...(predicted===null?[]:[predicted]));
 const hi=Math.max(...ys,...(predicted===null?[]:[predicted]));
 const pad=Math.max((hi-lo)*.15,.5);
 const lower=lo-pad,upper=hi+pad;
 const y=(v:number)=>148-(v-lower)/(upper-lower)*116;
 const first=Date.parse(sampled[0].timestamp),last=Date.parse(sampled[sampled.length-1].timestamp);
 const span=Math.max(1,last-first);
 const x=(d:number)=>28+(d-first)/span*234;
 const polyline=sampled.map((r,i)=>(i===0?'M':'L')+x(Date.parse(r.timestamp)).toFixed(1)+' '+y(r.value as number).toFixed(1)).join(' ');
 const lastY=y(sampled[sampled.length-1].value as number);
 return <div className="bi-chart">
  <div className="bi-chart-legend"><span><i className="bi-legend-line"/>Observed historical readings</span>{predicted!==null&&<span><i className="bi-legend-dot"/>One future estimate</span>}</div>
  <svg viewBox="0 0 400 178" role="img" aria-label={'Observed trend for '+code+(predicted!==null?', with one projected future reading':'')} preserveAspectRatio="none">
   <line x1="28" y1="32" x2="378" y2="32" className="bi-gridline"/>
   <line x1="28" y1="90" x2="378" y2="90" className="bi-gridline"/>
   <line x1="28" y1="148" x2="378" y2="148" className="bi-gridline"/>
   <text x="4" y="34" className="bi-axis-label">{upper.toFixed(1)}</text>
   <text x="4" y="149" className="bi-axis-label">{lower.toFixed(1)}</text>
   <path d={polyline} className="bi-trend-path"/>
   <circle cx="262" cy={lastY} r="4" className="bi-trend-point"/>
   {predicted!==null&&<>
    <path d={'M262 '+lastY+' L360 '+y(predicted)} className="bi-projection-guide"/>
    <circle cx="360" cy={y(predicted)} r="5.5" className="bi-projection-point"/>
   </>}
   <text x="28" y="172" className="bi-axis-label">{prettyDate(sampled[0].timestamp)}</text>
   <text x="262" y="172" textAnchor="end" className="bi-axis-label">{prettyDate(sampled[sampled.length-1].timestamp)}</text>
   {predicted!==null&&<text x="360" y="172" textAnchor="middle" className="bi-axis-label">+1 month</text>}
  </svg>
  {predicted!==null&&<p className="bi-chart-caption">The dashed connector is a visual link only. It does not represent intermediate predictions or a validated confidence interval.</p>}
 </div>;
}

export function RoomAIWorkspace({onSensor,onEvidenceArchive,draft}:{onSensor:(code:string)=>void;onEvidenceArchive?:()=>void;draft?:{question:string;scope:string;nonce:number}|null}) {
 const twin=useTwin();
 const [mode,setMode]=useState<Mode>('report');
 const [sensorId,setSensorId]=useState('');
 const [question,setQuestion]=useState(DEFAULT_QUESTION);
 const [health,setHealth]=useState<Health>({connected:false});
 const [showConnection,setShowConnection]=useState(false);
 const [forecastModel,setForecastModel]=useState<Model>('qwen3:4b');
 const [busy,setBusy]=useState<'forecast'|'investigate'|null>(null);
 const [error,setError]=useState('');
 const [analysisRun,setAnalysisRun]=useState<AnalysisRun|null>(null);
 const [forecasts,setForecasts]=useState<ForecastRun[]>([]);
 const request=useRef<AbortController|null>(null);
 const points=POINTS.filter(p=>p.assetId===twin.selectedRoom);
 const selected=points.find(p=>p.code===sensorId)||points[0];
 const eligible=!!selected&&['temperature','humidity','co2','power','light'].includes(selected.sensorType);
 const source=twin.scenario?'what_if':twin.replayTime!==null?'historical_replay':twin.demo||twin.mode==='random'?'browser_demo':'http';
 const available=POINTS.filter(p=>active(twin.readings[p.code]));
 const latestTimestamp=available.length?new Date(Math.max(...available.map(p=>Date.parse(twin.readings[p.code].timestamp)))).toISOString():null;
 const selectionReading=selected?twin.readings[selected.code]:undefined;
 const selectedReading=active(selectionReading)?selectionReading:undefined;
 const lastDayAlerts=twin.events.filter(e=>Number.isFinite(Date.parse(e.time))&&latestTimestamp&&Date.parse(e.time)<=Date.parse(latestTimestamp)&&Date.parse(e.time)>=Date.parse(latestTimestamp)-86400000);
 const visibleAnalysis=analysisRun?.sensor===selected?.code&&analysisRun?.source===source?analysisRun:null;
 const currentForecasts=forecasts.filter(r=>r.sensor===selected?.code&&r.source===source);
 const currentForecast=currentForecasts.find(r=>r.model===forecastModel)||null;
 const comparison=currentForecasts.length>=2&&currentForecasts[0].asOf===currentForecasts[1].asOf;
 const modelInstalled=health.available_forecast_models?.includes(forecastModel)??false;
 const aiReady=health.connected||!!(health.agentic_supported&&health.available_forecast_models?.length);
 const latestStatus=latestTimestamp?'Latest observation '+prettyDate(latestTimestamp)+' MYT':'No timestamped readings';
 const refreshHealth=useCallback(async()=>{
  try{const r=await fetch('/api/assistant/health',{cache:'no-store'});if(!r.ok)throw Error('AI API unavailable');setHealth(await r.json());}
  catch{setHealth({connected:false,error:'Could not reach the local AI service.'});}
 },[]);
 useEffect(()=>{void refreshHealth();const timer=setInterval(()=>void refreshHealth(),20000);return()=>clearInterval(timer)},[refreshHealth]);
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{
  if(!draft)return;
  const point=POINTS.find(p=>p.code===draft.scope);
  const asset=point?.assetId||(ASSETS.includes(draft.scope)?draft.scope:null);
  if(asset)twin.setSelectedRoom(asset);
  if(point)setSensorId(point.code);
  if(draft.question)setQuestion(draft.question);
  setMode('investigate');
 },[draft?.nonce]);

 const execute=async(task:'investigate'|'forecast',point:Point,query:string,model:Model=forecastModel)=>{
  if(busy||request.current&&busy)return;
  request.current?.abort();
  const controller=new AbortController();request.current=controller;
  setBusy(task);setError('');
  if(task==='investigate'){setSensorId(point.code);twin.setSelectedRoom(point.assetId);setMode('investigate');}
  try {
   const codes=new Set(POINTS.filter(p=>p.assetId===point.assetId).map(p=>p.code));
   const latest=twin.replayTime??Math.max(...Object.values(twin.readings).filter(r=>codes.has(r.point_code)&&active(r)).map(r=>Date.parse(r.timestamp)));
   if(!Number.isFinite(latest))throw Error('No observations available. Start the simulator before requesting AI analysis.');
   const asOf=new Date(latest).toISOString();
   const snapshot=source==='historical_replay'
    ?twin.history.filter(r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=latest).slice(-18000)
    :Object.values(twin.readings).filter(r=>codes.has(r.point_code));
   const response=await fetch('/api/assistant/agentic/'+task,{
    method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({room_id:point.assetId,sensor_id:point.code,question:query,as_of:asOf,source,
     ...(task==='forecast'?{forecast_model:model}:{}),...(source==='http'?{}:{snapshot})}),
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'AI service returned an error');
   if(controller.signal.aborted)return;
   const completed=new Date().toISOString();
   if(task==='investigate')setAnalysisRun({sensor:point.code,source,asOf,data:result as Analysis,completed});
   else setForecasts(old=>[
    ...old.filter(r=>!(r.sensor===point.code&&r.source===source&&r.model===model)),
    {sensor:point.code,source,asOf,data:result as Projection,completed,model},
   ]);
  }catch(e){
   if(!controller.signal.aborted)setError(e instanceof Error?e.message:'AI request could not be completed');
  }finally{if(request.current===controller){request.current=null;setBusy(null);}}
 };
 const openInvestigation=(point:Point,query=DEFAULT_QUESTION)=>{setQuestion(query);void execute('investigate',point,query)};
 const reportPrimary=selected&&active(twin.readings[selected.code])?selected:available[0];
 const reportEvents=lastDayAlerts.slice(0,3);
 return <main className="room-ai-velvet bi-workspace" aria-label="TwinLabs building intelligence workspace">
  <div className="bi-page-header">
   <div className="bi-page-heading"><span className="bi-page-mark"><BrainCircuit size={21}/></span><div><span className="bi-overline">TWINLABS / AI INTELLIGENCE</span><h1>Building Intelligence</h1><p>Understand building conditions, investigate changes, and explore the next month.</p></div></div>
   <div className="bi-header-actions">
    <button type="button" className={'bi-connection '+(aiReady?'is-ready':'is-offline')} onClick={()=>setShowConnection(v=>!v)} aria-expanded={showConnection}>
     {aiReady?<CheckCircle2 size={15}/>:<WifiOff size={15}/>} {aiReady?'Local AI available':'Local AI unavailable'} <ChevronDown size={13}/>
    </button>
    {showConnection&&<div className="bi-connection-detail" role="region" aria-label="AI connection details">
     <div className="bi-mini-title">Local AI connections</div>
     <p>Qwen3 1.7B investigation: {health.connected?'Ready':'Not confirmed'}</p>
     <p>Agentic Python bridge: {health.agentic_supported?'Ready':'Unavailable'}</p>
     <p>Forecast models: {(health.available_forecast_models||[]).join(', ')||'None detected'}</p>
     <p>Historical reference: {health.historical_reference_available?'Configured':'Not configured or unconfirmed'}</p>
     {health.error&&<p className="bi-warning-line">{health.error}</p>}
     <button type="button" className="bi-link-button" onClick={()=>void refreshHealth()}><RefreshCw size={13}/> Recheck connection</button>
    </div>}
    {onEvidenceArchive&&<button type="button" className="bi-archive-link" onClick={onEvidenceArchive}><Database size={15}/> Evidence archive</button>}
   </div>
  </div>

  <div className="bi-summary">
   <div className="bi-summary-stat"><span>Sensor readings available</span><strong>{available.length}<small> / {POINTS.length}</small></strong><p>Latest readings in selected simulation mode</p></div>
   <div className="bi-summary-stat"><span>Monitored locations</span><strong>{ASSETS.length}</strong><p>BIM-mapped monitoring areas</p></div>
   <div className="bi-summary-stat"><span>Recorded alerts · 24 h</span><strong>{lastDayAlerts.length}</strong><p>Relative to latest sensor time; not fault diagnoses</p></div>
   <div className="bi-summary-stat"><span>Data provenance</span><strong className="bi-stat-text">{source==='http'?'HTTP simulator':source==='historical_replay'?'Historical replay':source==='what_if'?'What-if simulation':'Browser simulation'}</strong><p>{latestStatus}</p></div>
  </div>

  <nav className="bi-modes" aria-label="Building intelligence views">
   {([{id:'report',label:'Report',icon:FileText},{id:'forecast',label:'Forecast',icon:TrendingUp},{id:'investigate',label:'Investigate',icon:Search}] as const).map(m=>{
    const Icon=m.icon;
    return <button type="button" key={m.id} aria-current={mode===m.id?'page':undefined} className={mode===m.id?'is-active':''} onClick={()=>{setMode(m.id);setError('')}}><Icon size={16}/>{m.label}</button>;
   })}
  </nav>

  <div className="bi-context-strip">
   <div className="bi-context-fields">
    <label>Location<select value={twin.selectedRoom} onChange={e=>{twin.setSelectedRoom(e.target.value);setSensorId('');setError('')}}>{ASSETS.map(a=><option key={a} value={a}>{groupLabel(a)}</option>)}</select></label>
    <label>Sensor<select value={selected?.code||''} onChange={e=>{setSensorId(e.target.value);setError('')}}>{points.map(p=><option key={p.code} value={p.code}>{p.label} · {p.code}</option>)}</select></label>
   </div>
   <div className="bi-context-value"><span>Latest reading</span><strong>{selected&&selectedReading?readingLabel(selected.code,selectedReading):'No reading'}</strong><small>{selectedReading?prettyDate(selectedReading.timestamp)+' MYT':'Waiting for sensor data'} · Synthetic</small></div>
   <button className="bi-open-twin" type="button" disabled={!selected} onClick={()=>selected&&onSensor(selected.code)}><ExternalLink size={15}/> View in 3D</button>
  </div>

  {mode==='report'&&<section className="bi-report" aria-label="Building condition report">
   <div className="bi-section-heading"><div><span className="bi-eyebrow">CURRENT SNAPSHOT</span><h2>Building condition report</h2><p>Observed data and recorded events, not automatically inferred equipment faults.</p></div><span className="bi-section-time"><Clock3 size={14}/>{latestTimestamp?prettyDate(latestTimestamp)+' MYT':'Awaiting readings'}</span></div>
   <div className="bi-report-layout">
    <div className="bi-report-main">
     <div className="bi-section-heading bi-tight"><div><h3>Monitoring areas</h3><p>Choose a location to review its current readings or request an explanation.</p></div><span className="bi-muted-count">{ASSETS.length} locations</span></div>
     <div className="bi-location-grid">
      {ASSETS.map(asset=>{
       const sensors=POINTS.filter(p=>p.assetId===asset);
       const reporting=sensors.filter(p=>active(twin.readings[p.code]));
       const lead=sensors.find(p=>p.sensorType==='temperature')||sensors.find(p=>p.sensorType==='humidity')||sensors[0];
       const visible=sensors.filter(p=>active(twin.readings[p.code])).slice(0,3);
       return <article className={'bi-location-card '+(twin.selectedRoom===asset?'is-selected':'')} key={asset}>
        <div className="bi-location-top"><span className="bi-location-icon"><Layers3 size={16}/></span><span className="bi-location-status">{reporting.length}/{sensors.length} readings</span></div>
        <strong>{groupLabel(asset)}</strong><small>{asset} · Synthetic sensors</small>
        <div className="bi-location-readings">
         {visible.length?visible.map(p=><div key={p.code}><span>{p.label}</span><b>{readingLabel(p.code,twin.readings[p.code])}</b></div>):<span className="bi-unavailable">No current readings available</span>}
        </div>
        <div className="bi-location-actions">
         <button type="button" onClick={()=>{twin.setSelectedRoom(asset);setSensorId(lead.code);setMode('investigate')}}>View context <ArrowRight size={13}/></button>
         <button type="button" disabled={!active(twin.readings[lead.code])||!!busy} onClick={()=>openInvestigation(lead,'Summarize the current '+groupLabel(asset)+' readings, compare available history and operating context, and suggest evidence-based checks.')}>Explain <Sparkles size={13}/></button>
        </div>
       </article>;
      })}
     </div>
    </div>
    <aside className="bi-report-aside">
     <div className="bi-aside-heading"><Activity size={17}/><h3>Recent activity</h3></div>
     {reportEvents.length?reportEvents.map(e=><div className="bi-activity-item" key={e.id}><span className="bi-activity-dot"/><div><strong>{e.title}</strong><p>{e.description||'Synthetic rule event recorded.'}</p><small>{prettyDate(e.time)} MYT · Recorded event, not a confirmed fault</small>{e.point_code&&POINTS.some(p=>p.code===e.point_code)&&<button className="bi-link-button" onClick={()=>{const p=POINTS.find(x=>x.code===e.point_code)!;openInvestigation(p,'Review the historical context and current readings relevant to the recorded event. Do not assume the event proves a fault.')}}>Explain this <ArrowRight size={13}/></button>}</div></div>):<div className="bi-activity-empty"><ShieldAlert size={19}/><strong>No recorded alerts in this data window</strong><p>This does not establish that all systems are healthy.</p></div>}
     <div className="bi-aside-divider"/>
     <div className="bi-aside-heading"><BrainCircuit size={17}/><h3>AI insight</h3></div>
     {visibleAnalysis&&selected?.code===visibleAnalysis.sensor?<><span className="bi-assessment-chip">{assessmentLabel(visibleAnalysis.data.assessment)}</span><p className="bi-aside-finding">{visibleAnalysis.data.finding}</p><small>Saved result · {prettyDate(visibleAnalysis.completed)} MYT</small><button type="button" className="bi-link-button" onClick={()=>setMode('investigate')}>Open investigation <ArrowRight size={13}/></button></>:<>
      <p>Generate an evidence-based explanation for a selected sensor. Nothing is diagnosed before retrieval.</p>
      <button type="button" className="bi-primary" disabled={!reportPrimary||!!busy} onClick={()=>reportPrimary&&openInvestigation(reportPrimary)}><Sparkles size={15}/> Investigate selected sensor</button>
     </>}
    </aside>
   </div>
  </section>}

  {mode==='investigate'&&<section className="bi-work-view" aria-label="Contextual Agentic RAG investigation">
   <div className="bi-section-heading"><div><span className="bi-eyebrow">EVIDENCE-DRIVEN ANALYSIS</span><h2>Contextual investigation</h2><p>Qwen retrieves recent history and operational context before suggesting possible explanations.</p></div><span className="bi-pill">Advisory · not a fault diagnosis</span></div>
   <div className="bi-split">
    <aside className="bi-control-rail">
     <div className="bi-rail-title"><MessageSquareText size={17}/><h3>Investigate a reading</h3></div>
     <p>Start with a suggested investigation or ask a specific follow-up.</p>
     <div className="bi-preset-list">
      {[
       ['Explain current behaviour','Explain the latest sensor readings, trends, and relevant occupancy, HVAC and weather context. Separate observations from possible causes.'],
       ['Compare history','Compare the selected sensor with its available historical reference. What changed, and what is still unknown?'],
       ['Check related sensors','Investigate whether related room sensors provide evidence for the current change without assuming a fault.'],
      ].map(([label,q])=><button type="button" key={label} onClick={()=>{setQuestion(q);if(selected)void execute('investigate',selected,q)}} disabled={!!busy||!selectedReading}>{label}<ArrowRight size={13}/></button>)}
     </div>
     <label className="bi-question-label">Optional follow-up question<textarea value={question} maxLength={900} rows={3} onChange={e=>setQuestion(e.target.value)} placeholder="What caused this change?"/></label>
     <button type="button" className="bi-primary bi-full" disabled={!!busy||!selected||!selectedReading||!question.trim()} onClick={()=>selected&&void execute('investigate',selected,question)}><Search size={15}/>{busy==='investigate'?'Investigating…':'Run investigation'}</button>
     {!health.connected&&<small className="bi-helper">Qwen3 1.7B is not confirmed. The backend may return an evidence-only fallback if Ollama is unavailable.</small>}
    </aside>
    <div className="bi-results-canvas">
     {visibleAnalysis?<>
      <div className="bi-result-header"><span className="bi-assessment-chip">{assessmentLabel(visibleAnalysis.data.assessment)}</span><span>{visibleAnalysis.data.llm_used?'Qwen3 1.7B + retrieved evidence':'Retrieved evidence · model fallback'}</span></div>
      <h3>{visibleAnalysis.data.finding}</h3>
      <p className="bi-result-meta">Sensor {visibleAnalysis.sensor} · Observed cutoff {prettyDate(visibleAnalysis.asOf)} MYT · No confirmed fault implied</p>
      <SensorChart history={twin.history} code={visibleAnalysis.sensor}/>
      <div className="bi-finding-columns">
       <section><h4>Possible explanations</h4>{visibleAnalysis.data.possible_explanations?.length?<ul>{visibleAnalysis.data.possible_explanations.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>Insufficient evidence for a supported cause. Investigate operational context before diagnosing a fault.</p>}</section>
       <section><h4>Recommended checks</h4>{visibleAnalysis.data.recommended_checks?.length?<ul>{visibleAnalysis.data.recommended_checks.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>No additional recommendations available.</p>}</section>
      </div>
      <details className="bi-accordion"><summary><Database size={15}/> Evidence inspected · {visibleAnalysis.data.evidence?.length||0} sources <ChevronDown size={15}/></summary>{visibleAnalysis.data.evidence?.map((v,i)=><div className="bi-evidence-entry" key={v.id||i}><strong>{v.id} · {v.tool}</strong><pre>{JSON.stringify(v,null,2)}</pre></div>)}</details>
      <details className="bi-accordion"><summary><Layers3 size={15}/> Agentic retrieval trace · {visibleAnalysis.data.trace?.length||0} steps <ChevronDown size={15}/></summary><ol>{visibleAnalysis.data.trace?.map((v,i)=><li key={i}><strong>{v.tool}</strong> — {v.reason} ({v.source})</li>)}</ol></details>
      <details className="bi-accordion"><summary><Info size={15}/> Limitations and model transparency <ChevronDown size={15}/></summary><ul>{visibleAnalysis.data.limitations?.map((v,i)=><li key={i}>{v}</li>)}</ul></details>
     </>:<div className="bi-empty-state"><div className="bi-empty-symbol"><Search size={27}/></div><h3>Investigate what the building is showing</h3><p>Select a quick investigation to retrieve real synthetic readings and operating context. Evidence and findings will appear here.</p>{selected&&<div className="bi-empty-sensor"><Activity size={15}/>{selected.label}: {selectedReading?readingLabel(selected.code,selectedReading):'No reading available'}</div>}<SensorChart history={twin.history} code={selected?.code||''}/></div>}
    </div>
   </div>
  </section>}

  {mode==='forecast'&&<section className="bi-work-view" aria-label="Separate one-month forecasting workspace">
   <div className="bi-section-heading"><div><span className="bi-eyebrow">PREDICTIVE INTELLIGENCE</span><h2>One-month forecast</h2><p>Compare Qwen models using the same historical sensor evidence. Actual accuracy requires a held-out backtest.</p></div><span className="bi-pill bi-amber">Exploratory projection</span></div>
   <div className="bi-split">
    <aside className="bi-control-rail">
     <div className="bi-rail-title"><BarChart3 size={17}/><h3>Forecast setup</h3></div>
     <label className="bi-select-label">Local model<select value={forecastModel} onChange={e=>{setForecastModel(e.target.value as Model);setError('')}} disabled={!!busy}>{MODELS.map(m=><option key={m} value={m}>{m==='qwen3:4b'?'Qwen3 4B · Q4':'Qwen3 1.7B · Q4'}</option>)}</select></label>
     <div className="bi-rail-meta"><span>Forecast horizon</span><strong>+1 calendar month</strong></div>
     <div className="bi-rail-meta"><span>Input history</span><strong>{selected?trendRecords(twin.history,selected.code).length:0} visible observations <small>(up to 480 shown)</small></strong></div>
     <div className="bi-model-readiness">{modelInstalled?<><CheckCircle2 size={14}/> Model installed</>:<><Info size={14}/> Install with: ollama pull {forecastModel}</>}</div>
     <button type="button" className="bi-primary bi-full" disabled={!!busy||!eligible||!selectedReading} onClick={()=>selected&&void execute('forecast',selected,question,forecastModel)}><TrendingUp size={15}/>{busy==='forecast'?'Generating…':'Generate forecast'}</button>
     {!eligible&&<p className="bi-helper">Select a temperature, humidity, CO₂, light or power sensor.</p>}
     <p className="bi-helper">The site returns a single one-month-ahead reading, not 31 predicted daily readings. Lower and upper scenarios are not calibrated confidence intervals.</p>
    </aside>
    <div className="bi-results-canvas">
     {currentForecast?<>
      <div className="bi-result-header"><span className="bi-pill bi-amber">{currentForecast.data.status==='exploratory_scenario'?'Low-evidence scenario':currentForecast.data.status==='llm_projection'?'Exploratory projection':'Projection unavailable'}</span><span>{currentForecast.model} · Generated {prettyDate(currentForecast.completed)} MYT</span></div>
      {typeof currentForecast.data.projected_value==='number'?<>
       <div className="bi-forecast-value"><div><span>Projected reading</span><strong>{numeric(currentForecast.data.projected_value,currentForecast.data.unit)}</strong><small>Target {prettyDate(currentForecast.data.target_time)} MYT</small></div><div><span>Change from selected reading</span><strong>{selectedReading&&typeof selectedReading.value==='number'?numeric(currentForecast.data.projected_value-selectedReading.value,currentForecast.data.unit):'—'}</strong><small>Observed and projected timestamps differ</small></div></div>
       <SensorChart history={twin.history} code={currentForecast.sensor} projection={currentForecast.data}/>
       <p className="bi-forecast-explanation">{currentForecast.data.explanation||'No model explanation was provided.'}</p>
       {currentForecast.data.coverage&&<p className="bi-result-meta">Model evidence: {currentForecast.data.coverage.observed_samples} recent samples · {currentForecast.data.coverage.historical_months} historical reference months</p>}
       {!!currentForecast.data.assumptions?.length&&<div className="bi-forecast-assumptions"><h4>Model assumptions</h4><ul>{currentForecast.data.assumptions?.map((v,i)=><li key={i}>{v}</li>)}</ul></div>}
      </>:<div className="bi-empty-state bi-forecast-unavailable"><Info size={22}/><h3>Projection not available</h3><p>{currentForecast.data.reason||'The model did not return a valid estimate.'}</p></div>}
      {comparison&&<div className="bi-comparison"><h4>Same-cutoff model comparison</h4><div className="bi-comparison-rows">{currentForecasts.map(r=><div key={r.model}><span>{r.model}</span><strong>{numeric(r.data.projected_value,r.data.unit)}</strong></div>)}</div><small>Different model estimates do not establish accuracy. Compare with held-out actual values separately.</small></div>}
      <details className="bi-accordion"><summary><Info size={15}/> Forecast limitations and uncertainty <ChevronDown size={15}/></summary><ul>{currentForecast.data.limitations?.map((v,i)=><li key={i}>{v}</li>)}</ul></details>
     </>:<div className="bi-empty-state"><div className="bi-empty-symbol"><TrendingUp size={27}/></div><h3>A forecast grounded in past observations</h3><p>Select a supported sensor and generate a one-month-ahead projection. The historical trend stays visible without fabricating future points.</p><SensorChart history={twin.history} code={selected?.code||''}/></div>}
    </div>
   </div>
  </section>}
  {busy&&<div className="bi-running" role="status"><Activity size={16}/>Local Qwen is processing evidence. This may take time on your Mac.<button type="button" onClick={()=>{request.current?.abort();request.current=null;setBusy(null)}}><X size={13}/> Cancel</button></div>}
  {error&&<div className="bi-error" role="alert"><Info size={16}/>{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
  <footer className="bi-footer"><Info size={14}/>Synthetic building evidence · AI assessments are advisory, not fault diagnoses · Forecast scenarios are not confidence intervals · E8-A benchmark accuracy does not transfer to the website adapter.</footer>
 </main>;
}
