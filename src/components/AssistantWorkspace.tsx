import {useEffect,useRef,useState} from 'react';import {MessageCircle,X,ArrowUpRight,Send} from 'lucide-react';
import {AssistantMessage} from './AssistantMessage';
import {ASSETS,POINTS,useTwin} from '../services/twin';
import {RoomAIWorkspace} from './RoomAIWorkspace';
type Fact={id:string;text:string;point_code?:string;missing?:boolean;leak?:boolean};
type Response={answer:string;facts:Fact[];as_of:string|null;model_used:boolean;model_note:string;limitations:string[]};
type Turn={question:string;response?:Response;error?:string};
export function AssistantWorkspace({fullPage,onExpand,onSensor,draft}:{draft?:{question:string;scope:string;nonce:number}|null;fullPage:boolean;onExpand:()=>void;onSensor:(code:string)=>void}){
 const t=useTwin(),[scope,setScope]=useState('building'),[question,setQuestion]=useState(''),[turns,setTurns]=useState<Turn[]>([]),[busy,setBusy]=useState(false);const abort=useRef<AbortController|null>(null);
 const [assistantView,setAssistantView]=useState<'building'|'room'>('building');
 useEffect(()=>{if(draft){setScope(draft.scope);setQuestion(draft.question)}},[draft?.nonce]);
 const messagesEnd=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{messagesEnd.current?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})},[turns,busy]);
 useEffect(()=>()=>abort.current?.abort(),[]);
 const pending=useRef(false);
 const ask=async(q:string)=>{
  if(!q.trim()||busy||pending.current)return;pending.current=true;setBusy(true);setQuestion('');const index=turns.length;setTurns(old=>[...old,{question:q}]);abort.current=new AbortController();
  try{const r=await fetch('/api/assistant/building',{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.current.signal,body:JSON.stringify({scope,question:q,window_minutes:60})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to answer');setTurns(old=>old.map((x,i)=>i===index?{...x,response:d}:x))}catch(e){setTurns(old=>old.map((x,i)=>i===index?{...x,error:String(e)}:x))}finally{pending.current=false;setBusy(false)}
 };
 const panel=<section className={fullPage?'surface assistant-workspace':'surface assistant-panel assistant-workspace'} aria-label="Building assistant conversation"><div className="assistant-head"><MessageCircle size={21}/><div><strong>{assistantView==='building'?'Building assistant':'Qwen room AI'}</strong><p>{assistantView==='building'?'Whole building, locations and sensor evidence':'Validated sensor analysis and one-month prediction'}</p></div>{!fullPage&&<><button className="small-outline" aria-label="Open assistant page" onClick={()=>{t.setAssistantOpen(false);onExpand()}}><ArrowUpRight size={16}/></button><button className="close-icon" aria-label="Close assistant" onClick={()=>t.setAssistantOpen(false)}><X size={18}/></button></>}</div>
 <div className="assistant-ai-tabs" role="tablist" aria-label="Assistant features">
  <button type="button" role="tab" aria-selected={assistantView==='building'} onClick={()=>setAssistantView('building')}>Building evidence</button>
  <button type="button" role="tab" aria-selected={assistantView==='room'} onClick={()=>setAssistantView('room')}>Qwen room AI + 1-month forecast</button>
 </div>
 {assistantView==='building'?<>
 <div className="assistant-scope"><label>Evidence scope<select aria-label="Assistant scope" value={scope} onChange={e=>setScope(e.target.value)} disabled={busy}><option value="building">Whole building</option>{ASSETS.map(a=><option key={a} value={a}>{POINTS.find(p=>p.assetId===a)?.locationLabel}</option>)}{POINTS.map(p=><option key={p.code} value={p.code}>{p.locationLabel} · {p.label}</option>)}</select></label><small>Answers use a fresh snapshot when you send a question. Chat stays here when you change pages.</small></div>
 <div className="assistant-messages">{!turns.length&&<div className="chat-welcome"><h2>Understand your building</h2><p>Ask about indoor readings, virtual weather, holidays or applied operating settings.</p><div className="prompt-chips">{['Summarise the whole building','Compare office and meeting CO2','What is the outdoor weather?','Which sensors have missing readings?'].map(q=><button key={q} onClick={()=>void ask(q)}>{q}</button>)}</div></div>}
 {turns.map((turn,i)=><article className="chat-turn" key={i}><div className="message message-user">{turn.question}</div>{turn.error&&<p role="alert">{turn.error}</p>}{turn.response&&<div className="chat-answer"><AssistantMessage text={turn.response.answer}/><small className="answer-source">{turn.response.model_note}</small><h3>Supporting evidence</h3><ul className="evidence-list">{turn.response.facts.map(f=><li key={f.id}><AssistantMessage text={f.text}/>{f.point_code&&<button className="text-link" onClick={()=>onSensor(f.point_code!)}>View sensor in twin <ArrowUpRight size={12}/></button>}</li>)}</ul><details><summary>Evidence time and limitations</summary><p>{turn.response.as_of?new Date(turn.response.as_of).toLocaleString():'No indoor data yet'}</p>{turn.response.limitations.map(x=><p key={x}>{x}</p>)}</details></div>}</article>)}
 {busy&&<p role="status">Retrieving building evidence… <button className="text-link" onClick={()=>abort.current?.abort()}>Cancel</button></p>}<div ref={messagesEnd}/></div>
 <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void ask(question)}}><textarea rows={2} aria-label="Ask the building assistant" maxLength={900} placeholder="Ask about your building…" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(question)}}}/><button aria-label="Send question" disabled={busy||!question.trim()}><Send size={16}/></button></form><p className="assistant-note">Synthetic evidence · AI evidence selection when Ollama is available · no confirmed diagnosis</p></>:<RoomAIWorkspace onSensor={onSensor}/>}</section>;
 return <>{!fullPage&&<button className="ask-floating" aria-label="Open building assistant" aria-expanded={t.assistantOpen} onClick={()=>t.setAssistantOpen(!t.assistantOpen)}><MessageCircle size={17}/> Building assistant</button>}{(fullPage||t.assistantOpen)&&panel}</>;
}

