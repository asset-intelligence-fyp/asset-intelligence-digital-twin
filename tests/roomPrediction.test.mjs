import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoomAssistant} from '../server/roomAssistant.js';
import {registry} from '../server/sensorContract.js';
const point=registry.find(p=>p.sensorType==='co2');
const as_of='2026-11-06T14:00:00+08:00';
const body={room_id:point.assetId,sensor_id:point.code,horizon_months:1,source:'http',as_of};
const hist=[{point_code:point.code,value:650,timestamp:'2026-11-06T13:59:00+08:00',quality:'synthetic'},
            {point_code:point.code,value:999,timestamp:'2026-11-07T13:59:00+08:00',quality:'synthetic'}];
function fixture(fetchImpl,getHistory=async()=>hist){
 const routes=new Map();
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 registerRoomAssistant(app,{getHistory,fetchImpl});
 async function call(method,path,payload,remote='127.0.0.1'){
  const handlers=routes.get(method+' '+path);
  assert.ok(handlers,'route exists');
  const req={body:payload,headers:{origin:'http://localhost:5173'},socket:{remoteAddress:remote}};
  const res={statusCode:200,status(code){this.statusCode=code;return this},json(obj){this.body=obj;return this},setHeader(){}};
  let ok=false;handlers[0](req,res,()=>{ok=true});if(ok)await handlers[1](req,res);return res;
 }
 return {call};
}
test('one-month projection uses current authenticated sensor history and Qwen bridge',async()=>{
 let sent;
 const {call}=fixture(async(url,init)=>{assert.equal(url,'http://127.0.0.1:8011/predict');sent=JSON.parse(init.body);return{status:200,json:async()=>({status:'llm_projection',projected_value:680})}});
 const r=await call('POST','/api/assistant/predict',body);
 assert.equal(r.statusCode,200);assert.equal(r.body.projected_value,680);
 assert.equal(sent.request.horizon_months,1);
 assert.equal(sent.request.point.code,point.code);
 assert.equal(sent.request.history.length,1);
 assert.equal(sent.request.history[0].value,650);
 assert.equal(sent.config.model,'qwen3:1.7b');
});
test('only one-month is allowed, unsupported horizons and sensors rejected',async()=>{
 let calls=0;
 const {call}=fixture(async()=>{calls++;return {status:200,json:async()=>({status:'insufficient_history'})}});
 assert.equal((await call('POST','/api/assistant/predict',{...body,horizon_months:1})).statusCode,200);
 for(const invalid of [
  {...body,horizon_months:3},{...body,horizon_months:4},
  {...body,horizon_months:6},{...body,horizon_months:12},
  {...body,horizon_months:24},{...body,horizon_months:true},
  {...body,horizon_months:'1'},
  {...body,sensor_id:'ANOTHER-SENSOR'},
  {...body,sensor_id:registry.find(p=>p.sensorType==='occupancy').code},
  {...body,room_id:'WRONG'}, {...body,as_of:'2026-11-06T14:00:00'},
  {...body,source:'browser_demo'},{...body,source:'what_if'}
 ]) assert.equal((await call('POST','/api/assistant/predict',invalid)).statusCode,400);
 assert.equal(calls,1);
});
test('prediction stays loopback-only',async()=>{
 const {call}=fixture(async()=>{throw Error('Should not call bridge')});
 assert.equal((await call('POST','/api/assistant/predict',body,'192.168.0.2')).statusCode,403);
});
