import {useEffect,useRef,useState} from 'react';
import {AssistantMessage} from './AssistantMessage';
import {ASSETS,POINTS,useTwin} from '../services/twin';
import '../room-ai-velvet.css';

type Analysis={status:string;numeric_verification_passed?:boolean;human_review_required?:boolean;result?:{
 finding?:string;evidence?:string[];possible_explanations?:string[];recommended_checks?:string[];limitations?:string[]}};
type Prediction={status:string;projected_value?:number|null;lower_scenario?:number|null;upper_scenario?:number|null;direction?:string;
 target_time?:string;unit?:string;explanation?:string;reason?:string;limitations?:string[]};
type Score={sensor_id:string;unit:string;MAE:number|null;RMSE:number|null;WAPE_pct:number|null;
 valid_predictions:number;planned_cases:number;skill_vs_persistence_pct:number|null};
type Evaluation={status:string;message?:string;summary?:Score[]};
const numeric=(value:number|null|undefined,unit='')=>
 typeof value==='number'&&Number.isFinite(value)?value.toFixed(2)+(unit?' '+unit:''):'Not available';

export function RoomAIWorkspace({onSensor}:{onSensor:(code:string)=>void}){
 const twin=useTwin();
 const [question,setQuestion]=useState('Are any sensor readings in this room unusual?');
 const [predictionCode,setPredictionCode]=useState('');
 const [analysis,setAnalysis]=useState<Analysis|null>(null);
 const [prediction,setPrediction]=useState<Prediction|null>(null);
 const [health,setHealth]=useState<{connected:boolean;historical_reference_available?:boolean}>({connected:false});
 const [evaluation,setEvaluation]=useState<Evaluation>({status:'not_evaluated'});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const abort=useRef<AbortController|null>(null),requestId=useRef(0);
 const points=POINTS.filter(point=>point.assetId===twin.selectedRoom);
 const forecastSensors=points.filter(point=>['temperature','humidity','co2'].includes(point.sensorType));
 const chosen=forecastSensors.find(point=>point.code===predictionCode)||forecastSensors[0];
 const source=twin.scenario?'what_if':twin.replayTime!==null?'historical_replay':twin.demo||twin.mode==='random'?'browser_demo':'http';
 useEffect(()=>{
  let active=true;
  const refresh=()=>fetch('/api/assistant/health').then(r=>r.json()).then(data=>{if(active)setHealth(data)}).catch(()=>{if(active)setHealth({connected:false})});
  refresh();
  const poll=setInterval(refresh,20000);
  fetch('/api/assistant/evaluation',{cache:'no-store'}).then(r=>r.json()).then(data=>{if(active)setEvaluation(data)}).catch(()=>{if(active)setEvaluation({status:'not_evaluated'})});
  return()=>{active=false;clearInterval(poll)};
 },[]);
 useEffect(()=>{requestId.current++;abort.current?.abort();setBusy(false);setError('');setAnalysis(null);setPrediction(null)},[twin.selectedRoom,source]);
 useEffect(()=>()=>abort.current?.abort(),[]);
 const cutoff=()=>{
  const latest=twin.replayTime??Math.max(...Object.values(twin.readings).filter(r=>points.some(p=>p.code===r.point_code)).map(r=>Date.parse(r.timestamp)));
  if(!Number.isFinite(latest))throw Error('No sensor readings available. Start the simulator first.');
  return new Date(latest).toISOString();
 };
 const run=async(kind:'analysis'|'prediction')=>{
  if(busy)return;
  const id=++requestId.current;setError('');setAnalysis(null);setPrediction(null);
  try{
   const as_of=cutoff();
   if(kind==='prediction'&&(!chosen||source!=='http'))throw Error('One-month prediction requires a supported sensor and connected HTTP readings.');
   if(kind==='analysis'&&!question.trim())throw Error('Enter an analysis question.');
   const codes=new Set(points.map(p=>p.code));
   const history=source==='historical_replay'?
    twin.history.filter(r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=Date.parse(as_of)).slice(-1500):
    Object.values(twin.readings).filter(r=>codes.has(r.point_code));
   const payload=kind==='analysis'?
    {room_id:twin.selectedRoom,question:question.trim(),source,as_of,...(source==='http'?{}:{snapshot:history})}:
    {room_id:twin.selectedRoom,sensor_id:chosen!.code,horizon_months:1,source,as_of};
   abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);
   const reply=await fetch(kind==='analysis'?'/api/assistant/ask':'/api/assistant/predict',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)});
   const result=await reply.json();if(!reply.ok)throw Error(result.error||'The local AI service returned an error.');
   if(id===requestId.current){if(kind==='analysis')setAnalysis(result as Analysis);else setPrediction(result as Prediction)}
  }catch(e){if(id===requestId.current)setError(e instanceof Error?e.message:'Unable to contact Qwen.')}
  finally{if(id===requestId.current)setBusy(false)}
 };
 const matchingScores=(evaluation.summary||[]).filter(r=>forecastSensors.some(p=>p.code===r.sensor_id));
 return <div className="room-ai-velvet" aria-label="Qwen validated room analysis and one-month forecasting">
  <header className="room-ai-intro"><strong>Qwen3 1.7B · Room AI</strong>
   <p>Analyse sensor behaviour or predict one reading one calendar month ahead.</p>
   <span className={health.connected?'room-ai-connected':'room-ai-offline'}>{health.connected?'Local model connected':'Local model unavailable'}</span>
   <small>Historical normal database: {health.historical_reference_available?'available':'not available or not confirmed'}</small>
  </header>
  <label className="room-ai-field">Monitoring location
   <select aria-label="Room AI monitoring location" value={twin.selectedRoom} onChange={e=>twin.setSelectedRoom(e.target.value)}>
    {ASSETS.map(asset=><option value={asset} key={asset}>{POINTS.find(p=>p.assetId===asset)?.locationLabel||asset}</option>)}
   </select>
  </label>
  <section className="room-ai-block"><h3>Anomaly assessment</h3>
   <p>Qwen analyses the selected room using historical comparisons. The backend verifies its output and may request human review.</p>
   <form onSubmit={e=>{e.preventDefault();void run('analysis')}}>
    <label className="room-ai-field">Question
     <input aria-label="Room anomaly question" value={question} maxLength={900} onChange={e=>setQuestion(e.target.value)} placeholder="Is CO₂ unusually high?"/>
    </label>
    <button type="submit" className="room-ai-primary" disabled={busy||!question.trim()}>Analyse selected room</button>
   </form>
   {analysis&&<article className="room-ai-result" aria-live="polite">
    <strong>Status: {analysis.status.replaceAll('_',' ')}</strong>
    <AssistantMessage text={analysis.result?.finding||'No verified finding returned.'}/>
    <p className="room-ai-subtle">Numerical verification: {analysis.numeric_verification_passed?'passed':'not fully verified'} · Human review: {analysis.human_review_required?'required':'not required'}</p>
    {analysis.result?.evidence?.length?<details><summary>Verified sensor evidence</summary><ul>{analysis.result.evidence.map((x,i)=><li key={i}>{x}</li>)}</ul></details>:null}
    {analysis.result?.possible_explanations?.length?<details><summary>Possible explanations</summary><ul>{analysis.result.possible_explanations.map((x,i)=><li key={i}>{x}</li>)}</ul></details>:null}
    {analysis.result?.recommended_checks?.length?<details open><summary>Recommended checks</summary><ul>{analysis.result.recommended_checks.map((x,i)=><li key={i}>{x}</li>)}</ul></details>:null}
    {analysis.result?.limitations?.length?<details><summary>Limitations</summary><ul>{analysis.result.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></details>:null}
   </article>}
  </section>
  <section className="room-ai-block"><h3>One-month LLM prediction</h3>
   <p>Qwen generates the projected value using historical monthly sensor summaries. Scenario bounds are illustrative, not confidence intervals.</p>
   <label className="room-ai-field">Sensor
    <select aria-label="One-month prediction sensor" value={chosen?.code||''} disabled={!forecastSensors.length} onChange={e=>setPredictionCode(e.target.value)}>
     {forecastSensors.map(p=><option value={p.code} key={p.code}>{p.label} · {p.code}</option>)}
    </select>
   </label>
   <div className="room-ai-actions">
    <button type="button" className="room-ai-primary" disabled={busy||source!=='http'||!chosen} onClick={()=>void run('prediction')}>Predict +1 month</button>
    {chosen&&<button type="button" className="room-ai-secondary" onClick={()=>onSensor(chosen.code)}>View sensor in twin</button>}
   </div>
   {source!=='http'&&<p className="room-ai-subtle">Forecasting requires connected HTTP mode. Disable browser demo, replay and what-if modes to proceed.</p>}
   {!forecastSensors.length&&<p className="room-ai-subtle">This location does not have a supported temperature, humidity or CO₂ sensor.</p>}
   {prediction&&<article className="room-ai-result" aria-live="polite">
    <strong>{prediction.status==='llm_projection'?'LLM one-month projection':prediction.status.replaceAll('_',' ')}</strong>
    {prediction.status==='llm_projection'?<>
     <p className="room-ai-value">{numeric(prediction.projected_value,prediction.unit)}</p>
     <p>Target: {prediction.target_time?new Date(prediction.target_time).toLocaleString('en-MY',{timeZone:'Asia/Kuching'}):'Unknown'}</p>
     <p>Lower–upper scenarios: {numeric(prediction.lower_scenario,prediction.unit)} – {numeric(prediction.upper_scenario,prediction.unit)}</p>
     <p>Direction: {prediction.direction||'uncertain'}</p><p>{prediction.explanation}</p>
    </>:<p>{prediction.reason||'No valid projection could be produced.'}</p>}
    {prediction.limitations?.length?<details><summary>Prediction limitations</summary><ul>{prediction.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></details>:null}
   </article>}
  </section>
  {busy&&<p className="room-ai-subtle" role="status">Running Qwen locally… <button className="room-ai-secondary" onClick={()=>abort.current?.abort()}>Cancel</button></p>}
  {error&&<p role="alert" className="room-ai-error">{error}</p>}
  <details className="room-ai-backtest"><summary>One-month backtest accuracy</summary>
   {matchingScores.length?<div className="room-ai-scores">{matchingScores.map(row=><p key={row.sensor_id}>
    <strong>{row.sensor_id}</strong> · MAE {numeric(row.MAE,row.unit)} · RMSE {numeric(row.RMSE,row.unit)} · WAPE {numeric(row.WAPE_pct,'%')} · Skill vs persistence {numeric(row.skill_vs_persistence_pct,'%')} · {row.valid_predictions}/{row.planned_cases} valid predictions
   </p>)}</div>:<p>{evaluation.message||'No evaluated forecast results for this room yet. Run the local one-month backtest.'}</p>}
  </details>
  <p className="room-ai-caution">Synthetic readings only. This tool supports investigation, not confirmed fault diagnosis. Forecast accuracy requires separate ground-truth evaluation.</p>
 </div>;
}

