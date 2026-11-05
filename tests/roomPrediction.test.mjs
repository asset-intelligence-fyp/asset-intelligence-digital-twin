import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoomAssistant} from '../server/roomAssistant.js';
import {registry} from '../server/sensorContract.js';

function fixture(fetchImpl) {
 const routes=new Map();
 const app={get:(path,...hs)=>routes.set('GET '+path,hs), post:(path,...hs)=>routes.set('POST '+path,hs)};
 registerRoomAssistant(app,{fetchImpl,getHistory:async()=>[]});
 const call=async(method,path,body,remote='127.0.0.1')=>{
  const handlers=routes.get(method+' '+path);
  assert.ok(handlers,'route exists');
  const req={body,headers:{origin:'http://localhost:5173'},socket:{remoteAddress:remote}};
  const res={statusCode:200,headers:{},status(c){this.statusCode=c;return this},json(x){this.body=x;return this},setHeader(k,v){this.headers[k]=v}};
  let passed=false;
  handlers[0](req,res,()=>{passed=true});
  if(passed)await handlers[1](req,res);
  return res;
 };
 return {call};
}
const co2=registry.find(p=>p.sensorType==='co2');
const body={room_id:co2.assetId,sensor_id:co2.code,horizon_hours:1,source:'http',as_of:'2026-11-06T14:00:00+08:00'};

test('prediction route forwards exact canonical ID, horizon and cutoff to local bridge', async()=>{
 let sent;
 const {call}=fixture(async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8011/predict');
  sent=JSON.parse(init.body);
  return {status:200,json:async()=>({status:'ok',expected_value:600,historical_days:6})};
 });
 const res=await call('POST','/api/assistant/predict',body);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.expected_value,600);
 assert.equal(sent.request.point.code,co2.code);
 assert.equal(sent.request.room_id,co2.simulatorRoomId);
 assert.equal(sent.request.horizon_hours,1);
 assert.equal(sent.request.as_of,body.as_of);
 assert.equal(sent.config.model,'qwen3:1.7b');
});
test('accepts +24 hour history-based estimate but rejects arbitrary sensors, horizons and rooms',async()=>{
 let hits=0;
 const {call}=fixture(async()=>{hits++;return{status:200,json:async()=>({status:'insufficient_history'})}});
 assert.equal((await call('POST','/api/assistant/predict',{...body,horizon_hours:24})).statusCode,200);
 for(const invalid of [{...body,horizon_hours:3},{...body,horizon_hours:'1'},
   {...body,sensor_id:registry.find(p=>p.sensorType==='occupancy').code},
   {...body,sensor_id:'WRONG'}, {...body,room_id:'WRONG'},
   {...body,as_of:'2026-11-06T14:00:00'}, {...body,source:'evil'}]){
  assert.equal((await call('POST','/api/assistant/predict',invalid)).statusCode,400);
 }
 assert.equal(hits,1);
});
test('predict endpoint is loopback-only',async()=>{
 const {call}=fixture(async()=>{throw Error('should not reach bridge')});
 const r=await call('POST','/api/assistant/predict',body,'10.0.0.25');
 assert.equal(r.statusCode,403);
});
