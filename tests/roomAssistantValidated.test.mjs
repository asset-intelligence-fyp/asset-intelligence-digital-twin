import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoomAssistant} from '../server/roomAssistant.js';
import {registry} from '../server/sensorContract.js';

function fixture(fetchImpl, getHistory=async()=>[]) {
 const routes=new Map();
 const app={get:(path,...handlers)=>routes.set(`GET ${path}`,handlers),
            post:(path,...handlers)=>routes.set(`POST ${path}`,handlers)};
 registerRoomAssistant(app,{getHistory,fetchImpl});
 async function request(method,path,body={},remote='127.0.0.1') {
  const handlers=routes.get(`${method} ${path}`);
  assert.ok(handlers,'route missing');
  const req={body,headers:{origin:'http://localhost:5173'},socket:{remoteAddress:remote}};
  const res={statusCode:200,headers:{},status(c){this.statusCode=c;return this},
    json(value){this.body=value;return this},setHeader(k,v){this.headers[k]=v}};
  let nexted=false;handlers[0](req,res,()=>{nexted=true});
  if(nexted)await handlers[1](req,res);
  return res;
 }
 return {request};
}

const first=registry[0];
const body={room_id:first.assetId,question:'Summarise selected room',source:'http',
 as_of:'2026-03-09T14:00:00+08:00'};
const reading={point_code:first.code,value:24,timestamp:'2026-03-09T13:40:00+08:00',quality:'synthetic'};

test('health reports real whole-building P2/validated configuration after bridge and model checks',async()=>{
 const f=fixture(async url=>{
  if(url.endsWith('/health'))return {ok:true,json:async()=>({ok:true,validation_mode:'hybrid_semantic',prompt:'concise',normal_history_database_ready:true,history_status:'synthetic_normal_sqlite_connected'})};
  if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'qwen3:1.7b'}]})};
  throw Error('unexpected URL');
 });
 const r=await f.request('GET','/api/assistant/health');
 assert.equal(r.statusCode,200);assert.equal(r.body.connected,true);
 assert.equal(r.body.model,'qwen3:1.7b');assert.equal(r.body.prompt,'concise');
 assert.equal(r.body.retrieval,'validated');assert.equal(r.body.validation_mode,'hybrid_semantic');
 assert.equal(r.body.historical_reference_available,true);
 assert.equal(r.body.history_configured,true);
});

test('room endpoint retains canonical 18-point mapping and preserves source provenance',async()=>{
 let captured;
 const f=fixture(async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8011/ask');
  captured=JSON.parse(init.body);
  return {status:200,json:async()=>({status:'insufficient_evidence',result:{finding:'No baseline'}})};
 },async()=>[reading]);
 const r=await f.request('POST','/api/assistant/ask',body);
 assert.equal(r.statusCode,200);
 assert.equal(r.body.status,'insufficient_evidence');
 assert.equal(captured.config.model,'qwen3:1.7b');
 assert.equal(captured.config.prompt,'concise');
 assert.equal(captured.config.retrieval,'validated');
 assert.equal(captured.config.validation_mode,'hybrid_semantic');
 assert.equal(captured.request.points.length,registry.filter(x=>x.assetId===first.assetId).length);
 assert.equal(captured.request.history[0].point_code,first.code);
 assert.equal(captured.request.source,'http');
});

test('invalid identifiers, sources and timezone-less cutoffs are rejected before bridging',async()=>{
 const f=fixture(async()=>{throw Error('should not call bridge')},async()=>[reading]);
 for(const x of [
  {...body,room_id:'not a room'}, {...body,source:'unsafe'},
  {...body,as_of:'2026-03-09T14:00:00'}, {...body,question:' '},
 ]){const res=await f.request('POST','/api/assistant/ask',x);assert.equal(res.statusCode,400)}
});

test('LAN access is blocked in local-only PoC mode',async()=>{
 const f=fixture(async()=>{throw Error('should not call bridge')});
 const r=await f.request('POST','/api/assistant/ask',body,'192.168.0.4');
 assert.equal(r.statusCode,403);
});

test('browser-supplied snapshots are explicitly distinguished from HTTP database history',async()=>{
 let captured;
 const f=fixture(async(url,init)=>{captured=JSON.parse(init.body);return {status:200,json:async()=>({result:{finding:'ok'}})}},
   async()=>{throw Error('should not access database for browser_demo')});
 const r=await f.request('POST','/api/assistant/ask',{...body,source:'browser_demo',snapshot:[reading]});
 assert.equal(r.statusCode,200);
 assert.equal(captured.request.source,'browser_demo');
});


test('a missing normal-history database is visible but does not falsify Ollama connectivity',async()=>{
 const f=fixture(async url=>{
  if(url.endsWith('/health'))return {ok:true,json:async()=>({ok:true,validation_mode:'hybrid_semantic',prompt:'concise',normal_history_database_ready:false,history_status:'normal_history_not_available'})};
  if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'qwen3:1.7b'}]})};
  throw Error('unexpected URL');
 });
 const res=await f.request('GET','/api/assistant/health');
 assert.equal(res.body.connected,true);
 assert.equal(res.body.historical_reference_available,false);
 assert.equal(res.body.history_status,'normal_history_not_available');
});