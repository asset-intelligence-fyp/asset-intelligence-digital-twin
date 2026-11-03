import {inflateSync} from 'node:zlib';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn,spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {registry,normalizeReadings} from '../server/sensorContract.js';import {createSensorApp} from '../server/sensorServer.js';
const generated=spawnSync('python3',['-m','tools.level03_simulator.simulator.run','--ticks','1','--out-dir','/tmp/twin18-contract-test','--quiet'],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
const batch=JSON.parse(fs.readFileSync('/tmp/twin18-contract-test/latest.json','utf8'));
test('All actual simulator points map uniquely to IFC GlobalIds and original floors',()=>{
 assert.equal(registry.length,18);assert.equal(new Set(registry.map(p=>p.guid)).size,18);
 assert.equal(normalizeReadings(batch).length,18);
 assert.deepEqual([...new Set(registry.map(p=>p.floor))].sort(),['Level_02','Level_03','Level_04','Level_05']);
});
test('Reject invalid sensor, room, unit, type, duplicate and nonfinite value before persistence',()=>{
 const r=batch.readings[0];
 for(const x of [{...r,sensor_id:'bad'},{...r,room_id:'bad'},{...r,unit:'bad'},{...r,sensor_type:'power'},{...r,value:NaN},{...r,value:'24'},{...r,timestamp:'bad'}])assert.throws(()=>normalizeReadings(x));
 assert.throws(()=>normalizeReadings({readings:[r,r]}));assert.throws(()=>normalizeReadings({readings:[]}));
});
async function withServer(pool,run){const app=createSensorApp({pool});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await run('http://127.0.0.1:'+server.address().port)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}}
const post=(url,body)=>fetch(url+'/api/sensor-readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('HTTP batch commits 18 rows, publishes SSE, deduplicates retries, and restores ordered history from PostgreSQL',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('database/twin18.sql','utf8'));
 for(const p of registry)await db.query('INSERT INTO twin18.sensor_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[p.code,p.simulatorRoomId,p.ifcSensorId,p.guid,p.assetId,p.floor,p.sensorType,p.unit,p.mappingStatus]);
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 try{await withServer(pool,async url=>{
  const stream=await fetch(url+'/api/events');const reader=stream.body.getReader();await reader.read();
  const response=await post(url,batch);assert.equal(response.status,201);assert.equal((await response.json()).accepted,18);
  const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/event: sensor-reading/);await reader.cancel();
  assert.equal((await post(url,batch)).status,201);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM twin18.sensor_readings')).rows[0].n,18);
  const state=await (await fetch(url+'/api/bootstrap')).json();assert.equal(state.data.Assets.length,5);assert.equal(state.data.Sensor_Readings.length,18);assert.equal(state.storage,'postgresql');
  assert.equal((await (await fetch(url+'/api/live-status')).json()).received_points,18);
  const bad={...batch,readings:[...batch.readings.slice(0,17),{...batch.readings[17],room_id:'unknown'}]};assert.equal((await post(url,bad)).status,400);
 });
 // Fresh API state still restores committed readings; receipt coverage is fresh.
 await withServer(pool,async url=>{assert.equal((await (await fetch(url+'/api/bootstrap')).json()).data.Sensor_Readings.length,18);assert.equal((await (await fetch(url+'/api/live-status')).json()).received_points,0)});
 }finally{await db.close()}
});
test('A database failure rolls back the complete batch and leaves live coverage empty',async()=>{
 const calls=[];const pool={connect:async()=>({query:async sql=>{calls.push(sql);if(sql.startsWith('INSERT'))throw Error('database failure')},release(){}})};
 await withServer(pool,async url=>{assert.equal((await post(url,batch)).status,503);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));assert.equal((await (await fetch(url+'/api/live-status')).json()).received_points,0)});
});
test('Temporary mode is labelled and accepts both single and batch payloads',async()=>{
 await withServer(null,async url=>{assert.equal((await post(url,batch.readings[0])).status,201);assert.equal((await post(url,batch)).status,201);const state=await(await fetch(url+'/api/bootstrap')).json();assert.equal(state.storage,'temporary_memory');assert.equal(state.data.Sensor_Readings.length,18)});
});

test('Delivered XKT retains geometry and storey ancestry for all 18 sensor markers',()=>{
 const data=fs.readFileSync('public/models/FYP_WholeBuilding_18Sensors.xkt');
 assert.equal(data.readUInt32LE(0)&0x7fffffff,12);
 const count=data.readUInt32LE(4);let offset=(count+2)*4;const parts=[];
 for(let i=0;i<count;i++){const length=data.readUInt32LE((i+2)*4);parts.push(inflateSync(data.subarray(offset,offset+length)));offset+=length;}
 assert.equal(offset,data.length);
 const metadata=JSON.parse(parts[0].toString());const entities=new Set(JSON.parse(parts[25].toString()));
 const byId=new Map(metadata.metaObjects.map(m=>[m.id,m]));
 for(const p of registry){
  assert.ok(entities.has(p.guid),p.code+' geometry absent');let meta=byId.get(p.guid);const seen=new Set();
  while(meta&&meta.type!=='IfcBuildingStorey'&&!seen.has(meta.id)){seen.add(meta.id);meta=byId.get(meta.parent)}
  assert.equal(meta?.name,p.floor,p.code+' storey mismatch');
 }
});
test('Original Python simulator delivers a real HTTP batch to the integrated API',async()=>{
 await withServer(null,async url=>{
  const child=spawn('python3',['-m','tools.level03_simulator.simulator.run','--ticks','1','--http-url',url+'/api/sensor-readings','--out-dir','/tmp/twin18-http-test','--quiet']);
  let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
  assert.equal(code,0,stderr);
  const state=await(await fetch(url+'/api/bootstrap')).json();assert.equal(state.data.Sensor_Readings.length,18);
 });
});
