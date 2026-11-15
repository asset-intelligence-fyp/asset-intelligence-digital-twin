import test from 'node:test';
import assert from 'node:assert/strict';
import {createSensorApp} from '../server/sensorServer.js';
import {registry} from '../server/sensorContract.js';
const batch=(extra={})=>({generated_at_utc:new Date(Date.now()-10).toISOString(),clock_domain:'same_host',producer:'test_fixture',readings:registry.map(p=>({sensor_id:p.code,room_id:p.simulatorRoomId,value:p.unit==='binary'?0:20,timestamp:'2001-01-01T00:00:00Z',unit:p.unit,sensor_type:p.sensorType})),...extra});
test('Latency uses producer wall time, requires browser acknowledgements and does not count duplicates',async()=>{
 const server=createSensorApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const root=`http://127.0.0.1:${server.address().port}`;
 const post=(url,b)=>fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 const abort=new AbortController();const response=await fetch(root+'/api/events',{signal:abort.signal});const reader=response.body.getReader();
 try{
  await reader.read();assert.equal((await post('/api/sensor-readings',batch())).status,201);
  const text=new TextDecoder().decode((await reader.read()).value);
  const row=JSON.parse(text.split('data: ')[1].split('\n')[0]);assert.equal(row.trace.batch_size,18);
  let report=await (await fetch(root+'/api/benchmarks/latency')).json();assert.equal(report.completed_batches,0);assert.equal(report.pending_batches,1);assert.equal(report.p95_ms,null);
  await post('/api/benchmarks/rendered',{trace_id:row.trace.trace_id,client_id:'test'});
  await post('/api/benchmarks/rendered',{trace_id:row.trace.trace_id,client_id:'test'});
  report=await (await fetch(root+'/api/benchmarks/latency')).json();assert.equal(report.completed_batches,1);assert.equal(report.samples[0].points,18);assert.ok(report.max_ms<5000);assert.equal(report.assessment,'insufficient_samples');
  await post('/api/sensor-readings',batch({generated_at_utc:new Date(Date.now()+100000).toISOString()}));
  await post('/api/sensor-readings',batch({clock_domain:'remote_unsynchronized'}));
  report=await (await fetch(root+'/api/benchmarks/latency')).json();assert.equal(report.invalid_clock_batches,1);assert.equal(report.uninstrumented_batches,1);assert.equal(report.complete,false);
  await post('/api/benchmarks/reset',{});report=await (await fetch(root+'/api/benchmarks/latency')).json();assert.equal(report.total_batches,0);assert.equal(report.max_ms,null);
 }finally{abort.abort();await reader.cancel().catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
});
