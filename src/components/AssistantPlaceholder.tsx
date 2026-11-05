import {useEffect,useMemo,useRef,useState, type PointerEvent as ReactPointerEvent} from 'react';
import {Bot,MessageCircle,X,History,SquarePen,Maximize2,Minimize2,Trash2,Grip} from 'lucide-react';
import {useTwin,POINTS} from '../services/twin';
import {roomEvidence} from '../services/experienceMath.js';
import {roomTitle} from '../viewer/sensorPresentation.js';

// Each request is independently assessed. Saved chat history is a local, per-room
// transcript; previous chat turns are NOT silently provided to the LLM as evidence.
type SensorFact={sensor_id:string;sensor_type:string;unit?:string;last?:number;average?:number;historical_median?:number|null;historical_days?:number};
type Answer={
 status?:'alert'|'no_alert'|'review_required'|'insufficient_evidence'|'validation_failed';
 numeric_verification_passed?:boolean;semantic_conflict?:boolean;human_review_required?:boolean;
 verified_evidence?:{sensors?:SensorFact[];as_of?:string};
 decision_assessment?:Record<string,unknown>;
 result:{finding:string;evidence:string[];possible_explanations:string[];recommended_checks:string[];limitations:string[]};
 model:string;elapsed_seconds:number;as_of:string;tool_trace:unknown[];
 reference_source:string;observation_source:string;
};
type Prediction={
 status:'llm_projection'|'insufficient_history'|'validation_failed'|'ok';
 sensor_id:string;sensor_type:string;unit:string;model:string;
 target_time:string;as_of:string;horizon_months:number;horizon_hours?:number;expected_value?:number|null;
 projected_value:number|null;lower_scenario:number|null;upper_scenario:number|null;
 direction:'increasing'|'decreasing'|'stable'|'uncertain';
 explanation:string;assumptions:string[];limitations:string[];
 method:string;reason:string;trained_forecast:false;
 data_basis:string;numeric_output_check:string;
 observed_trends?:{current_http:Array<{month:string;mean:number;samples:number}>;historical_normal:Array<{month:string;mean:number;samples:number}>};
 coverage?:{recent_http_days:number;recent_http_months:number;recent_http_span_days:number;
  historical_normal_days:number;historical_normal_months:number;
  minimum_days_for_horizon:number;minimum_months_for_horizon:number;
  latest_reading:number|null;latest_time:string|null;reference_last_reading_time:string|null};
};
type ChatItem={id:string;role:'user'|'analysis'|'prediction'|'error';createdAt:string;
 text?:string;answer?:Answer;prediction?:Prediction};
type ChatThread={id:string;roomId:string;title:string;createdAt:string;messages:ChatItem[]};
type EvaluationMetric={sensor_id:string;unit:string;valid_predictions:number;planned_cases:number;
 MAE:number|null;RMSE:number|null;bias:number|null;WAPE_pct:number|null;
 accuracy_score_pct:number|null;skill_vs_persistence_pct:number|null;prediction_success_pct:number|null;
 skill_vs_seasonal_naive_pct?:number|null;skill_vs_recent_mean_pct?:number|null;
 ground_truth_coverage_pct?:number|null};
type EvaluationReport={status:string;horizon_months?:number;ground_truth_year?:number;
 summary?:EvaluationMetric[];message?:string;partial_run?:boolean;expected_planned_cases?:number;overall?:{planned_cases:number;valid_predictions:number}};

