import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoomAssistant} from '../server/roomAssistant.js';
import {registry} from '../server/sensorContract.js';

const point=registry[0];
const other=registry.find(x=>x.assetId!==point.assetId);
const as_of='2026-03-09T14:00:00+08:00';
const data={
  room_id:point.assetId,
  question:'Is this room unusual?',
  source:'http',
  as_of,
};
const validReading={point_code:point.code,value:24,timestamp:'2026-03-09T13:40:00+08:00'};
const futureReading={point_code:point.code,value:50,timestamp:'2026-03-09T14:15:00+08:00'};
const outsider={point_code:other.code,value:77,timestamp:'2026-03-09T13:40:00+08:00'};

function fixture(fetchImpl,getHistory) {
  const routes=new Map();
  registerRoomAssistant({
    get:(p,...handlers)=>routes.set('GET '+p,handlers),
    post:(p,...handlers)=>routes.set('POST '+p,handlers),
  },{fetchImpl,getHistory});
  return async function request(path,body=data,remote='127.0.0.1') {
    const handlers=routes.get('POST '+path);
    assert.ok(handlers,'missing '+path);
    const req={body,headers:{origin:'http://localhost:5173'},
               socket:{remoteAddress:remote}};
    const res={statusCode:200,status(code){this.statusCode=code;return this},
      json(value){this.body=value;return this},setHeader(){}};
    let next=false;
    handlers[0](req,res,()=>{next=true});
    if(next) await handlers[1](req,res);
    return res;
  };
}

test('agentic endpoint uses a separate bridge route and bounded current-room readings',async()=>{
  let sent, endpoint;
  const call=fixture(async(url,options)=>{
    endpoint=url;sent=JSON.parse(options.body);
    return {status:200,json:async()=>({
      status:'review_required',retrieval_variant:'agentic_sql_tools',
      agentic:{tool_call_count:2,max_rounds:3},
    })};
  },async()=>[validReading,futureReading,outsider]);
  const res=await call('/api/assistant/ask-agentic');
  assert.equal(res.statusCode,200);
  assert.equal(endpoint,'http://127.0.0.1:8011/ask-agentic');
  assert.equal(sent.config.model,'qwen3:1.7b');
  assert.equal(sent.request.history.length,1);
  assert.equal(sent.request.history[0].point_code,point.code);
  assert.equal(res.body.agentic.tool_call_count,2);
});

test('old fixed retrieval route is preserved for paired comparisons',async()=>{
  let endpoint;
  const call=fixture(async(url)=>{
    endpoint=url;return {status:200,json:async()=>({status:'no_alert'})};
  },async()=>[validReading]);
  const res=await call('/api/assistant/ask');
  assert.equal(res.statusCode,200);
  assert.equal(endpoint,'http://127.0.0.1:8011/ask');
});

test('agentic route enforces local-only access and canonical room validation',async()=>{
  const call=fixture(async()=>{throw Error('bridge should not be called')},
                     async()=>[validReading]);
  assert.equal((await call('/api/assistant/ask-agentic',data,'10.0.0.44')).statusCode,403);
  assert.equal((await call('/api/assistant/ask-agentic',
              {...data,room_id:'unknown'})).statusCode,400);
  assert.equal((await call('/api/assistant/ask-agentic',
              {...data,as_of:'2026-03-09T14:00:00'})).statusCode,400);
  assert.equal((await call('/api/assistant/ask-agentic',
              {...data,question:''})).statusCode,400);
});
