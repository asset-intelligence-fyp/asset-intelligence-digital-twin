import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createSensorApp} from '../server/sensorServer.js';
import {registry,normalizeReadings} from '../server/sensorContract.js';
const leak=registry.find(p=>p.sensorType==='water_leakage');
const row=(value,minute=0)=>({sensor_id:leak.code,room_id:leak.simulatorRoomId,unit:'binary',sensor_type:'water_leakage',timestamp:new Date(Date.UTC(2026,10,15,0,minute)).toISOString(),value,quality_flag:value===null?'missing':'ok'});
async function server(pool,schema,run){const app=createSensorApp({pool,schema});const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run('http://127.0.0.1:'+s.address().port)}finally{s.closeAllConnections();await new Promise(r=>s.close(r))}}
const send=(url,body)=>fetch(url+'/api/sensor-readings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const events=async url=>(await(await fetch(url+'/api/alerts')).json()).events;
async function lifecycle(url){
 for(let i=0;i<5;i++)assert.equal((await send(url,row(0,i))).status,201);
 const stream=await fetch(url+'/api/events?format=batch'),reader=stream.body.getReader();await reader.read();
 assert.equal((await send(url,row(1,5))).status,201);
 let text='';while(!text.includes('event: alert'))text+=new TextDecoder().decode((await reader.read()).value);assert.match(text,new RegExp(leak.code));await reader.cancel();
 let list=await events(url);assert.equal(list.length,1);const id=list[0].id;
 assert.equal(list[0].level,'Critical');assert.equal(list[0].automatic,true);assert.equal(list[0].point_code,leak.code);assert.equal(list[0].source,leak.assetId);assert.equal(list[0].evidence.length,6);assert.equal(list[0].evidence[0].value,0);assert.equal(list[0].reading_snapshot.value,1);
 const evidence=structuredClone(list[0].evidence);
 const ack=await fetch(url+`/api/anomalies/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Acknowledged'})});assert.equal(ack.status,200);assert.equal((await ack.json()).acknowledged,true);
 await send(url,row(1,6));await send(url,row(1,6));list=await events(url);assert.equal(list.length,1);assert.deepEqual(list[0].evidence,evidence);assert.equal(list[0].acknowledged,true);
 await send(url,row(0,7));list=await events(url);assert.ok(list[0].resolved_at);
 // Old deliveries cannot reopen an already recovered incident.
 await send(url,row(1,5));assert.equal((await events(url)).length,1);
 await send(url,row(1,8));list=await events(url);assert.equal(list.length,2);assert.equal(list[0].acknowledged,false);
 assert.equal((await(await fetch(url+'/api/bootstrap')).json()).data.Alerts.length,2);
 assert.equal((await fetch(url+'/api/anomalies/99999/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Acknowledged'})})).status,404);
 assert.equal((await fetch(url+`/api/anomalies/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'bad'})})).status,400);
}
test('Memory alerts: SSE, retained preceding readings, acknowledgement, deduplication, recovery and recurrence',()=>server(null,'twin18',lifecycle));
for(const schema of ['twin18','digital_twin'])test(`${schema}: atomic persistent alerts, safe rerun, restart, and acknowledgement`,async()=>{
 const db=new PGlite();const ddl=fs.readFileSync(schema==='twin18'?'database/twin18.sql':'database/schema_v3.sql','utf8');await db.exec(ddl);await db.exec(ddl);
 if(schema==='digital_twin'){
  await db.query("INSERT INTO digital_twin.buildings VALUES('SNOWDON','Test','Office',NULL)");
  for(const floor of new Set(registry.map(p=>p.floor)))await db.query("INSERT INTO digital_twin.building_floors VALUES('SNOWDON',$1)",[floor]);
  for(const p of new Map(registry.map(p=>[p.assetId,p])).values())await db.query("INSERT INTO digital_twin.monitoring_locations VALUES($1,$2,$3,'SNOWDON')",[p.assetId,p.locationLabel,p.floor]);
 }
 for(const p of registry)await db.query(`INSERT INTO ${schema}.sensor_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[p.code,p.simulatorRoomId,p.ifcSensorId,p.guid,p.assetId,p.floor,p.sensorType,p.unit,p.mappingStatus]);
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 try{await server(pool,schema,lifecycle);
 await server(pool,schema,async url=>{
  assert.equal((await events(url)).length,2);assert.equal((await events(url))[1].acknowledged,true);
  const assistant=await fetch(url+'/api/assistant/building',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'Explain the current leak reading and earlier incidents',scope:leak.code,use_model:false})});
  assert.equal(assistant.status,200);const answer=await assistant.json();
  assert.equal(answer.facts.filter(f=>f.incident).length,2);assert.match(answer.answer,/Previous incidents/);assert.ok(answer.facts.some(f=>f.incident&&f.resolved));
  await send(url,row(1,9));assert.equal((await events(url)).length,2);
  const health=await(await fetch(url+'/api/health')).json();assert.equal(health.schema,schema);assert.equal(health.timescale.hypertable,false);
 });
 // Simulate a database error in alert insertion: readings roll back as well.
 const failing={query:pool.query,connect:async()=>({query:async(sql,args)=>{if(sql.startsWith(`INSERT INTO ${schema}.alerts`))throw Error('injected alert storage failure');return db.query(sql,args)},release(){}})};
 await server(failing,schema,async url=>{
  await send(url,row(0,10));const before=(await db.query(`SELECT count(*)::int AS n FROM ${schema}.sensor_readings`)).rows[0].n;
  assert.equal((await send(url,row(1,11))).status,503);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${schema}.sensor_readings`)).rows[0].n,before);
 });
 }finally{await db.close()}
});
test('Missing values create a data-quality incident; normal return recovers it',async()=>server(null,'twin18',async url=>{
 await send(url,row(null));const list=await events(url);assert.equal(list[0].rule,'missing');assert.equal(list[0].reading_snapshot.value,null);
 await send(url,row(0,1));assert.ok((await events(url))[0].resolved_at);
}));
test('Measurements preserve binary semantics and reject impossible values',()=>{
 const humidity=registry.find(p=>p.sensorType==='humidity');assert.throws(()=>normalizeReadings({...row(0),sensor_id:humidity.code,room_id:humidity.simulatorRoomId,sensor_type:humidity.sensorType,unit:humidity.unit,value:101}));assert.throws(()=>normalizeReadings(row(2)));
});

test('Actual Python hybrid control produces a critical leak alert through HTTP',async()=>server(null,'twin18',async url=>{
 const {spawn}=await import('node:child_process');
 const control=await fetch(url+'/api/simulation/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fault:{kind:'leak',sensor_id:leak.code,duration_minutes:15,magnitude:1}})});assert.equal(control.status,200);
 const child=spawn('python3',['-m','tools.hybrid_simulator.run','--ticks','8','--interval-seconds','0.01','--seed','1234','--private-dir','/tmp/twinlabs-alert-hybrid-test','--http-url',url+'/api/sensor-readings']);let stderr='';child.stdout.resume();child.stderr.on('data',d=>stderr+=d);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});assert.equal(code,0,stderr);
 assert.ok((await events(url)).some(e=>e.point_code===leak.code&&e.level==='Critical'));
 assert.equal((await(await fetch(url+'/api/live-status')).json()).received_points,18);
}));
