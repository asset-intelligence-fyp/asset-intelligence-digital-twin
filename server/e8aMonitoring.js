import {registry} from './sensorContract.js';

// Dedicated E8-A service; never blocks or replaces /api/assistant/ask,
// /api/assistant/building, the one-month predictor or automatic rule alerts.
const E8A_TYPES=new Set(['temperature','humidity','co2','light','power','water_leakage']);
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const UNAVAILABLE='E8-A has not evaluated this sensor; the rule-based alerts remain separate.';
const INTERVAL_MS=30_000,REFRESH_MS=4*60_000;

function bridgeUrl(){
 const raw=process.env.E8A_BRIDGE_URL||'http://127.0.0.1:8012';
 const u=new URL(raw);
 if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('E8A_BRIDGE_URL must use local HTTP');
 return u.origin;
}
function modelUrl(){
 const u=new URL(process.env.OLLAMA_URL||'http://127.0.0.1:11434');
 if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('OLLAMA_URL must use local HTTP');
 return u.origin;
}
const validRow=r=>r&&typeof r.point_code==='string'&&typeof r.timestamp==='string'&&Number.isFinite(Date.parse(r.timestamp))&&
 typeof r.value==='number'&&Number.isFinite(r.value)&&!['invalid','bad','missing','fault','error'].includes(String(r.quality||'').toLowerCase());
