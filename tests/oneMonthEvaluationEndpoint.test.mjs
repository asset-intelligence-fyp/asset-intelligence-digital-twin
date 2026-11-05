import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerRoomAssistant} from '../server/roomAssistant.js';

function harness(evaluationPath) {
 const routes=new Map();
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
            post:(path,...handlers)=>routes.set('POST '+path,handlers)};
 registerRoomAssistant(app,{getHistory:async()=>[],fetchImpl:async()=>{throw Error('Unexpected model request')},evaluationPath});
 return async(remote='127.0.0.1')=>{
  const handlers=routes.get('GET /api/assistant/evaluation');
  assert.ok(handlers,'evaluation endpoint must exist');
  const req={body:{},headers:{origin:'http://localhost:5173'},socket:{remoteAddress:remote}};
  const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this},json(value){this.body=value;return this}};
  let allowed=false;
  handlers[0](req,res,()=>{allowed=true});
  if(allowed)await handlers[1](req,res);
  return res;
 };
}

test('report endpoint returns not_evaluated until an actual backtest report exists',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'twinlabs-eval-'));
 try{
  const call=harness(join(folder,'missing.json'));
  const res=await call();
  assert.equal(res.statusCode,200);
  assert.equal(res.body.status,'not_evaluated');
  assert.deepEqual(res.body.summary,[]);
  assert.equal((await call('192.168.0.8')).statusCode,403);
 }finally{await rm(folder,{recursive:true,force:true})}
});

test('report endpoint shows real precomputed one-month evaluation metrics only',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'twinlabs-eval-'));
 const path=join(folder,'summary.json');
 try{
  const report={schema_version:1,status:'evaluated',horizon_months:1,ground_truth_year:2025,
   summary:[{sensor_id:'CO2-L03-MEET-01',valid_predictions:12,MAE:34,RMSE:45,
             accuracy_score_pct:94.9,unit:'ppm'}]};
  await writeFile(path,JSON.stringify(report));
  const res=await harness(path)();
  assert.equal(res.statusCode,200);
  assert.equal(res.body.summary[0].MAE,34);
  await writeFile(path,JSON.stringify({...report,horizon_months:12}));
  const wrong=await harness(path)();
  assert.equal(wrong.statusCode,503);
 }finally{await rm(folder,{recursive:true,force:true})}
});
