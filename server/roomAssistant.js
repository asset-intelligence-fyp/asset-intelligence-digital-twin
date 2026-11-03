import {registry} from './sensorContract.js';

// The active whole-building app uses this route, not legacy Level 5 /api/ai.
const LOOPBACK = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const model = 'qwen3:1.7b';
const config = () => ({
 model, prompt:'concise', retrieval:'validated', validation_mode:'hybrid_semantic',
 temperature:0, history_db:process.env.LLM_HISTORY_DB||''
});
function localUrl(raw, label) {
 const url = new URL(raw);
 if (url.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(url.hostname))
  throw Error(label+' must be a local HTTP service');
 return url.origin;
}
function replyError(res,status,message) { return res.status(status).json({error:message}); }

export function registerRoomAssistant(app,{getHistory,fetchImpl=fetch}={}) {
 const allowed = (req,res,next) => {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return replyError(res,403,'Room AI is available only on this computer');
  const origin = req.headers?.origin;
  if (origin) {
   try {
    const url = new URL(origin);
    if (!['localhost','127.0.0.1'].includes(url.hostname) || !['http:','https:'].includes(url.protocol))
     return replyError(res,403,'Room AI requires a local browser origin');
   } catch { return replyError(res,403,'Invalid request origin'); }
  }
  res.setHeader?.('Cache-Control','no-store');
  return next();
 };
 const bridge = () => localUrl(process.env.LLM_BRIDGE_URL||'http://127.0.0.1:8011','LLM bridge');
 const ollama = () => localUrl(process.env.OLLAMA_URL||'http://127.0.0.1:11434','Ollama');
 app.get('/api/assistant/health',allowed,async(_req,res)=>{
  try {
   const r=await fetchImpl(bridge()+'/health',{signal:AbortSignal.timeout(3000)});
   if(!r.ok)throw Error('Python bridge is offline');
   const h=await r.json();
   if(h.validation_mode!=='hybrid_semantic'||h.prompt!=='concise')throw Error('Bridge version is not the whole-building validated adapter');
   const tagsResponse=await fetchImpl(ollama()+'/api/tags',{signal:AbortSignal.timeout(3000)});
   if(!tagsResponse.ok)throw Error('Ollama is offline');
   const tags=await tagsResponse.json();
   const available=Array.isArray(tags.models)&&tags.models.some(m=>m.name===model||m.model===model);
   res.json({connected:!!available,model,prompt:'concise',retrieval:'validated',validation_mode:'hybrid_semantic',
             history_configured:!!config().history_db,error:available?null:'Run ollama pull '+model});
  }catch(e){res.json({connected:false,model,prompt:'concise',retrieval:'validated',validation_mode:'hybrid_semantic',error:'Start the Python bridge and Ollama: '+e.message});}
 });
 app.post('/api/assistant/ask',allowed,async(req,res)=>{
  try {
   const {room_id,question,source,as_of,snapshot}=req.body||{};
   if(typeof question!=='string'||!question.trim()||question.length>900)
    return replyError(res,400,'Enter a question up to 900 characters.');
   const points=registry.filter(p=>p.assetId===room_id);
   if(!points.length)return replyError(res,400,'Unknown room');
   if(!['http','browser_demo','historical_replay','what_if'].includes(source))
    return replyError(res,400,'Unknown observation source');
   const cutoff=Date.parse(as_of);
   if(typeof as_of!=='string'||!Number.isFinite(cutoff)||!/(?:Z|[+-]\d\d:\d\d)$/.test(as_of))
    return replyError(res,400,'Analysis time must have a timezone offset');
   const codes=new Set(points.map(p=>p.code));
   const rows=source==='http'?await getHistory(points.map(p=>p.code)):snapshot;
   if(!Array.isArray(rows)||rows.length>18000)return replyError(res,400,'Invalid room history');
   const history=rows.filter(r=>r&&codes.has(r.point_code)&&typeof r.value==='number'&&Number.isFinite(r.value)&&
       typeof r.timestamp==='string'&&Number.isFinite(Date.parse(r.timestamp))&&Date.parse(r.timestamp)<=cutoff);
   if(!history.length)return replyError(res,400,'No readings at this cutoff; wait for simulator data.');
   const response=await fetchImpl(bridge()+'/ask',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),
    body:JSON.stringify({config:config(),request:{question:question.trim(),room_id:points[0].simulatorRoomId,
      room_name:points[0].locationLabel,source,as_of,points,history}})
   });
   const data=await response.json();
   res.status(response.status).json(data);
  }catch(e){replyError(res,503,'Room AI unavailable: '+e.message+'. Check your Python bridge/Ollama terminals.');}
 });
}