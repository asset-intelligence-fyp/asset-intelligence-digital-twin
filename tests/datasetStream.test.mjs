import test from 'node:test';import assert from 'node:assert/strict';
import {createSensorApp} from '../server/sensorServer.js';import {registry} from '../server/sensorContract.js';
import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs';
const envelope=(id='a'.repeat(32),sequence=1,timestamp='2026-01-01T00:00:00+08:00')=>({producer:'people_driven_v3.0_dataset_replay',replay_id:id,sequence,batch_id:`${id}:${sequence}`,dataset:'fault_weather_2026_q1',clock_domain:'same_host',generated_at_utc:new Date().toISOString(),readings:registry.map(p=>({sensor_id:p.code,room_id:p.simulatorRoomId,sensor_type:p.sensorType,unit:p.unit,timestamp,value:p.unit==='binary'?0:26.34,quality_flag:'ok'}))});
const withServer=async(pool,fn)=>{const server=createSensorApp({pool}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn(`http://127.0.0.1:${server.address().port}`)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}};
const post=(base,payload)=>fetch(base+'/api/sensor-readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
test('Atomic SSE batch, safe retries, missing values, order and rewind isolation',async()=>{
 await withServer(null,async base=>{
  const stream=await fetch(base+'/api/events?format=batch');const reader=stream.body.getReader();await reader.read();
  const first=envelope();first.readings[0].value=null;first.readings[0].quality_flag='missing';
  const [a,b]=await Promise.all([post(base,first),post(base,first)]);assert.equal(a.status,201);assert.equal((await b.json()).duplicate,true);
  const event=new TextDecoder().decode((await reader.read()).value);assert.equal((event.match(/event: sensor-batch/g)||[]).length,1);assert.equal((event.match(/event: sensor-reading\n/g)||[]).length,0);
  const data=JSON.parse(event.split('event: sensor-batch\ndata: ')[1].split('\n')[0]);assert.equal(data.readings.length,18);assert.equal(data.readings[0].value,null);assert.equal(data.readings[0].quality,'missing');
  const conflicting=structuredClone(first);conflicting.readings[1].value=123;assert.equal((await post(base,conflicting)).status,409);
  const two=envelope('a'.repeat(32),2,'2026-01-01T00:05:00+08:00');assert.equal((await post(base,two)).status,201);
  const resumed=await fetch(base+'/api/events?format=batch',{headers:{'Last-Event-ID':data.event_id}});const resumedReader=resumed.body.getReader();const resumedText=new TextDecoder().decode((await resumedReader.read()).value);assert.match(resumedText,/sensor-batch/);await resumedReader.cancel();
  const old=envelope('a'.repeat(32),1);old.batch_id='a'.repeat(32)+':1';assert.equal((await post(base,old)).status,409);
  assert.equal((await post(base,envelope('b'.repeat(32),1,'2023-01-01T00:00:00+08:00'))).status,201);
  const state=await(await fetch(base+'/api/bootstrap')).json();assert.equal(state.data.Historical_Sensor_Readings.length,18);assert.match(state.data.Sensor_Readings[0].timestamp,/2022-12-31/);
  const report=await(await fetch(base+'/api/benchmarks/latency')).json();assert.equal(report.total_batches,3);await reader.cancel();
 });
});
test('PostgreSQL-compatible additive migration preserves NULL and restores active replay after API restart',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('database/twin18.sql','utf8'));await db.exec(fs.readFileSync('database/twin18.sql','utf8'));
 for(const p of registry)await db.query('INSERT INTO twin18.sensor_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[p.code,p.simulatorRoomId,p.ifcSensorId,p.guid,p.assetId,p.floor,p.sensorType,p.unit,p.mappingStatus]);
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 try{
  await withServer(pool,async base=>{const b=envelope();b.readings[0].value=null;b.readings[0].quality_flag='missing';assert.equal((await post(base,b)).status,201)});
  await withServer(pool,async base=>{const state=await(await fetch(base+'/api/bootstrap')).json();assert.equal(state.data.Sensor_Readings.length,18);assert.equal(state.data.Sensor_Readings[0].value,null);assert.equal(state.simulation.replay_id,'a'.repeat(32))});
 }finally{await db.close()}
});
test('Actual supplied ZIP publisher delivers through noise and missing-data intervals without fabricating zero', {skip:!process.env.DATASET_TEST_ZIP},async()=>{
 const {spawn}=await import('node:child_process');
 await withServer(null,async base=>{
  const child=spawn('python3',['-m','tools.dataset_replay.replay','--dataset',process.env.DATASET_TEST_ZIP,'--ticks','110','--interval-seconds','0.001','--http-url',base+'/api/sensor-readings']);
  let error='';child.stderr.on('data',d=>error+=d);child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});assert.equal(code,0,error);
  const state=await(await fetch(base+'/api/bootstrap')).json();assert.equal(state.data.Historical_Sensor_Readings.length,110*18);
  assert.ok(state.data.Historical_Sensor_Readings.some(r=>r.value===null&&r.quality==='missing'));
  const report=await(await fetch(base+'/api/benchmarks/latency')).json();assert.equal(report.total_batches,110);assert.equal(report.completed_batches,0);assert.equal(report.complete,false);
 });
});
