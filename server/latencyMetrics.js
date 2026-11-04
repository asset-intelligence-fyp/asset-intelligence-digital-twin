import {randomUUID} from 'node:crypto';
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
const quantile=(values,q)=>values.length?values.slice().sort((a,b)=>a-b)[Math.ceil(q*values.length)-1]:null;
export function createLatencyMetrics({clock=Date.now,storage='temporary_memory'}={}){
 let runId=randomUUID();const traces=new Map();let omitted=0,evicted=0;
 const reset=()=>{traces.clear();omitted=0;evicted=0;runId=randomUUID();};
 return {
  begin(body,receivedAt){
   const generated=Date.parse(body?.generated_at_utc);
   if(!Number.isFinite(generated)||body?.clock_domain!=='same_host'){omitted++;return null;}
   const id=randomUUID(),trace={trace_id:id,source_generated_at:generated,server_received_at:receivedAt,server_committed_at:null,point_codes:[],acknowledgements:new Map(),clock_valid:generated<=receivedAt&&receivedAt-generated<60000,producer:body.producer||'unspecified'};
   traces.set(id,trace);if(traces.size>2000){traces.delete(traces.keys().next().value);evicted++;}
   return trace;
  },
  commit(trace,batch){if(!trace)return;trace.server_committed_at=clock();trace.point_codes=batch.map(r=>r.point_code);},
  failed(trace){if(trace)traces.delete(trace.trace_id);},
  routes(app){
   app.get('/api/benchmarks/latency',(req,res)=>{if(!local(req))return res.sendStatus(403);res.json(this.report(req.query.client_id));});
   app.post('/api/benchmarks/reset',(req,res)=>{if(!local(req))return res.sendStatus(403);reset();res.json({run_id:runId});});
   app.post('/api/benchmarks/rendered',(req,res)=>{
    if(!local(req))return res.sendStatus(403);
    const {trace_id,client_id}=req.body||{},trace=traces.get(trace_id);
    if(!trace||typeof client_id!=='string'||client_id.length>80||!client_id)return res.status(400).json({error:'Unknown trace or browser'});
    if(!trace.server_committed_at)return res.status(409).json({error:'Batch not committed'});
    // Server time avoids subtracting a browser clock from a server clock.
    // The return HTTP hop makes this a conservative upper bound after a paint opportunity.
    if(!trace.acknowledgements.has(client_id))trace.acknowledgements.set(client_id,clock());
    res.json({accepted:true});
   });
  },
  report(clientId){
   const all=[...traces.values()].filter(t=>t.server_committed_at!==null);
   const valid=all.filter(t=>t.clock_valid),samples=valid.flatMap(t=>{
    const at=clientId?t.acknowledgements.get(clientId):Math.min(...t.acknowledgements.values());
    return Number.isFinite(at)?[{trace_id:t.trace_id,points:t.point_codes.length,producer:t.producer,source_to_commit_ms:t.server_committed_at-t.source_generated_at,source_to_browser_ack_upper_ms:at-t.source_generated_at}]:[];
   });
   const values=samples.map(s=>s.source_to_browser_ack_upper_ms);
   const complete=valid.length>0&&samples.length===valid.length&&all.length===valid.length&&omitted===0&&evicted===0&&valid.every(t=>t.point_codes.length===18);
   return {run_id:runId,storage,clock_assumption:'Producer and API run on the same computer; remote clocks require independent synchronization.',measurement:'source generation start → committed React update → two animation frames → server receives browser acknowledgement (upper bound; not GPU completion)',total_batches:all.length,completed_batches:samples.length,pending_batches:valid.length-samples.length,invalid_clock_batches:all.length-valid.length,uninstrumented_batches:omitted,evicted_batches:evicted,minimum_batches:30,median_ms:quantile(values,.5),p95_ms:quantile(values,.95),max_ms:values.length?Math.max(...values):null,within_5s:samples.filter(s=>s.source_to_browser_ack_upper_ms<=5000).length,complete,assessment:samples.length<30?'insufficient_samples':!complete?'incomplete':values.every(v=>v<=5000)?'within_5s_for_this_run':'exceeded_5s',samples};
  }
 };
}