export function fiveMinuteObservedRows(rows,allowedCodes,cutoff){
 const allowed=new Set(allowedCodes),seen=new Map();
 for(const row of rows||[]){
  if(!validRow(row)||!allowed.has(row.point_code))continue;
  const ms=Date.parse(row.timestamp);
  if(ms>cutoff||ms<cutoff-90*86400000)continue;
  const key=row.point_code+'|'+Math.floor(ms/300000);
  const prev=seen.get(key);
  if(!prev||Date.parse(prev.timestamp)<ms)seen.set(key,{point_code:row.point_code,value:row.value,quality:row.quality||'simulated',timestamp:row.timestamp});
 }
 return [...seen.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-7500);
}
export function e8aAssessment(result){
 if(!result)return 'not_evaluated';
 const screen=result.screening_status,verified=result.verified_status;
 if(result.evidence_status==='grounded'){
  return verified==='anomaly'?'verified_anomaly':verified==='suspect'?'verified_suspect':
   verified==='normal'?'verified_normal':'review_required';
 }
 return screen==='anomaly'||screen==='suspect'?'screening_needs_review':'unverified';
}
export function createE8AMonitor({getHistory,getSource,fetchImpl=fetch,now=Date.now}={}){
 if(typeof getHistory!=='function')throw Error('E8-A monitoring needs the existing sensor history API');
 let busy=false,lastTick=null,health={connected:false,dependencies_ready:false,model_available:false,
  error:'Checking local E8-A bridge and Ollama'};
 let healthAt=0,runId=undefined,sourceType=null,lastError=null;
 const results=new Map(),runTimes=new Map();
 const activePoints=registry.filter(p=>E8A_TYPES.has(p.sensorType));
 const probe=async(force=false)=>{
  if(!force&&now()-healthAt<60_000)return health;
  healthAt=now();
  try{
   const [bridgeResponse,modelResponse]=await Promise.all([
    fetchImpl(bridgeUrl()+'/health',{signal:AbortSignal.timeout(4000)}),
    fetchImpl(modelUrl()+'/api/tags',{signal:AbortSignal.timeout(4000)})
   ]);
   if(!bridgeResponse.ok||!modelResponse.ok)throw Error('E8-A bridge or Ollama not responding');
   const [runtime,installed]=await Promise.all([bridgeResponse.json(),modelResponse.json()]);
   const modelAvailable=Array.isArray(installed.models)&&installed.models.some(m=>['qwen3:1.7b'].includes(m.model)||m.name==='qwen3:1.7b');
   health={connected:runtime.dependencies_ready===true&&modelAvailable,
    dependencies_ready:runtime.dependencies_ready===true,model_available:modelAvailable,
    error:runtime.dependencies_ready!==true?'Install E8-A Python dependencies: '+(runtime.missing||[]).join(', '):
     !modelAvailable?'Run ollama pull qwen3:1.7b':null};
  }catch(e){health={connected:false,dependencies_ready:false,model_available:false,
   error:'Start E8-A Python bridge and Ollama: '+e.message};}
  return health;
 };
 const state=()=>({
  workflow:'E8-A',model:'qwen3:1.7b',automatic:true,
  enabled:process.env.E8A_MONITOR_ENABLED!=='false',
  running:busy,connected:health.connected,dependencies_ready:health.dependencies_ready,
  model_available:health.model_available,error:lastError||health.error,
  updated_at:lastTick,source:'synthetic_http',sensors_supported:activePoints.length,
  results:[...results.values()].sort((a,b)=>Date.parse(b.evaluated_at)-Date.parse(a.evaluated_at)),
  note:'Screening is not a verified diagnosis. E8-A compares observed time-series evidence and may abstain. It does not forecast future faults.',
 });
 const tick=async()=>{
  if(busy||process.env.E8A_MONITOR_ENABLED==='false')return;
  busy=true;
  try{
   const source=getSource?.()||{};
   const replay=source?.replay_id??null;
   if(runId!==undefined&&runId!==replay){results.clear();runTimes.clear();}
   runId=replay;
   sourceType=source?.mode||'http';
   const h=await probe();
   if(!h.connected)return;
   const current=await getHistory();
   if(!Array.isArray(current)||!current.length)return;
   const latest=new Map();
   for(const row of current){
    if(!validRow(row))continue;
    const prior=latest.get(row.point_code);
    if(!prior||Date.parse(row.timestamp)>Date.parse(prior.timestamp))latest.set(row.point_code,row);
   }
   // Iterate over the least recently examined sensor first; do not let
   // frequently updating channels starve other sensors. Only one inference
   // runs at a time on an 8 GB M1, never 18 concurrent model instances.
   const eligible=activePoints.filter(p=>latest.has(p.code)).filter(p=>{
    const stamp=Date.parse(latest.get(p.code).timestamp);
    const bucket=Math.floor(stamp/300000);
    const previous=results.get(p.code);
    const lastRun=runTimes.get(p.code)||0;
    return !previous||previous.bucket!==bucket&&now()-lastRun>=REFRESH_MS;
   }).sort((a,b)=>(runTimes.get(a.code)||0)-(runTimes.get(b.code)||0));
   const target=eligible[0];
   if(!target)return;
   runTimes.set(target.code,now());
   const group=registry.filter(p=>p.assetId===target.assetId&&E8A_TYPES.has(p.sensorType));
   const history=await getHistory(group.map(p=>p.code));
   const cutoff=Date.parse(latest.get(target.code).timestamp);
   const rows=fiveMinuteObservedRows(history,group.map(p=>p.code),cutoff);
   if(!rows.length)return;
   const response=await fetchImpl(bridgeUrl()+'/detect',{
    method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(240000),
    body:JSON.stringify({sensor_id:target.code,as_of:new Date(cutoff).toISOString(),
      points:group,history:rows})
   });
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'E8-A service returned '+response.status);
   if(data.workflow!=='E8-A'||data.sensor_id!==target.code||
      !['normal','suspect','anomaly','unknown'].includes(data.screening_status)||
      !['normal','suspect','anomaly','unknown'].includes(data.verified_status))
    throw Error('E8-A service returned an invalid screening/verification contract');
   // A new simulation run cannot inherit diagnoses from the last run.
   if((getSource?.()?.replay_id??null)!==replay)return;
   const record={...data,point_code:target.code,location:target.locationLabel,
    sensor_type:target.sensorType,unit:target.unit,bucket:Math.floor(cutoff/300000),
    assessment:e8aAssessment(data),evaluated_at:new Date(now()).toISOString(),
    replay_id:replay};
   results.set(target.code,record);lastTick=record.evaluated_at;lastError=null;
  }catch(e){lastError=String(e.message||e).slice(0,260);}
  finally{busy=false;}
 };
 const start=()=>{
  if(process.env.E8A_MONITOR_ENABLED==='false')return ()=>{};
  const initial=setTimeout(()=>void tick(),12_000);initial.unref?.();
  const interval=setInterval(()=>void tick(),INTERVAL_MS);interval.unref?.();
  return ()=>{clearTimeout(initial);clearInterval(interval)};
 };
 return {state,tick,probe,start,results};
}
export function registerE8AMonitoring(app,{getHistory,getSource,fetchImpl=fetch,autoStart=true}={}){
 const monitor=createE8AMonitor({getHistory,getSource,fetchImpl});
 app.get('/api/ai/e8a/status',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(monitor.state());});
 app.post('/api/ai/e8a/refresh',(req,res)=>{
  if(!LOOPBACK.has(req.socket?.remoteAddress))return res.status(403).json({error:'Manual refresh restricted to host computer'});
  if(monitor.state().running)return res.status(409).json({error:'E8-A inference is already running'});
  void monitor.tick();
  res.status(202).json({queued:true,workflow:'E8-A',note:UNAVAILABLE});
 });
 if(autoStart)monitor.start();
 return monitor;
}