const HISTORY_KEY='twinlabs_room_ai_history_v1';
const SIZE_KEY='twinlabs_room_ai_size_v1';
const newId=()=>`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const readableDate=(value?:string)=>{
 if(!value)return '—';const date=new Date(value);
 return Number.isNaN(date.valueOf())?'—':date.toLocaleString();
};
const formatValue=(value:unknown,unit='')=>typeof value==='number'&&Number.isFinite(value)
 ?`${Number(value.toFixed(2)).toLocaleString()}${unit?' '+unit:''}`:'—';
const statusLabels:Record<string,{label:string;description:string}>={
 alert:{label:'Investigation recommended',description:'Available model and rule evidence support further checking.'},
 no_alert:{label:'No issue flagged',description:'No alert under the available evidence; this does not prove the room is fault-free.'},
 review_required:{label:'Human review needed',description:'The evidence, model or independent rule does not support an automatic conclusion.'},
 insufficient_evidence:{label:'More evidence needed',description:'A defensible historical assessment is not available for this snapshot.'},
 validation_failed:{label:'Answer could not be verified',description:'The source measurements remain available, but the model response did not pass validation.'},
};
function loadHistory():ChatThread[]{
 try {
  const parsed:unknown=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
  if(!Array.isArray(parsed))return [];
  return parsed.filter((t):t is ChatThread=>Boolean(t&&typeof t==='object'&&
   typeof (t as ChatThread).id==='string'&&typeof (t as ChatThread).roomId==='string'&&
   typeof (t as ChatThread).title==='string'&&Array.isArray((t as ChatThread).messages)))
   .slice(0,30).map(t=>({...t,messages:t.messages.slice(-50)}));
 }catch{return []}
}
function loadSize(){
 try{const s=JSON.parse(localStorage.getItem(SIZE_KEY)||'{}');
  return {width:Math.max(360,Math.min(920,Number(s.width)||430)),height:Math.max(440,Math.min(900,Number(s.height)||650))};
 }catch{return {width:430,height:650}}
}
function downloadJSON(value:unknown,name:string){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function AnalysisCard({answer}:{answer:Answer}){
 const status=statusLabels[answer.status||'']||{label:'Assessment available',description:'Review the supplied evidence.'};
 const facts=answer.verified_evidence?.sensors||[];
 return <article className="twin-ai-result" aria-label="AI room assessment">
  <div className={`twin-ai-status twin-ai-status-${answer.status||'unknown'}`}>
   <strong>{status.label}</strong><span>{status.description}</span>
  </div>
  <div className="twin-ai-section"><h4>Summary</h4><p className="twin-ai-finding">{answer.result?.finding||'No validated finding available.'}</p></div>
  {facts.length>0&&<div className="twin-ai-facts" aria-label="Verified sensor readings">
   {facts.slice(0,6).map(f=><div className="twin-ai-fact" key={f.sensor_id}>
    <span>{f.sensor_type==='co2'?'CO₂':f.sensor_type.replaceAll('_',' ')}</span>
    <strong>{formatValue(f.last,f.unit)}</strong>
    <small>{f.historical_median==null?'Historical baseline unavailable':`Historical median: ${formatValue(f.historical_median,f.unit)}`}</small>
   </div>)}
  </div>}
  {!!answer.result?.recommended_checks?.length&&<div className="twin-ai-section">
   <h4>Recommended checks</h4>
   <ul>{answer.result.recommended_checks.slice(0,4).map((check,i)=><li key={i}>{check}</li>)}</ul>
  </div>}
  {!!answer.result?.possible_explanations?.length&&<details className="twin-ai-details"><summary>Possible explanations (hypotheses)</summary>
   <ul>{answer.result.possible_explanations.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
  <details className="twin-ai-details"><summary>Measurements and historical evidence</summary>
   <ul>{(answer.result?.evidence||[]).map((x,i)=><li key={i}>{x}</li>)}</ul>
  </details>
  <details className="twin-ai-details"><summary>Limitations</summary>
   <ul>{(answer.result?.limitations||[]).map((x,i)=><li key={i}>{x}</li>)}</ul>
  </details>
  <div className="twin-ai-audit-summary">
   <span>Numbers: {answer.numeric_verification_passed?'verified':'not fully verified'}</span>
   <span>Review: {answer.human_review_required?'required':'not required'}</span>
  </div>
  <details className="twin-ai-details"><summary>Technical validation and trace</summary>
   <pre>{JSON.stringify({decision_assessment:answer.decision_assessment,semantic_conflict:answer.semantic_conflict,
    model:answer.model,elapsed_seconds:answer.elapsed_seconds,as_of:answer.as_of,
    observation_source:answer.observation_source,tool_trace:answer.tool_trace},null,2)}</pre></details>
  <button className="twin-ai-export" onClick={()=>downloadJSON(answer,'room-answer.json')}>Download evidence (JSON)</button>
 </article>;
}
function PredictionCard({prediction:p}:{prediction:Prediction}){
 // Preserve accurate labels for pre-upgrade 1h/24h entries in browser chat history.
 if(p.status==='ok'&&typeof p.expected_value==='number')return <article className="twin-ai-result" aria-label="Legacy historical expected reading">
  <div className="twin-ai-status"><strong>Earlier historical baseline estimate</strong><span>+{p.horizon_hours||'?'} hours · {readableDate(p.target_time)}</span></div>
  <div className="twin-ai-prediction-value"><span>Historical expected reading (not LLM-generated)</span><strong>{formatValue(p.expected_value,p.unit)}</strong></div>
  <div className="twin-ai-caution">Saved before the LLM long-range projection update. This was a deterministic historical estimate, not a future forecast.</div>
 </article>;
 const available=p.status==='llm_projection'&&typeof p.projected_value==='number';
 const label=p.sensor_type==='co2'?'CO₂':p.sensor_type;
 return <article className="twin-ai-result" aria-label="One-month LLM sensor projection">
  <div className={`twin-ai-status ${available?'twin-ai-status-estimate':'twin-ai-status-insufficient_evidence'}`}>
   <strong>{available?'Speculative LLM sensor projection':p.status==='validation_failed'?'Projection output not valid':'Insufficient data for a projection'}</strong>
   <span>{label} · +{p.horizon_months} month{p.horizon_months===1?'':'s'} · {readableDate(p.target_time)}</span>
  </div>
  {available&&<div className="twin-ai-prediction-value">
   <span>Qwen3 proposed future reading (not verified)</span><strong>{formatValue(p.projected_value,p.unit)}</strong>
   <small>Illustrative low–high scenarios: {formatValue(p.lower_scenario,p.unit)} – {formatValue(p.upper_scenario,p.unit)}</small>
   <small>Suggested trend: {p.direction}</small>
  </div>}
  <div className="twin-ai-section"><h4>{available?'Why Qwen3 projects this':'Why no projection is shown'}</h4>
   <p>{available?p.explanation:p.reason}</p>
  </div>
  <div className="twin-ai-section"><h4>Data behind this answer</h4>
   <p>Latest HTTP reading: {formatValue(p.coverage?.latest_reading,p.unit)} · {readableDate(p.coverage?.latest_time||undefined)}</p>
   <p>Recent HTTP: {p.coverage?.recent_http_days??0} distinct days; historical normal reference: {p.coverage?.historical_normal_days??0} days.</p>
   <p>Minimum for +{p.horizon_months} months: {p.coverage?.minimum_days_for_horizon??'—'} days across {p.coverage?.minimum_months_for_horizon??'—'} months.</p>
   <p>Projection basis: {p.data_basis?.replaceAll('_',' ')||'not available'}.</p>
  </div>
  {(p.observed_trends?.historical_normal?.length||p.observed_trends?.current_http?.length)?<details className="twin-ai-details">
   <summary>Observed monthly trends used (not forecasts)</summary>
   {(['current_http','historical_normal'] as const).map(key=><div key={key}>
    <p>{key==='current_http'?'Connected HTTP readings':'Older synthetic normal history'}</p>
    <div className="twin-ai-trend-grid"><div className="twin-ai-trend-row twin-ai-trend-header"><strong>Month</strong><strong>Mean</strong><strong>Samples</strong></div>
     {(p.observed_trends?.[key]||[]).map(row=><div className="twin-ai-trend-row" key={`${key}-${row.month}`}>
      <span>{row.month}</span><span>{formatValue(row.mean,p.unit)}</span><span>{row.samples}</span></div>)}
    </div>
   </div>)}</details>:null}
  <div className="twin-ai-caution"><strong>Exploratory LLM scenario only.</strong> Future numbers cannot be verified today. This is not a trained or validated forecasting model, and the low–high scenarios are not confidence intervals.</div>
  {!!p.assumptions?.length&&<details className="twin-ai-details"><summary>Assumptions</summary><ul>{p.assumptions.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
  <details className="twin-ai-details"><summary>Limitations and data quality</summary>
   <ul>{(p.limitations||[]).map((x,i)=><li key={i}>{x}</li>)}</ul>
   <p>Output verification: {p.numeric_output_check?.replaceAll('_',' ')||'not checked'}. This does not verify future accuracy.</p>
  </details>
  <button className="twin-ai-export" onClick={()=>downloadJSON(p,'room-llm-trend-projection.json')}>Download projection (JSON)</button>
 </article>;
}

export function AssistantPlaceholder(){
 const t=useTwin();
 const [question,setQuestion]=useState('');
 const [threads,setThreads]=useState<ChatThread[]>(loadHistory);
 const [activeId,setActiveId]=useState<string|null>(null);
 const [showHistory,setShowHistory]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [seconds,setSeconds]=useState(0);
 const [expanded,setExpanded]=useState(false);
 const [panelSize,setPanelSize]=useState(loadSize);
 const [predictionCode,setPredictionCode]=useState('');
 const [evaluation,setEvaluation]=useState<EvaluationReport>({status:'not_evaluated',summary:[]});
 const [health,setHealth]=useState<{connected:boolean;model:string;historical_reference_available?:boolean;error?:string}>({connected:false,model:'qwen3:1.7b'});
 const request=useRef(0);
 const abort=useRef<AbortController|null>(null);
 const messageEnd=useRef<HTMLDivElement|null>(null);
 const point=POINTS.find(p=>p.assetId===t.selectedRoom)!;
 const eligible=POINTS.filter(p=>p.assetId===t.selectedRoom&&['temperature','humidity','co2'].includes(p.sensorType));
 const selectedPredictionCode=eligible.some(p=>p.code===predictionCode)?predictionCode:eligible[0]?.code||'';
 const roomThreads=useMemo(()=>threads.filter(x=>x.roomId===t.selectedRoom),[threads,t.selectedRoom]);
 const currentThread=activeId==='__new__'?null:
  (roomThreads.find(x=>x.id===activeId)||roomThreads[0]||null);
 const roomScores=(evaluation.summary||[]).filter(x=>eligible.some(p=>p.code===x.sensor_id));
 const source=t.scenario?'what_if':t.replayTime!==null?'historical_replay':t.demo||t.mode==='random'?'browser_demo':'http';
 const evidence=roomEvidence(POINTS,t.readings,t.selectedRoom);

 useEffect(()=>{
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(threads.slice(0,30).map(x=>({...x,messages:x.messages.slice(-50)}))))}catch{/* Browser storage can be disabled or full. */}
 },[threads]);
 useEffect(()=>{
  try{localStorage.setItem(SIZE_KEY,JSON.stringify(panelSize))}catch{/* Optional preference */}
 },[panelSize]);
 useEffect(()=>{
  const update=()=>fetch('/api/assistant/health').then(r=>r.json()).then(setHealth).catch(()=>setHealth({connected:false,model:'qwen3:1.7b',error:'Website API unavailable'}));
  void update();const timer=window.setInterval(update,20000);return()=>window.clearInterval(timer);
 },[]);
 useEffect(()=>{
  request.current++;abort.current?.abort();setBusy(false);setError('');setQuestion('');setShowHistory(false);setActiveId(null);
 },[t.selectedRoom,source,t.replayTime]);
 const refreshEvaluation=async()=>{
  try{
   const response=await fetch('/api/assistant/evaluation',{cache:'no-store'});
   if(!response.ok)throw Error('The evaluation report is unavailable.');
   setEvaluation(await response.json());
  }catch{setEvaluation({status:'not_evaluated',summary:[],message:'No valid evaluation report found. Run the local one-month backtest first.'});}
 };
 useEffect(()=>{
  if(!t.assistantOpen)return;
  let active=true;
  fetch('/api/assistant/evaluation',{cache:'no-store'}).then(response=>{
   if(!response.ok)throw Error('Evaluation service unavailable');return response.json();
  }).then(data=>{if(active)setEvaluation(data)}).catch(()=>{if(active)setEvaluation({status:'not_evaluated',summary:[]})});
  return()=>{active=false};
 },[t.assistantOpen]);
 useEffect(()=>()=>{request.current++;abort.current?.abort()},[]);
 useEffect(()=>{
  if(!busy)return;const timer=window.setInterval(()=>setSeconds(s=>s+1),1000);return()=>window.clearInterval(timer);
 },[busy]);
 useEffect(()=>{messageEnd.current?.scrollIntoView({block:'end'})},[currentThread?.messages.length,busy]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')t.setAssistantOpen(false)};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[t.setAssistantOpen]);
 const startMessage=(text:string):string=>{
  const threadId=currentThread?.id||newId();const at=new Date().toISOString();
  const userItem:ChatItem={id:newId(),role:'user',text,createdAt:at};
  setThreads(old=>{
   const existing=old.find(x=>x.id===threadId);
   if(existing)return old.map(x=>x.id===threadId?{...x,messages:[...x.messages,userItem].slice(-50)}:x);
   return [{id:threadId,roomId:t.selectedRoom,title:text.slice(0,65),createdAt:at,messages:[userItem]},...old].slice(0,30);
  });
  setActiveId(threadId);setShowHistory(false);setError('');return threadId;
 };
 const finishMessage=(threadId:string,item:ChatItem)=>setThreads(old=>old.map(x=>x.id===threadId?
  {...x,messages:[...x.messages,item].slice(-50)}:x));
 const run=async(text:string,kind:'analysis'|'prediction',payload:Record<string,unknown>)=>{
  if(busy||!text.trim())return;
  const id=++request.current;abort.current=new AbortController();
  const threadId=startMessage(text);setBusy(true);setSeconds(0);setQuestion('');
  try {
   const url=kind==='analysis'?'/api/assistant/ask':'/api/assistant/predict';
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.current.signal,body:JSON.stringify(payload)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');
   if(id===request.current)finishMessage(threadId,kind==='analysis'?
    {id:newId(),role:'analysis',answer:data as Answer,createdAt:new Date().toISOString()}:
    {id:newId(),role:'prediction',prediction:data as Prediction,createdAt:new Date().toISOString()});
  }catch(ex){
   if(id===request.current){const message=ex instanceof Error?ex.message:'Request failed';setError(message);
    finishMessage(threadId,{id:newId(),role:'error',text:message,createdAt:new Date().toISOString()});}
  }finally{if(id===request.current)setBusy(false)}
 };
 const cutoff=()=>{
  const current=Object.values(t.readings).filter(r=>POINTS.some(p=>p.assetId===t.selectedRoom&&p.code===r.point_code));
  const time=t.replayTime??Math.max(...current.map(r=>Date.parse(r.timestamp)));
  if(!Number.isFinite(time))throw Error('No sensor readings at this cutoff. Start the simulator first.');
  return new Date(time).toISOString();
 };
 const forecastFromQuestion=(text:string)=>{
  if(!/\b(predict|forecast|project|estimate)\b/i.test(text))return null;
  const m=text.match(/\b(\d+)\s*(months?|years?)\b/i);
  if(!m)return null;
  const horizon=m[2].toLowerCase().startsWith('year')?Number(m[1])*12:Number(m[1]);
  if(horizon!==1)return {error:'Only +1 month projections are supported. Choose one month to request an LLM projection.'};
  const lower=text.toLowerCase().replaceAll('co₂','co2');
  const requestedType=lower.includes('co2')||lower.includes('carbon dioxide')?'co2':
   lower.includes('temperature')?'temperature':lower.includes('humid')?'humidity':null;
  const sensor=eligible.find(p=>p.sensorType===requestedType) || eligible.find(p=>p.code===selectedPredictionCode);
  return sensor?{sensor_id:sensor.code,horizon_months:horizon}:null;
 };
 const ask=(text:string)=>{
  try {
   const forecast=forecastFromQuestion(text);
   if(forecast){
    if('error' in forecast)throw Error(forecast.error);
    if(source!=='http')throw Error('One-month projections require Live connected HTTP sensor data.');
    void run(text,'prediction',{room_id:t.selectedRoom,...forecast,source,as_of:cutoff()});
    return;
   }

   const as_of=cutoff();const codes=new Set(POINTS.filter(p=>p.assetId===t.selectedRoom).map(p=>p.code));
   const current=Object.values(t.readings).filter(r=>codes.has(r.point_code));
   const snapshot=source==='what_if'?current:t.history.filter(r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=Date.parse(as_of)).slice(-1500);
   void run(text,'analysis',{room_id:t.selectedRoom,question:text,source,as_of,snapshot:source==='http'?undefined:snapshot});
  }catch(ex){setError(ex instanceof Error?ex.message:'No observations available.');}
 };
 const predict=()=>{
  if(!selectedPredictionCode||source!=='http')return;
  try{
   const as_of=cutoff();const target=eligible.find(p=>p.code===selectedPredictionCode)!;
   const label=target.sensorType==='co2'?'CO₂':target.label.toLowerCase();
   void run(`Project ${label} trend in +1 month using current and historical sensor trends.`,
    'prediction',{room_id:t.selectedRoom,sensor_id:selectedPredictionCode,horizon_months:1,source,as_of});
  }catch(ex){setError(ex instanceof Error?ex.message:'No observations available.');}
 };
 const newChat=()=>{request.current++;abort.current?.abort();setBusy(false);setError('');setQuestion('');setActiveId('__new__');setShowHistory(false)};
 const resizeStart=(event:ReactPointerEvent<HTMLButtonElement>)=>{
  if(expanded)return;
  event.preventDefault();const origin={x:event.clientX,y:event.clientY,width:panelSize.width,height:panelSize.height};
  const move=(e:PointerEvent)=>setPanelSize({width:Math.max(360,Math.min(window.innerWidth-85,origin.width+origin.x-e.clientX)),
   height:Math.max(440,Math.min(window.innerHeight-100,origin.height+origin.y-e.clientY))});
  const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
 };
 return <>
  <button className="ask-floating" aria-expanded={t.assistantOpen} aria-label={t.assistantOpen?'Close room assistant':'Open room assistant'}
   onClick={()=>t.setAssistantOpen(!t.assistantOpen)}><MessageCircle size={17}/>Room assistant</button>
  {t.assistantOpen&&<aside className={`assistant-panel twinlabs-assistant evidence-panel twin-ai-chat ${expanded?'twin-ai-expanded':''}`}
   style={expanded?undefined:{width:panelSize.width,height:panelSize.height}} role="dialog" aria-label="Room evidence assistant">
   <button className="twin-ai-resize" aria-label="Drag to resize chat panel" title="Drag up and left to resize chat"
    onPointerDown={resizeStart}><Grip size={16}/></button>
   <header className="assistant-head twin-ai-head">
    <Bot size={22}/><div className="twin-ai-room-title"><strong>{roomTitle(point)}</strong><span>AI room assistant · local evidence</span></div>
    <button type="button" title="Conversation history" aria-label="Conversation history" aria-pressed={showHistory} onClick={()=>setShowHistory(x=>!x)}><History size={17}/></button>
    <button type="button" title="New chat" aria-label="New chat" onClick={newChat}><SquarePen size={17}/></button>
    <button type="button" title={expanded?'Restore chat size':'Expand chat'} aria-label={expanded?'Restore chat size':'Expand chat'} onClick={()=>setExpanded(x=>!x)}>
     {expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>
    <button className="close-icon" aria-label="Close room assistant" onClick={()=>t.setAssistantOpen(false)}><X size={19}/></button>
   </header>
   <div className="model-connection twin-ai-connection">
    <span>{health.connected?'● Qwen3 1.7B connected':'○ Qwen3 1.7B offline'} · P2 Concise · Evidence-validated analysis</span>
    <small>{health.historical_reference_available?'Normal-history database detected':'Historical baseline not connected'}{health.error?` · ${health.error}`:''}</small>
   </div>
   {showHistory&&<section className="twin-ai-history" aria-label="Saved room conversations">
    <div className="twin-ai-history-heading"><strong>Chat history · {roomTitle(point)}</strong><button onClick={newChat}>New</button></div>
    {roomThreads.length?roomThreads.map(thread=><div className={`twin-ai-thread ${currentThread?.id===thread.id?'is-active':''}`} key={thread.id}>
     <button className="twin-ai-thread-open" onClick={()=>{request.current++;abort.current?.abort();setBusy(false);setActiveId(thread.id);setShowHistory(false)}}>
      <span>{thread.title}</span><small>{readableDate(thread.createdAt)}</small></button>
     <button className="twin-ai-thread-delete" title="Delete conversation" aria-label={`Delete conversation: ${thread.title}`} onClick={()=>{
      setThreads(old=>old.filter(x=>x.id!==thread.id));if(activeId===thread.id)setActiveId('__new__');}}><Trash2 size={15}/></button>
    </div>):<p className="twin-ai-empty">No saved conversations for this room.</p>}
    <small>Saved only in this browser. Chat history is not sent to the model as evidence.</small>
   </section>}
   <div className="assistant-messages twin-ai-scroll">
    {!currentThread?.messages.length&&<div className="twin-ai-intro">
     <strong>Ask about this room</strong>
     <p>Get source-backed room analysis or an exploratory Qwen3 one-month sensor projection based on available trends.</p>
    </div>}
    {currentThread?.messages.map(item=><div key={item.id} className={`twin-ai-turn twin-ai-turn-${item.role}`}>
     {item.role==='user'&&<p>{item.text}</p>}
     {item.role==='error'&&<p role="alert">{item.text}</p>}
     {item.role==='analysis'&&item.answer&&<AnalysisCard answer={item.answer}/>}
     {item.role==='prediction'&&item.prediction&&<PredictionCard prediction={item.prediction}/>}
    </div>)}
    {busy&&<p role="status" className="twin-ai-loading">Retrieving evidence and preparing response… {seconds}s</p>}
    {error&&!busy&&<p role="alert" className="twin-ai-inline-error">{error}</p>}
    <div ref={messageEnd}/>
   </div>
   <div className="twin-ai-controls">
    <div className="prompt-chips twin-ai-prompts">
     {['Summarise this room','Are any readings unusual?','Predict CO₂ in 1 month'].map(q=><button key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}
    </div>
    {eligible.length>0&&<div className="twin-ai-predict-controls" aria-label="LLM-only long-range sensor projection">
     <div className="twin-ai-predict-heading"><strong>One-month LLM sensor projection</strong><small>Qwen3 interprets monthly trends · speculative, not a trained forecast</small></div>
     {source!=='http'&&<p className="twin-ai-predict-note">Switch to Live connected HTTP readings to project a one-month trend. Demo, replay and what-if values are not accepted.</p>}
     <div className="twin-ai-predict-row">
      <select aria-label="Sensor for trend projection" disabled={busy||source!=='http'} value={selectedPredictionCode} onChange={e=>setPredictionCode(e.target.value)}>
       {eligible.map(p=><option key={p.code} value={p.code}>{p.sensorType==='co2'?'CO₂':p.label}</option>)}
      </select>
      <span className="twin-ai-horizon-label" aria-label="Projection horizon: one month">+1 month</span>
      <button type="button" disabled={busy||source!=='http'} onClick={predict}>Project</button>
     </div>
    </div>}
    <details className="twin-ai-evaluation" aria-label="One-month ground-truth backtest accuracy">
     <summary>One-month backtest accuracy · 2025</summary>
     <div className="twin-ai-evaluation-head">
      <small>Normal synthetic ground truth · predictions from Qwen3 1.7B</small>
      {evaluation.partial_run&&<small>Partial/smoke-test evaluation: not a full-period accuracy result ({evaluation.overall?.planned_cases||0} / {evaluation.expected_planned_cases||'—'} scheduled cases).</small>}
      <button type="button" onClick={()=>void refreshEvaluation()}>Refresh</button>
     </div>
     {roomScores.length ? <div className="twin-ai-evaluation-grid">
      {roomScores.map(row=><div className="twin-ai-evaluation-metric" key={row.sensor_id}>
       <strong>{eligible.find(p=>p.code===row.sensor_id)?.label||row.sensor_id}</strong>
       <div className="twin-ai-evaluation-score">{row.accuracy_score_pct==null?'—':row.accuracy_score_pct.toFixed(1)+'%'} <small>accuracy index</small></div>
       <small>MAE: {formatValue(row.MAE,row.unit)} · RMSE: {formatValue(row.RMSE,row.unit)}</small>
       <small>{row.valid_predictions} valid / {row.planned_cases} planned cases · Success: {row.prediction_success_pct==null?'—':row.prediction_success_pct.toFixed(1)+'%'}</small>
       <small>Skill vs latest-reading baseline: {row.skill_vs_persistence_pct==null?'—':row.skill_vs_persistence_pct.toFixed(1)+'%'}</small>
       {row.skill_vs_recent_mean_pct!==undefined&&<small>Skill vs 7-day mean: {row.skill_vs_recent_mean_pct==null?'—':row.skill_vs_recent_mean_pct.toFixed(1)+'%'}</small>}
       {row.skill_vs_seasonal_naive_pct!==undefined&&<small>Skill vs weekday/time baseline: {row.skill_vs_seasonal_naive_pct==null?'—':row.skill_vs_seasonal_naive_pct.toFixed(1)+'%'}</small>}
       {row.ground_truth_coverage_pct!==undefined&&<small>Ground-truth coverage: {row.ground_truth_coverage_pct==null?'—':row.ground_truth_coverage_pct.toFixed(1)+'%'}</small>}
      </div>)}
     </div> : <p className="twin-ai-predict-note"><strong>Not evaluated.</strong> {evaluation.message||'Run scripts/evaluate_llm_one_month.py with your 2023–2025 SQLite and Ollama, then refresh.'}</p>}
     <small>Accuracy index = max(0, 100 − WAPE%). This is not classification accuracy. MAE/RMSE are primary; these results are from synthetic data only, not installed sensors.</small>
    </details>
    <form className="assistant-composer twin-ai-compose" onSubmit={e=>{e.preventDefault();ask(question)}}>
     <input maxLength={900} disabled={busy} aria-label="Ask about selected room" placeholder={`Ask about ${roomTitle(point)}…`}
      value={question} onChange={e=>setQuestion(e.target.value)}/>
     <button disabled={busy||!question.trim()} type="submit" aria-label="Ask Qwen">➜</button>
    </form>
   </div>
   <footer className="twin-ai-footer">{evidence.length} configured sensors · {source.replaceAll('_',' ')} · Local browser chat history</footer>
  </aside>}
 </>;
}
