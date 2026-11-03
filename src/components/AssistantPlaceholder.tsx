import {useState,useEffect,useRef} from 'react';
import {Bot,MessageCircle,X} from 'lucide-react';
import {useTwin,POINTS} from '../services/twin';
import {roomEvidence} from '../services/experienceMath.js';
import {roomTitle} from '../viewer/sensorPresentation.js';

type Answer={
 status?:'alert'|'no_alert'|'review_required'|'insufficient_evidence'|'validation_failed';
 numeric_verification_passed?:boolean;
 semantic_conflict?:boolean;
 human_review_required?:boolean;
 verified_evidence?:Record<string,unknown>;
 decision_assessment?:Record<string,unknown>;
 result:{
  finding:string;
  evidence:string[];
  possible_explanations:string[];
  recommended_checks:string[];
  limitations:string[];
 };
 model:string;
 elapsed_seconds:number;
 as_of:string;
 tool_trace:unknown[];
 reference_source:string;
 observation_source:string;
};

export function AssistantPlaceholder(){
 const t=useTwin();
 const [question,setQuestion]=useState('');
 const [asked,setAsked]=useState('');
 const [answer,setAnswer]=useState<Answer|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [seconds,setSeconds]=useState(0);

 const [health,setHealth]=useState<{
  connected:boolean;
  model:string;
  prompt?:string;
  retrieval?:string;
  error?:string;
 }>({connected:false,model:'qwen3:1.7b'});

 const request=useRef(0);
 const abort=useRef<AbortController|null>(null);
 const point=POINTS.find(p=>p.assetId===t.selectedRoom)!;

 const evidence:{
  point:typeof POINTS[number];
  reading?:{timestamp:string;value:number};
  display:{available:boolean;value:string;status:string};
 }[]=roomEvidence(POINTS,t.readings,t.selectedRoom);

 const source=t.scenario
  ?'what_if'
  :t.replayTime!==null
   ?'historical_replay'
   :t.demo||t.mode==='random'
    ?'browser_demo'
    :'http';

 useEffect(()=>{
  const update=()=>fetch('/api/assistant/health')
   .then(r=>r.json())
   .then(setHealth)
   .catch(()=>setHealth({
    connected:false,
    model:'qwen3:1.7b',
    error:'Website API unavailable'
   }));

  update();
  const timer=setInterval(update,20000);
  return()=>clearInterval(timer);
 },[]);

 useEffect(()=>{
  request.current++;
  abort.current?.abort();
  setAsked('');
  setQuestion('');
  setAnswer(null);
  setError('');
  setBusy(false);
 },[t.selectedRoom,source,t.replayTime]);

 useEffect(()=>()=>{
  request.current++;
  abort.current?.abort();
 },[]);

 useEffect(()=>{
  if(!busy)return;
  const timer=setInterval(()=>setSeconds(s=>s+1),1000);
  return()=>clearInterval(timer);
 },[busy]);

 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape')t.setAssistantOpen(false);
  };
  window.addEventListener('keydown',key);
  return()=>window.removeEventListener('keydown',key);
 },[t.setAssistantOpen]);

 const ask=async(q:string)=>{
  if(busy||!q.trim())return;

  const id=++request.current;
  abort.current=new AbortController();
  setBusy(true);
  setSeconds(0);
  setError('');
  setAnswer(null);
  setAsked(q);
  setQuestion('');

  const codes=new Set(
   POINTS.filter(p=>p.assetId===t.selectedRoom).map(p=>p.code)
  );
  const current=Object.values(t.readings)
   .filter(r=>codes.has(r.point_code));
  const cutoff=t.replayTime??
   Math.max(...current.map(r=>Date.parse(r.timestamp)));

  try{
   if(!Number.isFinite(cutoff)){
    throw Error('No readings available yet. Wait for simulator data.');
   }

   const snapshot=source==='what_if'
    ?current
    :t.history.filter(
      r=>codes.has(r.point_code)&&Date.parse(r.timestamp)<=cutoff
     ).slice(-1500);

   const res=await fetch('/api/assistant/ask',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    signal:abort.current.signal,
    body:JSON.stringify({
     room_id:t.selectedRoom,
     question:q,
     source,
     as_of:new Date(cutoff).toISOString(),
     snapshot:source==='http'?undefined:snapshot
    })
   });

   const data=await res.json();
   if(!res.ok)throw Error(data.error||'Request failed');
   if(id===request.current)setAnswer(data);
  }catch(e){
   if(id===request.current){
    setError(e instanceof Error?e.message:'Request failed');
   }
  }finally{
   if(id===request.current)setBusy(false);
  }
 };

 return (
  <>
   <button
    className="ask-floating"
    aria-expanded={t.assistantOpen}
    aria-label={t.assistantOpen
     ?'Close room assistant'
     :'Open room assistant'}
    onClick={()=>t.setAssistantOpen(!t.assistantOpen)}
   >
    <MessageCircle size={17}/>
    Room assistant
   </button>

   {t.assistantOpen&&(
    <aside
     className="assistant-panel twinlabs-assistant evidence-panel"
     role="dialog"
     aria-label="Room evidence assistant"
    >
     <div className="assistant-head">
      <Bot size={22}/>
      <div>
       <strong>{roomTitle(point)}</strong>
       <div className="eyebrow">ROOM EVIDENCE</div>
      </div>
      <button
       className="close-icon"
       aria-label="Close room assistant"
       onClick={()=>t.setAssistantOpen(false)}
      >
       <X size={19}/>
      </button>
     </div>

     <div className="model-connection">
      {health.model} · {health.connected?'available':'offline'}
      <span>
        {health.connected
            ?'P2 Concise · Verified evidence · Hybrid review'
            :health.error||'Checking connection…'}
        </span>
     </div>

     <div className="assistant-messages">
      <p>
       Answers use the selected room snapshot at the time you send
       your question.
      </p>

      <div className="prompt-chips">
       {[
        'Summarise this room',
        'Why this comfort score?',
        'Are any readings unusual?'
       ].map(q=>(
        <button disabled={busy} key={q} onClick={()=>ask(q)}>
         {q}
        </button>
       ))}
      </div>

      {busy&&(
       <p role="status">
        Retrieving evidence and generating… {seconds}s
       </p>
      )}

      {error&&(
       <p role="alert" style={{color:'#ac3828'}}>
        {error}
       </p>
      )}

      {answer&&(
       <div className="message message-assistant room-llm-answer">
        <strong>{asked}</strong>
        <p role="status" aria-live="polite" className={answer.status==='alert'?'pill pill-fault':answer.status==='review_required'?'pill pill-warning':'pill pill-muted'}>
         Assessment: {(answer.status||'unclassified').replaceAll('_',' ')}
        </p>
        <p>{answer.result.finding}</p>
        <small>
         Numerical claims: {answer.numeric_verification_passed?'verified':'not verified'} ·
         Semantic conflict: {answer.semantic_conflict?'review required':'not detected'} ·
         Human review: {answer.human_review_required?'yes':'no'}
        </small>
        {answer.verified_evidence&&(
         <details open>
          <summary>Backend-verified sensor measurements and historical context</summary>
          <pre>{JSON.stringify(answer.verified_evidence,null,2)}</pre>
         </details>
        )}
        {answer.decision_assessment&&(
         <details><summary>LLM and independent rule assessment</summary>
          <pre>{JSON.stringify(answer.decision_assessment,null,2)}</pre>
         </details>
        )}

        <small>
         {answer.model} · {answer.elapsed_seconds}s · Snapshot{' '}
         {new Date(answer.as_of).toLocaleString()}
         <br/>
         Source: {answer.observation_source} · Reference:{' '}
         {answer.reference_source}
        </small>

        {([
         'evidence',
         'possible_explanations',
         'recommended_checks',
         'limitations'
        ] as const).map(key=>(
         <details key={key} open={key==='evidence'}>
          <summary>{key.replaceAll('_',' ')}</summary>
          <ul>
           {answer.result[key].length
            ?answer.result[key].map((text,i)=>(
              <li key={i}>{text}</li>
             ))
            :(
             <li>
              None supplied. This does not establish that the room
              is normal.
             </li>
            )}
          </ul>
         </details>
        ))}

        <details>
         <summary>Tool trace</summary>
         <pre>{JSON.stringify(answer.tool_trace,null,2)}</pre>
        </details>

        <button
         type="button"
         onClick={()=>{
          const url=URL.createObjectURL(
           new Blob([JSON.stringify(answer,null,2)],{
            type:'application/json'
           })
          );
          const a=document.createElement('a');
          a.href=url;
          a.download='room-answer.json';
          a.click();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
         }}
        >
         Download answer
        </button>
       </div>
      )}

      <div className="evidence-sources">
       {evidence.map(e=>(
        <div key={e.point.code}>
         <strong>{e.point.label}</strong>
         <code>{e.display.value}</code>
         <small>
          {e.point.ifcSensorId} ·{' '}
          {e.reading
           ?new Date(e.reading.timestamp).toLocaleString()
           :'No reading'}
         </small>
        </div>
       ))}
      </div>
     </div>

     <form
      className="assistant-composer"
      onSubmit={e=>{
       e.preventDefault();
       ask(question);
      }}
     >
      <input
       maxLength={900}
       disabled={busy}
       aria-label="Ask about selected room"
       placeholder={`Ask about ${roomTitle(point)}…`}
       value={question}
       onChange={e=>setQuestion(e.target.value)}
      />
      <button
       disabled={busy||!question.trim()}
       type="submit"
       aria-label="Ask Qwen"
      >
       →
      </button>
     </form>
    </aside>
   )}
  </>
 );
}