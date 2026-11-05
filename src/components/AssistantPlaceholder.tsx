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
 status:'ok'|'insufficient_history';sensor_id:string;sensor_type:string;unit:string;
 target_time:string;as_of:string;horizon_hours:1|24;expected_value:number|null;
 historical_range:{p10:number;p90:number}|null;historical_days:number;
 minimum_required_days:number;historical_source:string;method:string;
 reason:string;note:string;limitations:string[];trained_forecast:false;
};
type ChatItem={id:string;role:'user'|'analysis'|'prediction'|'error';createdAt:string;
 text?:string;answer?:Answer;prediction?:Prediction};
type ChatThread={id:string;roomId:string;title:string;createdAt:string;messages:ChatItem[]};
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
 const available=p.status==='ok'&&typeof p.expected_value==='number';
 return <article className="twin-ai-result" aria-label="Historical expected reading">
  <div className={`twin-ai-status ${available?'twin-ai-status-estimate':'twin-ai-status-insufficient_evidence'}`}>
   <strong>{available?'Historical expected reading':'Not enough historical data'}</strong>
   <span>{p.sensor_type==='co2'?'CO₂':p.sensor_type} · +{p.horizon_hours} hour{p.horizon_hours===1?'':'s'} · {readableDate(p.target_time)}</span>
  </div>
  {available&&<div className="twin-ai-prediction-value">
   <span>Typical value at target time</span><strong>{formatValue(p.expected_value,p.unit)}</strong>
   <small>Empirical historical 10th–90th percentile: {formatValue(p.historical_range?.p10,p.unit)} – {formatValue(p.historical_range?.p90,p.unit)}</small>
  </div>}
  <div className="twin-ai-section"><h4>Evidence</h4>
   <p>{p.reason}</p><p>{p.historical_days} comparable earlier normal dates (minimum {p.minimum_required_days}).</p>
   <p>Source: {p.historical_source.replaceAll('_',' ')}.</p>
  </div>
  <div className="twin-ai-caution">Historical baseline estimate only — <strong>not a trained future forecast</strong>. The empirical range is not a prediction confidence interval.</div>
  <details className="twin-ai-details"><summary>Method and limitations</summary>
   <p>{p.method}</p><ul>{(p.limitations||[]).map((x,i)=><li key={i}>{x}</li>)}</ul></details>
  <button className="twin-ai-export" onClick={()=>downloadJSON(p,'room-expected-reading.json')}>Download estimate (JSON)</button>
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
 const [predictionHorizon,setPredictionHorizon]=useState<1|24>(1);
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
 const ask=(text:string)=>{
  try {
   const as_of=cutoff();const codes=new Set(POINTS.filter(p=>p.assetId===t.selectedRoom).map(p=>p.code));
   const current=Object.values(t.readings).filter(r=>codes.has(r.point_code));
   const snapshot=source==='what_if'?current:t.history.filter(r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=Date.parse(as_of)).slice(-1500);
   void run(text,'analysis',{room_id:t.selectedRoom,question:text,source,as_of,snapshot:source==='http'?undefined:snapshot});
  }catch(ex){setError(ex instanceof Error?ex.message:'No observations available.');}
 };
 const predict=()=>{
  if(!selectedPredictionCode)return;
  try{
   const as_of=cutoff();const target=eligible.find(p=>p.code===selectedPredictionCode)!;
   const label=target.sensorType==='co2'?'CO₂':target.label.toLowerCase();
   void run(`Estimate expected ${label} in +${predictionHorizon} hour${predictionHorizon===1?'':'s'} from comparable history.`,
    'prediction',{room_id:t.selectedRoom,sensor_id:selectedPredictionCode,horizon_hours:predictionHorizon,source,as_of});
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
     <p>Get a concise, source-backed interpretation or estimate a typical future-time sensor value from historical normal readings.</p>
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
     {['Summarise this room','Are any readings unusual?','Why this comfort score?'].map(q=><button key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}
    </div>
    {eligible.length>0&&<div className="twin-ai-predict-controls" aria-label="Historical expected reading">
     <div className="twin-ai-predict-heading"><strong>Estimate a sensor reading</strong><small>Comparable normal-history baseline · not a trained forecast</small></div>
     <div className="twin-ai-predict-row">
      <select aria-label="Sensor for expected reading" disabled={busy} value={selectedPredictionCode} onChange={e=>setPredictionCode(e.target.value)}>
       {eligible.map(p=><option key={p.code} value={p.code}>{p.sensorType==='co2'?'CO₂':p.label}</option>)}
      </select>
      <select aria-label="Expected reading horizon" disabled={busy} value={predictionHorizon} onChange={e=>setPredictionHorizon(Number(e.target.value) as 1|24)}>
       <option value={1}>+1 hour</option><option value={24}>+24 hours</option>
      </select>
      <button type="button" disabled={busy} onClick={predict}>Estimate</button>
     </div>
    </div>}
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
