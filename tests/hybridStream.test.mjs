import test from 'node:test';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';
import {createSensorApp} from '../server/sensorServer.js';import {normalizeSimulation} from '../server/hybridContract.js';
const sample=()=>{const r=spawnSync('python3',['-c',"import json;from tools.hybrid_simulator.engine import HybridSimulator;s=HybridSimulator(seed=42,start='2026-11-05T09:00:00+08:00',step_seconds=300);print(json.dumps(s.step()[0]))"],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const b=JSON.parse(r.stdout),id='d'.repeat(32);return {...b,producer:'calibrated_hybrid_v1',dataset:'generated_hybrid',replay_id:id,batch_id:`${id}:1`,sequence:1,clock_domain:'same_host',generated_at_utc:new Date().toISOString()}};
async function withServer(fn){const server=createSensorApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn(`http://127.0.0.1:${server.address().port}`)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}}
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('Generated hybrid observations share atomic ingestion, provenance, SSE and duplicate protection',async()=>withServer(async base=>{
 const b=sample();const stream=await fetch(base+'/api/events?format=batch');const reader=stream.body.getReader();await reader.read();
 assert.equal((await post(base,'/api/sensor-readings',b)).status,201);assert.equal((await(await post(base,'/api/sensor-readings',b)).json()).duplicate,true);
 const chunk=new TextDecoder().decode((await reader.read()).value);const data=JSON.parse(chunk.split('event: sensor-batch\ndata: ')[1].split('\n')[0]);assert.equal(data.readings.length,18);assert.equal(data.producer.simulation.weather.source,'virtual_weather_station');assert.equal(data.producer.simulation.calendar.day_type,'workday');
 const state=await(await fetch(base+'/api/bootstrap')).json();assert.equal(state.data.Sensor_Readings.length,18);assert.equal(state.simulation.name,'calibrated_hybrid_v1');assert.equal(state.simulation.simulation.profile_id,b.simulation.profile_id);assert.ok(!JSON.stringify(state).includes('injected_faults'));await reader.cancel();
}));
test('Controls validate fields and reject cross-origin commands; weather context rejects fabricated/nonfinite channels',async()=>withServer(async base=>{
 assert.equal((await post(base,'/api/simulation/control',{weather_mode:'rain',calendar_mode:'holiday'})).status,200);
 const settings=await(await fetch(base+'/api/simulation/control')).json();assert.equal(settings.weather_mode,'rain');assert.equal(settings.calendar_mode,'holiday');
 assert.equal((await post(base,'/api/simulation/control',{weather_mode:'tornado'})).status,400);
 assert.equal((await post(base,'/api/simulation/control',{calendar_mode:'workday'},{Origin:'https://unexpected.example'})).status,403);
 const b=sample();b.simulation.weather.outdoor_temp_c=null;assert.equal((await post(base,'/api/sensor-readings',b)).status,400);
 const c=sample();c.simulation.weather.timestamp='2026-01-01T00:00:00Z';assert.equal((await post(base,'/api/sensor-readings',c)).status,400);
 assert.throws(()=>normalizeSimulation({}));
}));
test('Default launcher generates new data without the ZIP and applies weather and holiday controls',async()=>withServer(async base=>{
 await post(base,'/api/simulation/control',{weather_mode:'rain',calendar_mode:'holiday'});
 const child=spawn(process.execPath,['scripts/run-simulator.mjs','--ticks','5','--interval-seconds','0.001','--step-seconds','300','--start','2026-11-05T09:00:00+08:00','--http-url',base+'/api/sensor-readings','--private-dir','/tmp/twinlabs-hybrid-test'],{env:{...process.env,SIMULATOR_MODE:'hybrid',DATASET_PATH:'/does/not/exist',SIM_SEED:'124'}});
 let error='';child.stdout.resume();child.stderr.on('data',d=>error+=d);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});assert.equal(code,0,error);
 const state=await(await fetch(base+'/api/bootstrap')).json();assert.equal(state.data.Historical_Sensor_Readings.length,90);assert.equal(state.simulation.simulation.weather.mode,'rain');assert.equal(state.simulation.simulation.calendar.override,'holiday');assert.equal(state.simulation.simulation.calendar.is_workday,false);
 assert.ok(state.data.Sensor_Readings.filter(r=>r.point_code.startsWith('PIR-')).every(r=>r.value===0));
}));
test('Manual faults are one-shot requests; operating changes retain their IDs and reset clears them',async()=>withServer(async base=>{
 let r=await post(base,'/api/simulation/control',{fault:{kind:'spike',sensor_id:'TEMP-L03-OPEN-01',duration_minutes:10,magnitude:3}});assert.equal(r.status,200);const first=await r.json();assert.ok(first.fault.id);
 r=await post(base,'/api/simulation/control',{weather_mode:'rain',ventilation:1.5,ac_mode:'off',step_seconds:300});const next=await r.json();assert.equal(next.fault.id,first.fault.id);assert.equal(next.ventilation,1.5);
 assert.equal((await post(base,'/api/simulation/control',{ventilation:0})).status,400);
 assert.equal((await post(base,'/api/simulation/control',{fault:{kind:'leak',sensor_id:'TEMP-L03-OPEN-01',duration_minutes:10,magnitude:1}})).status,400);
 const reset=await(await post(base,'/api/simulation/control',{reset:true})).json();assert.equal(reset.fault,null);assert.equal(reset.paused,false);assert.equal(reset.weather_mode,'auto');assert.equal(reset.step_seconds,5);
}));
