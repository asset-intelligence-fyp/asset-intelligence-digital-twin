import express from 'express';
import {registerRoomAssistant} from './roomAssistant.js';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registry,normalizeReadings} from './sensorContract.js';
dotenv.config();
export function createSensorApp({pool=null}={}) {
 const app=express(); app.use(cors());app.use(express.json({limit:'1mb'}));
 const clients=new Set(), received=new Map(); let memory=[];
 app.get('/api/health',async(_req,res)=>{try{if(pool)await pool.query('SELECT 1');res.json({ok:true,storage:pool?'postgresql':'temporary_memory',synthetic:true})}catch{res.status(503).json({ok:false,error:'PostgreSQL unavailable'})}});
 app.get('/api/sensor-registry',(_req,res)=>res.json({points:registry,mapping:'demonstration_alias'}));
 app.get('/api/live-status',(_req,res)=>{
  const points=registry.map(p=>{const at=received.get(p.code);return {point_code:p.code,last_received_at:at||null,recent:!!at&&Date.now()-Date.parse(at)<90000}});
  res.setHeader('Cache-Control','no-store');res.json({transport:'http',expected_points:18,received_points:points.filter(p=>p.recent).length,points,recent:points.every(p=>p.recent),source:'synthetic_simulator',storage:pool?'postgresql':'temporary_memory'});
 });
 app.get('/api/events',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.flushHeaders();res.write(': connected\n\n');clients.add(res);
  const timer=setInterval(()=>res.write(': keepalive\n\n'),20000);req.on('close',()=>{clearInterval(timer);clients.delete(res)});
 });
 app.post('/api/sensor-readings',async(req,res)=>{
  let batch;try{batch=normalizeReadings(req.body)}catch(e){return res.status(400).json({error:e.message})}
  let client;
  try{
   if(pool){
    client=await pool.connect();await client.query('BEGIN');
    for(const r of batch)await client.query(`INSERT INTO twin18.sensor_readings(point_code,reading_timestamp,reading_value,quality) VALUES($1,$2,$3,$4) ON CONFLICT(point_code,reading_timestamp) DO UPDATE SET reading_value=EXCLUDED.reading_value,quality=EXCLUDED.quality`,[r.point_code,r.timestamp,r.value,r.quality]);
    await client.query('COMMIT');
   }else{for(const r of batch){memory=memory.filter(x=>x.point_code!==r.point_code||x.timestamp!==r.timestamp);memory.push(r)}memory=memory.slice(-18000)}
   // Publish only after the entire batch commits. Coverage uses receipt time,
   // independent of the simulator's historical or accelerated clock.
   for(const r of batch){received.set(r.point_code,new Date().toISOString());for(const c of clients)c.write(`event: sensor-reading\ndata: ${JSON.stringify(r)}\n\n`)}
   res.status(201).json({success:true,accepted:batch.length,storage:pool?'postgresql':'temporary_memory'});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('Sensor persistence failed:',e.message);res.status(503).json({error:'Batch was not saved; check database setup'})}finally{client?.release()}
 });
 app.get('/api/bootstrap',async(_req,res)=>{
  try{
   const locations=[...new Set(registry.map(p=>p.assetId))];
   const history=pool?(await pool.query(`SELECT point_code,reading_timestamp AS timestamp,reading_value::float8 AS value,quality FROM (SELECT * FROM twin18.sensor_readings ORDER BY reading_timestamp DESC LIMIT 18000) r ORDER BY reading_timestamp`)).rows:memory.slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
   const latest=new Map();for(const r of history)latest.set(r.point_code,r);
   res.json({storage:pool?'postgresql':'temporary_memory',synthetic:true,data:{
    Assets:locations.map(id=>({asset_id:id,asset_name:registry.find(p=>p.assetId===id).locationLabel,asset_type:'Monitoring location',status:'Monitoring'})),Maintenance_Events:[],Anomaly_Results:[],
    Sensor_Readings:[...latest.values()].map(r=>({...r,latest_update:r.timestamp})),Historical_Sensor_Readings:history,
    Sensors:registry,BIM_Models:[{model_name:'FYP whole building · 18 markers',file_reference:'/models/FYP_WholeBuilding_18Sensors.xkt'}]
   }});
  }catch(e){res.status(503).json({error:'Database not ready; run npm run db:setup',detail:e.message})}
 });
 registerRoomAssistant(app,{getHistory:async(codes)=>pool?(await pool.query('SELECT point_code,reading_timestamp AS timestamp,reading_value::float8 AS value,quality FROM (SELECT * FROM twin18.sensor_readings WHERE point_code=ANY($1::text[]) ORDER BY reading_timestamp DESC LIMIT 18000) r ORDER BY reading_timestamp',[codes])).rows:memory.filter(r=>codes.includes(r.point_code))});
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
