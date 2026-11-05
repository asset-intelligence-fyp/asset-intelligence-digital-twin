import test from 'node:test';import assert from 'node:assert/strict';
import {buildingFacts} from '../server/buildingAssistant.js';
import {predictionTask,predictionContext,predictWithQwen} from '../server/qwenPrediction.js';
import {scorePredictions} from '../scripts/evaluate_qwen_predictions.mjs';
const point='TEMP-L03-OPEN-01',as_of='2026-11-05T01:30:00Z';
const rows=Array.from({length:7},(_,i)=>({point_code:point,timestamp:new Date(Date.parse(as_of)-(6-i)*5*60000).toISOString(),value:22+i*.2,quality:'synthetic'}));
const facts=buildingFacts(rows,null,{scope:point}).facts;
const args={rows,facts,scope:point,as_of,task:'combined',point_code:point,horizon_minutes:15,question:'Investigate this sensor and forecast its next reading'};
const valid={needs_investigation:false,assessment:'no_alert',rationale:'The recent temperature trend is gradual; confirm the operating schedule.',evidence_ids:['latest:'+point],inspection_actions:['Review the AC schedule.'],forecast_value:23.5};
const mock=value=>async()=>({ok:true,json:async()=>({response:JSON.stringify(value)})});
test('Task routing separates evidence, classification and future forecasts',()=>{assert.equal(predictionTask('Compare office CO2'),'evidence');assert.equal(predictionTask('Is this normal?'),'anomaly');assert.equal(predictionTask('Predict the next temperature'),'forecast');assert.equal(predictionTask('Predict and investigate'),'combined');assert.equal(predictionTask('Predict','evidence'),'evidence')});
test('Prediction context never uses future rows, null latest observations, unsupported scopes or horizons',()=>{
 const c=predictionContext([...rows,{...rows[0],timestamp:'2026-11-05T01:35:00Z',value:99}],facts,args);assert.equal(c.latest_value,23.2);assert.equal(c.forecast_ready,true);assert.ok(c.observations.every(r=>Date.parse(r.timestamp)<=Date.parse(as_of)));
 assert.equal(predictionContext([...rows,{...rows.at(-1),value:null}],facts,args).forecast_ready,false);
 assert.throws(()=>predictionContext(rows,facts,{...args,scope:'L03-MEET'}));assert.throws(()=>predictionContext(rows,facts,{...args,horizon_minutes:90}));
});
test('Qwen generates the numerical estimate; backend supplies its target time and baseline',async()=>{
 let prompt;const p=await predictWithQwen({...args,rows:[...rows,{...rows[0],timestamp:'2026-11-05T01:35:00Z',value:987654}],fetchImpl:async(u,o)=>{prompt=JSON.parse(o.body).prompt;return mock(valid)()}});
 assert.equal(p.model_used,true);assert.equal(p.forecast.value,23.5);assert.equal(p.forecast.baseline_persistence,23.2);assert.equal(p.forecast.target_time,'2026-11-05T01:45:00.000Z');assert.doesNotMatch(prompt,/987654/);assert.match(p.validation,/NOT independently validated/);
});
test('Missing history, invalid outputs and offline Qwen abstain, never substituting a calculated forecast',async()=>{
 const no=await predictWithQwen({...args,rows:rows.slice(-2),fetchImpl:()=>{throw Error('must not call')}});assert.equal(no.status,'insufficient_evidence');assert.equal(no.forecast,null);
 for(const value of [{...valid,evidence_ids:['made-up']},{...valid,needs_investigation:true},{...valid,forecast_value:500},{...valid,rationale:'It is 23 degrees.'},{...valid,forecast_value:'23.5'}]){const p=await predictWithQwen({...args,fetchImpl:mock(value)});assert.equal(p.status,'model_unavailable_or_rejected');assert.equal(p.forecast,null)}
 assert.equal((await predictWithQwen({...args,fetchImpl:async()=>{throw Error('offline')}})).model_used,false);
});
test('Forecast-only responses do not invent a classification decision; binary sensors cannot forecast',async()=>{
 const p=await predictWithQwen({...args,task:'forecast',fetchImpl:mock({...valid,needs_investigation:null,assessment:'insufficient_evidence'})});assert.equal(p.model_used,true);assert.equal(p.status,'generated_unvalidated');
 const binary='PIR-L03-OPEN-01',brows=rows.map(r=>({...r,point_code:binary,value:0}));const bfacts=buildingFacts(brows,null,{scope:binary}).facts;
 assert.equal((await predictWithQwen({...args,point_code:binary,scope:binary,rows:brows,facts:bfacts,fetchImpl:mock(valid)})).status,'insufficient_evidence');
});
test('Held-out scoring keeps abstentions in accuracy denominator and scores future value against a matched target',()=>{
 const results=[{case_id:'a',prediction:{model_used:true,point_code:point,needs_investigation:true,forecast:{value:24,baseline_persistence:22,target_time:'2026-11-05T01:45:00Z',horizon_minutes:15}}},{case_id:'b',prediction:{model_used:false,needs_investigation:null}}];
 const key=[{case_id:'a',needs_investigation:true,point_code:point,horizon_minutes:15,target_time:'2026-11-05T01:45:00Z',future_value:25},{case_id:'b',needs_investigation:false}];const s=scorePredictions(results,key);
 assert.equal(s.classification.accuracy_all_cases,.5);assert.equal(s.classification.coverage,.5);assert.equal(s.forecasts[0].mae,1);assert.equal(s.forecasts[0].persistence_mae,3);assert.equal(s.classification.counts.abstained,1);
 assert.throws(()=>scorePredictions([...results,results[0]],key));
});
