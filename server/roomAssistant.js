import {registry} from './sensorContract.js';
export function registerRoomAssistant(app,{getHistory,fetchImpl=fetch}={}){
 const config=()=>({model:process.env.LLM_MODEL||'qwen3:1.7b',prompt:process.env.LLM_PROMPT||'baseline',retrieval:process.env.LLM_RETRIEVAL||'contextual',temperature:0,history_db:process.env.LLM_HISTORY_DB||''});
 const bridge=()=>{const url=new URL(process.env.LLM_BRIDGE_URL||'http://127.0.0.1:8011');if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('LLM bridge must be local');return url.origin};
 app.get('/api/assistant/health',async(_req,res)=>{
  try{const r=await fetchImpl(bridge()+'/health',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Bridge unavailable');
   const ollama=await fetchImpl('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(3000)});if(!ollama.ok)throw Error('Ollama unavailable');const tags=await ollama.json();const c=config();const available=tags.models?.some(m=>m.name===c.model);
   res.json({connected:!!available,model:c.model,prompt:c.prompt,retrieval:c.retrieval,history_configured:!!c.history_db,error:available?null:`Download model: ollama pull ${c.model}`});
  }catch(e){res.json({connected:false,model:config().model,error:'Start the Python LLM bridge and Ollama. '+e.message})}
 });
 app.post('/api/assistant/ask',async(req,res)=>{
  try{
   const {room_id,question,source,as_of,snapshot}=req.body;
   if(typeof question!=='string'||!question.trim()||question.length>900)return res.status(400).json({error:'Enter a question up to 900 characters.'});
   const points=registry.filter(p=>p.assetId===room_id);if(!points.length)return res.status(400).json({error:'Unknown room'});
   if(!['http','browser_demo','historical_replay','what_if'].includes(source))return res.status(400).json({error:'Unknown observation source'});
   const cutoff=Date.parse(as_of);if(!Number.isFinite(cutoff))return res.status(400).json({error:'Invalid analysis time'});
   const codes=new Set(points.map(p=>p.code));
   // Browser demo/replay observations are expressly labelled synthetic client snapshots.
   const rows=source==='http'?await getHistory(points.map(p=>p.code)):snapshot;
   if(!Array.isArray(rows)||rows.length>18000)return res.status(400).json({error:'Invalid room history'});
   const history=rows.filter(r=>codes.has(r.point_code)&&Number.isFinite(r.value)&&Number.isFinite(Date.parse(r.timestamp))&&Date.parse(r.timestamp)<=cutoff);
   if(!history.length)return res.status(400).json({error:'No readings available at this cutoff. Wait for simulator data.'});
   const response=await fetchImpl(bridge()+'/ask',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(600000),body:JSON.stringify({config:config(),request:{question:question.trim(),room_id:points[0].simulatorRoomId,room_name:points[0].locationLabel,source,as_of,points,history}})});
   const data=await response.json();res.status(response.status).json(data);
  }catch(e){res.status(503).json({error:'Room assistant unavailable: '+e.message+'. Check the LLM bridge terminal.'})}
 });
}
