import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {createLatencyMetrics} from './latencyMetrics.js';
import {registerRoomAssistant} from './roomAssistant.js';
import cors from 'cors';import dotenv from 'dotenv';import pg from 'pg';
import path from 'node:path';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import {registry,normalizeReadings} from './sensorContract.js';
dotenv.config();
export function createSensorApp({pool=null}={}) {
 const app=express();app.use(cors());app.use(express.json({limit:'1mb'}));
 const clients=new Map(),received=new Map(),completed=new Map(),ring=[];
 const streamEpoch=randomUUID();let eventSequence=0,memory=[],lastSource=null,activeReplay=pool?undefined:null,ingestion=Promise.resolve();
 const latency=createLatencyMetrics({storage:pool?'postgresql':'temporary_memory'});latency.routes(app);
 const send=(res,text)=>{if(res.destroyed)return;try{if(!res.write(text)){res.end();clients.delete(res)}}catch{clients.delete(res)}};
 const control=(name,data)=>{for(const [res] of clients)send(res,`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)};
 const historyFor=async(codes=null)=>{if(pool&&activeReplay===undefined){const saved=await pool.query('SELECT replay_id FROM twin18.sensor_readings ORDER BY received_at DESC LIMIT 1');activeReplay=saved.rows[0]?.replay_id??null;}return pool?(await pool.query(`SELECT point_code,reading_timestamp AS timestamp,reading_value::float8 AS value,quality FROM (SELECT * FROM twin18.sensor_readings WHERE replay_id IS NOT DISTINCT FROM $1${codes?' AND point_code=ANY($2::text[])':''} ORDER BY reading_timestamp DESC LIMIT 18000) r ORDER BY reading_timestamp`,codes?[activeReplay,codes]:[activeReplay])).rows:memory.filter(r=>r.replay_id===activeReplay&&(!codes||codes.includes(r.point_code))).slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));};
 app.get('/api/health',async(_req,res)=>{try{if(pool)await pool.query('SELECT 1');res.json({ok:true,storage:pool?'postgresql':'temporary_memory',synthetic:true})}catch{res.status(503).json({ok:false,error:'PostgreSQL unavailable'})}});
 app.get('/api/sensor-registry',(_req,res)=>res.json({points:registry,mapping:'demonstration_alias'}));
 app.get('/api/live-status',(_req,res)=>{
  const points=registry.map(p=>{const at=received.get(p.code);return {point_code:p.code,last_received_at:at||null,recent:!!at&&Date.now()-Date.parse(at)<90000}});
  res.setHeader('Cache-Control','no-store');res.json({transport:'http_batch_then_sse',expected_points:18,received_points:points.filter(p=>p.recent).length,points,recent:points.every(p=>p.recent),source:'synthetic_simulator',producer:lastSource,storage:pool?'postgresql':'temporary_memory'});
 });
 app.get('/api/events',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.write(': connected\nretry: 1000\n\n');
  const format=req.query.format==='batch'?'batch':'legacy';clients.set(res,format);
  const cursor=req.headers['last-event-id'];
  if(format==='batch'&&cursor){
   const index=ring.findIndex(e=>e.id===cursor);
   if(index>=0){for(const event of ring.slice(index+1))send(res,event.text)}
   else send(res,`event: resync\ndata: ${JSON.stringify({reason:'Replay cursor expired or API restarted'})}\n\n`);
  }
  const timer=setInterval(()=>send(res,': keepalive\n\n'),15000);
  req.on('close',()=>{clearInterval(timer);clients.delete(res)});
 });
 app.post('/api/sensor-readings',async(req,res)=>{
  const receivedAt=Date.now();let release;const priorIngestion=ingestion;ingestion=new Promise(resolve=>{release=resolve});await priorIngestion;try{
  let batch,replay=null,batchKey=null,bodyHash=null;
  try{
   batch=normalizeReadings(req.body);
   if(req.body.replay_id!==undefined){
    replay=req.body.replay_id;
    if(typeof replay!=='string'||!/^[a-f0-9]{32}$/.test(replay)||req.body.producer!=='people_driven_v3.0_dataset_replay'||!['normal_weather_2023_2025','fault_weather_2026_q1'].includes(req.body.dataset)||!Number.isSafeInteger(req.body.sequence)||req.body.sequence<1||req.body.batch_id!==`${replay}:${req.body.sequence}`||batch.length!==18||new Set(batch.map(r=>r.timestamp)).size!==1)throw Error('Invalid 18-point dataset replay envelope');
    batchKey=req.body.batch_id;bodyHash=createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const prior=completed.get(batchKey);
    if(prior){if(prior.hash!==bodyHash)return res.status(409).json({error:'Batch ID reused with different contents'});return res.status(201).json({...prior.response,duplicate:true})}
    if(activeReplay===replay&&lastSource&&req.body.sequence<=lastSource.sequence)return res.status(409).json({error:'Out-of-order replay sequence'});
   }
  }catch(e){return res.status(400).json({error:e.message})}
  const trace=latency.begin(req.body,receivedAt);let client;
  try{
   if(pool){
    client=await pool.connect();await client.query('BEGIN');
    for(const r of batch)await client.query(`INSERT INTO twin18.sensor_readings(point_code,reading_timestamp,reading_value,quality,replay_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(point_code,reading_timestamp) DO UPDATE SET reading_value=EXCLUDED.reading_value,quality=EXCLUDED.quality,replay_id=EXCLUDED.replay_id,received_at=clock_timestamp()`,[r.point_code,r.timestamp,r.value,r.quality,replay]);
    await client.query('COMMIT');
   }else{
    if(replay!==activeReplay)memory=[];
    const keys=new Set(batch.map(r=>`${r.point_code}|${r.timestamp}`));
    memory=memory.filter(r=>!keys.has(`${r.point_code}|${r.timestamp}`));
    memory.push(...batch.map(r=>({...r,replay_id:replay})));memory=memory.slice(-18000);
   }
   const changed=replay!==activeReplay;
   if(changed){activeReplay=replay;received.clear();ring.length=0;control('source-reset',{replay_id:replay})}
   lastSource={name:req.body.producer||'external_simulator_unverified',replay_id:replay,dataset:req.body.dataset||null,sequence:req.body.sequence??null,source_sequence:req.body.source_sequence??null,dataset_timestamp:req.body.dataset_timestamp??batch[0]?.timestamp,dataset_sampling_minutes:req.body.dataset_sampling_minutes??null,release_interval_seconds:req.body.release_interval_seconds??null,generated_at_utc:req.body.generated_at_utc??null,received_at_utc:new Date(receivedAt).toISOString()};
   latency.commit(trace,batch);
   for(const row of batch){row.replay_id=replay;if(trace)row.trace={trace_id:trace.trace_id,batch_size:batch.length};received.set(row.point_code,new Date(receivedAt).toISOString())}
   const eventId=`${streamEpoch}:${++eventSequence}`;
   const payload={event_id:eventId,replay_id:replay,producer:lastSource,readings:batch};
   const text=`id: ${eventId}\nevent: sensor-batch\ndata: ${JSON.stringify(payload)}\n\n`;
   ring.push({id:eventId,text});if(ring.length>128)ring.shift();
   for(const [c,format] of clients){if(format==='batch')send(c,text);else for(const row of batch)send(c,`event: sensor-reading\ndata: ${JSON.stringify(row)}\n\n`)}
   const response={success:true,accepted:batch.length,storage:pool?'postgresql':'temporary_memory',event_id:eventId};
   if(batchKey){completed.set(batchKey,{hash:bodyHash,response});if(completed.size>256)completed.delete(completed.keys().next().value)}
   res.status(201).json(response);
  }catch(e){latency.failed(trace);if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Sensor persistence failed:',e.message);res.status(503).json({error:'Batch not saved. Check PostgreSQL and run npm run db:setup for the additive replay schema.'})}finally{client?.release()}
  }finally{release()}
 });
 app.get('/api/bootstrap',async(_req,res)=>{
  try{
   const locations=[...new Set(registry.map(p=>p.assetId))],history=await historyFor(),latest=new Map();
   for(const r of history)latest.set(r.point_code,r);
   res.setHeader('Cache-Control','no-store');res.json({storage:pool?'postgresql':'temporary_memory',synthetic:true,simulation:lastSource||{replay_id:activeReplay},data:{
    Assets:locations.map(id=>({asset_id:id,asset_name:registry.find(p=>p.assetId===id).locationLabel,asset_type:'Monitoring location',status:'Monitoring'})),Maintenance_Events:[],Anomaly_Results:[],
    Sensor_Readings:[...latest.values()].map(r=>({...r,latest_update:r.timestamp})),Historical_Sensor_Readings:history,
    Sensors:registry,BIM_Models:[{model_name:'FYP whole building · 18 markers',file_reference:'/models/FYP_WholeBuilding_18Sensors.xkt'}]
   }});
  }catch(e){res.status(503).json({error:'Database not ready; run npm run db:setup',detail:e.message})}
 });
 registerRoomAssistant(app,{getHistory:codes=>historyFor(codes)});
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(fs.existsSync(path.join(root,'dist')))app.use(express.static(path.join(root,'dist')));
 return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const memory=process.env.TWIN_STORAGE==='memory';
 const pool=memory?null:new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'digital_twin_18',...(process.env.PGUSER?{user:process.env.PGUSER}:{}),...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})});
 const port=Number(process.env.SERVER_PORT||3001);const server=createSensorApp({pool}).listen(port,()=>console.log(`Twin18 API: http://localhost:${port} · ${memory?'temporary memory':'PostgreSQL'}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await pool?.end();process.exit(0)}));
}
