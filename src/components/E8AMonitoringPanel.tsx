import {AlertTriangle,ArrowUpRight,BrainCircuit,CheckCircle2,Clock3,ShieldAlert} from 'lucide-react';
import {POINTS,displayTime} from '../services/twin';
import {useE8AMonitoring,e8aAttention,e8aLabel,type E8AResult} from '../services/e8a';

function assessmentClass(row:E8AResult){
 return row.assessment==='verified_anomaly'?'danger':row.assessment==='verified_suspect'||
  row.assessment==='screening_needs_review'?'warning':row.assessment==='verified_normal'?'normal':'unknown';
}
export function E8AMonitoringPanel({compact=false,onFocus,onViewAll,onAssistant}:{
 compact?:boolean;onFocus?:(code:string)=>void;onViewAll?:()=>void;onAssistant?:()=>void;
}){
 const state=useE8AMonitoring(compact?15000:9000);
 const important=state.results.filter(e8aAttention);
 const rows=[...important,...state.results.filter(r=>!e8aAttention(r))].slice(0,compact?2:18);
 return <section className={'surface e8a-surface '+(compact?'e8a-compact':'e8a-full')} aria-label="E8-A agentic anomaly monitoring">
  <div className="e8a-heading"><div><span className="e8a-overline"><BrainCircuit size={13}/> E8-A · AGENTIC RAG</span>
   <h2>{compact?'Automatic anomaly assessment':'Autonomous sensor screening'}</h2>
   <p>{compact?'Screening and evidence-verified findings':'Qwen3 1.7B · screening → causal trajectory → LLM-selected tools → independently verified review'}</p></div>
   {onViewAll&&<button type="button" className="text-link" onClick={onViewAll}>All E8-A results <ArrowUpRight size={12}/></button>}
  </div>
  <div className="e8a-status">
   <span className={'e8a-state-dot '+(state.connected?'available':'offline')}/>
   <span>{!state.enabled?'Monitoring disabled':state.connected?
    state.running?'Evaluating sensor · sequential local inference':'E8-A worker available':
    'E8-A not connected'}</span>
   <small>{state.results.length}/{state.sensors_supported||'—'} evaluated</small>
  </div>
  {!state.connected&&<p className="e8a-unavailable">{state.error||'Start Ollama and the E8-A bridge; existing sensor alerts are unaffected.'}</p>}
  {state.connected&&!state.results.length&&<p className="e8a-waiting"><Clock3 size={15}/> Awaiting the first completed E8-A evaluation. The screen does not assume sensors are normal.</p>}
  {!!state.results.length&&<div className="e8a-results">
   {rows.map(r=>{
    const p=POINTS.find(x=>x.code===r.point_code);
    return <article className={'e8a-result e8a-'+assessmentClass(r)} key={r.point_code}>
     <div className="e8a-result-top"><span className="e8a-result-icon">{e8aAttention(r)?<AlertTriangle size={15}/>:r.assessment==='verified_normal'?<CheckCircle2 size={15}/>:<ShieldAlert size={15}/>}</span>
      <div><strong>{p?.locationLabel||r.location} · {p?.label||r.sensor_type}</strong>
      <small>{r.point_code} · observed {displayTime(r.as_of)}</small></div></div>
     <div className="e8a-channels"><span>Screening: <b>{r.screening_status}</b></span>
      <span>Verified: <b>{r.evidence_status==='grounded'?r.verified_status:'unknown'}</b></span></div>
     <p className="e8a-result-status">{e8aLabel(r)}</p>
     {!compact&&<div className="e8a-explanation">
      <p><b>Initial screening:</b> {r.screening?.explanation||'Not supplied'}</p>
      <p><b>Independent verification:</b> {r.evidence_status==='grounded'?
       r.verification?.explanation||'Grounded evidence returned.':
       'Insufficient or ungrounded evidence; the initial screening is retained for human review.'}</p>
      <small>Evidence: {r.evidence_status} · {r.source_observation_count} five-minute observed samples · {r.elapsed_seconds??'—'}s processing</small>
      <details><summary>Retrieval trace and validation</summary>
       <p>Tools: {(r.trace||[]).map(x=>x.tool).filter(Boolean).join(' → ')||'No optional tools'}</p>
       <p>Numerically grounded comparisons: {(r.validation?.validated_comparisons||[]).filter(x=>x.valid).length}</p>
       <p>Repair attempted: {r.review_audit?.repair_attempted?'yes':'no'}</p>
       <pre>{JSON.stringify({validation:r.validation,trace:r.trace},null,2)}</pre>
      </details>
     </div>}
     <div className="e8a-result-actions">{onFocus&&<button className="text-link" onClick={()=>onFocus(r.point_code)}>Locate sensor <ArrowUpRight size={12}/></button>}
      {!compact&&onAssistant&&<button className="text-link" onClick={onAssistant}>Ask building assistant <ArrowUpRight size={12}/></button>}</div>
    </article>;
   })}
  </div>}
  {!compact&&<p className="e8a-method-note">E8-A uses the exact research screening/retrieval/verification workflow on causal, synthetic five-minute samples. Grounded citations are not evidence of a confirmed physical fault. Automatic rule alerts and one-month forecasts remain separate. Sensors are processed sequentially to avoid exhausting local M1 memory.</p>}
  {compact&&<small className="e8a-footnote">{important.length?
   important.length+' sensor assessment(s) need attention.':'No positive E8-A assessment in completed checks.'} Not all sensors may have been evaluated yet.</small>}
 </section>;
}
