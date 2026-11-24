import test from 'node:test';
import assert from 'node:assert/strict';
import {createE8AMonitor,fiveMinuteObservedRows,e8aAssessment} from '../server/e8aMonitoring.js';
import {scopedE8A,e8aEvidenceFacts,e8aNarrative} from '../server/e8aAssistant.js';
import {registry} from '../server/sensorContract.js';

const point=registry.find(p=>p.sensorType==='temperature');
const sameRoom=registry.filter(p=>p.assetId===point.assetId);
const stamp='2026-11-24T01:20:19.000Z';
const cutoff=Date.parse(stamp);
const rows=[
 {point_code:point.code,timestamp:'2026-11-24T01:15:05.000Z',value:22,quality:'simulated'},
 {point_code:point.code,timestamp:'2026-11-24T01:19:01.000Z',value:23,quality:'simulated'},
 {point_code:point.code,timestamp:stamp,value:26,quality:'simulated'},
 {point_code:point.code,timestamp:'2026-11-24T01:20:22.000Z',value:99,quality:'simulated'},
 {point_code:point.code,timestamp:'2026-11-24T01:17:00.000Z',value:999,quality:'missing'},
 {point_code:'NOT-A-SENSOR',timestamp:stamp,value:5,quality:'simulated'},
 {point_code:point.code,timestamp:'invalid',value:28,quality:'simulated'}
];

test('E8-A resampling chooses last actually observed value, never future or fabricated values',()=>{
 const clean=fiveMinuteObservedRows(rows,[point.code],cutoff);
 assert.equal(clean.length,2);
 assert.deepEqual(clean.map(r=>r.value),[23,26]);
 assert.equal(clean[0].timestamp,'2026-11-24T01:19:01.000Z');
 assert.ok(clean.every(r=>Date.parse(r.timestamp)<=cutoff));
 assert.ok(clean.every(r=>Object.keys(r).sort().join(',')==='point_code,quality,timestamp,value'));
});

test('separate screening and evidence-grounded review determine display status',()=>{
 assert.equal(e8aAssessment({screening_status:'anomaly',verified_status:'unknown',evidence_status:'insufficient'}),'screening_needs_review');
 assert.equal(e8aAssessment({screening_status:'normal',verified_status:'suspect',evidence_status:'grounded'}),'verified_suspect');
 assert.equal(e8aAssessment({screening_status:'normal',verified_status:'normal',evidence_status:'grounded'}),'verified_normal');
 assert.equal(e8aAssessment(null),'not_evaluated');
});

test('E8-A automatic monitor evaluates sequentially and preserves both result channels',async()=>{
 let queries=0,inferences=0;
 const onCall=async (url,args={})=>{
  if(url.endsWith('/health'))return {ok:true,json:async()=>({workflow:'E8-A',dependencies_ready:true})};
  if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'qwen3:1.7b'}]})};
  if(url.endsWith('/detect')){
   inferences++;
   const input=JSON.parse(args.body);
   assert.equal(input.sensor_id,point.code);
   assert.ok(input.points.every(p=>p.assetId===point.assetId));
   assert.ok(input.history.every(p=>p.timestamp<=stamp));
   return {ok:true,json:async()=>({workflow:'E8-A',sensor_id:input.sensor_id,
    as_of:'2026-11-24T01:20:00Z',
    screening_status:'suspect',verified_status:'unknown',
    evidence_status:'missing_current_comparison',
    screening:{explanation:'Initial review needs checking'},
    verification:{status:'unknown'},trace:[{tool:'trajectory'}]})};
  }
  throw Error('Unexpected fetch '+url);
 };
 const monitor=createE8AMonitor({
  getHistory:async codes=>{queries++;return codes?.length?rows:rows;},
  getSource:()=>({replay_id:'run-1'}),fetchImpl:onCall,now:()=>cutoff+30_000
 });
 // First sensor in registry order is selected on the first available cycle.
 await monitor.tick();
 const state=monitor.state();
 assert.equal(state.connected,true);
 assert.equal(state.results.length,1);
 assert.equal(state.results[0].assessment,'screening_needs_review');
 assert.equal(state.results[0].verified_status,'unknown');
 assert.equal(inferences,1);
 assert.ok(queries>=2);
 await monitor.tick();
 assert.equal(inferences,1,'same bucket cannot trigger repeated expensive E8-A inference');
});

test('assistant only uses causal, same-replay E8-A outputs and distinguishes grounding from diagnosis',()=>{
 const result={workflow:'E8-A',point_code:point.code,as_of:'2026-11-24T01:20:00Z',
  screening_status:'anomaly',verified_status:'unknown',evidence_status:'invalid_citation',
  assessment:'screening_needs_review',replay_id:'run-1'};
 const response={connected:true,results:[result]};
 assert.equal(scopedE8A(response,{scope:point.assetId,asOf:'2026-11-24T01:19:59Z',replayId:'run-1'}).length,0);
 assert.equal(scopedE8A(response,{scope:'building',asOf:'2026-11-24T01:21:00Z',replayId:'run-2'}).length,0);
 const chosen=scopedE8A(response,{scope:point.code,asOf:'2026-11-24T01:21:00Z',replayId:'run-1'});
 assert.equal(chosen.length,1);
 assert.equal(e8aEvidenceFacts(chosen)[0].id,'e8a:'+point.code);
 assert.match(e8aEvidenceFacts(chosen)[0].text,/not establish a grounded classification/);
 assert.match(e8aNarrative(response,chosen),/unknown \(review required\)/);
 assert.match(e8aNarrative({connected:false},[]),/unavailable/);
 assert.match(e8aNarrative({connected:true},[]),/not yet completed/);
});
