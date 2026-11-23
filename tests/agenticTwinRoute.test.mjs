import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoomAssistant} from '../server/roomAssistant.js';
import {registry} from '../server/sensorContract.js';

const point=registry.find(p=>p.sensorType==='temperature');
const base={room_id:point.assetId,sensor_id:point.code,question:'Compare history and operating context',
 source:'http',as_of:'2026-11-23T18:00:00+08:00'};
const observation={point_code:point.code,value:25.2,timestamp:'2026-11-23T17:55:00+08:00',quality:'synthetic'};

function fake(fetchImpl,{history=[observation],stream=[],source=null,alerts=[]}={}){
 const routes=new Map();
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
            post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 registerRoomAssistant(app,{fetchImpl,getHistory:async()=>history,
  getStreamHistory:async()=>stream,getSource:()=>source,getAlerts:async()=>alerts});
 async function request(task,body=base,remoteAddress='127.0.0.1'){
  const handlers=routes.get('POST /api/assistant/agentic/:task');
  assert.ok(handlers);
  const req={params:{task},body,headers:{origin:'http://localhost:5173'},
   socket:{remoteAddress}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(v){this.body=v;return this},setHeader(){}};
  let allowed=false;
  handlers[0](req,res,()=>{allowed=true});
  if(allowed)await handlers[1](req,res);
  return res;
 }
 return {request};
}

test('Agentic investigation passes causal room readings and safe operational context',async()=>{
 let called,request;
 const f=fake(async(url,opts)=>{called=url;request=JSON.parse(opts.body);
  return {status:200,json:async()=>({status:'investigation',finding:'observed'})};
 },{history:[observation,{...observation,timestamp:'2026-11-24T18:00:00+08:00',value:99}],
    source:{name:'calibrated_hybrid_v1',simulation:{weather:{scene:'rain'}}},
    alerts:[{point_code:point.code,time:'2026-11-23T17:50:00+08:00',title:'Warning'},
            {point_code:point.code,time:'2026-11-24T17:50:00+08:00',title:'Future'}]});
 const res=await f.request('investigate');
 assert.equal(res.statusCode,200);
 assert.equal(called,'http://127.0.0.1:8011/agentic-investigate');
 assert.equal(request.request.sensor_id,point.code);
 assert.equal(request.request.history.length,1);
 assert.equal(request.request.incidents.length,1);
 assert.equal(request.request.simulation.name,'calibrated_hybrid_v1');
 assert.equal(request.config.model,'qwen3:1.7b');
});

test('One-month forecast is a separate endpoint and can work with a recent sensor history',async()=>{
 let called;
 const f=fake(async(url)=>{called=url;return {status:200,json:async()=>({
  status:'exploratory_scenario',horizon_months:1,projected_value:25.3})}});
 const res=await f.request('forecast');
 assert.equal(res.statusCode,200);
 assert.equal(called,'http://127.0.0.1:8011/agentic-forecast');
 assert.equal(res.body.horizon_months,1);
});

test('Unknown sensors, tasks, bad timezones and LAN access do not reach Ollama',async()=>{
 const f=fake(async()=>{throw Error('must not call service')});
 const wrong=[
  await f.request('wrong'),
  await f.request('investigate',{...base,sensor_id:'NONEXISTENT'}),
  await f.request('investigate',{...base,as_of:'2026-11-23T18:00:00'}),
  await f.request('investigate',base,'192.168.1.8')
 ];
 assert.deepEqual(wrong.map(r=>r.statusCode),[404,400,400,403]);
});

test('Browser demo snapshot cannot inherit the live simulator context or rule alerts',async()=>{
 let data;
 const f=fake(async(_url,opts)=>{data=JSON.parse(opts.body);return {status:200,json:async()=>({status:'investigation'})}},
  {history:[],source:{name:'calibrated_hybrid_v1',simulation:{operation:{ac_mode:'off'}}},
   alerts:[{point_code:point.code,time:base.as_of}]});
 const res=await f.request('investigate',{...base,source:'browser_demo',snapshot:[observation]});
 assert.equal(res.statusCode,200);
 assert.equal(data.request.simulation,null);
 assert.deepEqual(data.request.incidents,[]);
});


test('PostgreSQL Date timestamps are retained, normalized and compared causally',async()=>{
 let payload;
 const f=fake(async(_url,opts)=>{payload=JSON.parse(opts.body);
  return {status:200,json:async()=>({status:'investigation'})};
 },{history:[{...observation,timestamp:new Date('2026-11-23T09:55:00.000Z')},
             {...observation,timestamp:new Date('2026-11-23T10:05:00.000Z'),value:99}]});
 const res=await f.request('investigate');
 assert.equal(res.statusCode,200);
 assert.equal(payload.request.history.length,1);
 assert.equal(payload.request.history[0].timestamp,'2026-11-23T09:55:00.000Z');
 assert.equal(payload.request.history[0].value,25.2);
 assert.equal(payload.request.provenance.database_rows,2);
 assert.equal(payload.request.provenance.used_stream_fallback,false);
});

test('Trusted server-side telemetry stream supplies current reading when SQL history is empty',async()=>{
 let payload;
 const f=fake(async(_url,opts)=>{payload=JSON.parse(opts.body);
  return {status:200,json:async()=>({status:'investigation'})};
 },{history:[],stream:[observation]});
 const res=await f.request('investigate');
 assert.equal(res.statusCode,200);
 assert.equal(payload.request.history.length,1);
 assert.equal(payload.request.history[0].point_code,point.code);
 assert.equal(payload.request.provenance.used_stream_fallback,true);
});

test('Missing sensor observations return a specific error without calling Qwen',async()=>{
 const f=fake(async()=>{throw Error('must not invoke AI')},{history:[],stream:[]});
 const r=await f.request('investigate');
 assert.equal(r.statusCode,400);
 assert.match(r.body.error,/No eligible reading.*sensor/i);
});


test('Forecast-only model selector sends Qwen3 4B to the Python bridge',async()=>{
 let payload;
 const f=fake(async(_url,init)=>{payload=JSON.parse(init.body);
   return {status:200,json:async()=>({status:'exploratory_scenario',model:'qwen3:4b'})};});
 const result=await f.request('forecast',{...base,forecast_model:'qwen3:4b'});
 assert.equal(result.statusCode,200);
 assert.equal(payload.config.model,'qwen3:4b');
 assert.equal(result.body.model,'qwen3:4b');
});

test('Agentic anomaly investigation remains pinned to Qwen3 1.7B',async()=>{
 let payload;
 const f=fake(async(_url,init)=>{payload=JSON.parse(init.body);
   return {status:200,json:async()=>({status:'investigation'})};});
 const result=await f.request('investigate',base);
 assert.equal(result.statusCode,200);
 assert.equal(payload.config.model,'qwen3:1.7b');
});

test('Unknown forecast models and anomaly model overrides are rejected',async()=>{
 const f=fake(async()=>{throw Error('should not invoke Python')});
 const invalid=await f.request('forecast',{...base,forecast_model:'llama3:70b'});
 const changedAnomaly=await f.request('investigate',{...base,forecast_model:'qwen3:4b'});
 assert.deepEqual([invalid.statusCode,changedAnomaly.statusCode],[400,400]);
});
