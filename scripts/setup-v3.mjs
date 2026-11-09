import pg from 'pg';
import fs from 'node:fs';
import dotenv from 'dotenv';
import {registry} from '../server/sensorContract.js';

dotenv.config();
const pool=new pg.Pool(process.env.DATABASE_URL
 ?{connectionString:process.env.DATABASE_URL}
 :{host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),
   database:process.env.PGDATABASE||'digital_twin_18',
   ...(process.env.PGUSER?{user:process.env.PGUSER}:{}),
   ...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})});
const SCHEMA='digital_twin';
let client;
try{
 client=await pool.connect();
 console.log('Preparing unified v3 schema (additive; no old tables dropped)...');
 await client.query(fs.readFileSync(new URL('../database/schema_v3.sql',import.meta.url),'utf8'));
 await client.query('BEGIN');
 try{
  await client.query(`INSERT INTO ${SCHEMA}.buildings(building_code,building_name,building_type)
   VALUES ('SNOWDON','FYP whole building','Office')
   ON CONFLICT(building_code) DO NOTHING`);
  for(const floor of [...new Set(registry.map(p=>p.floor))]){
   await client.query(`INSERT INTO ${SCHEMA}.building_floors(building_code,floor_level)
    VALUES('SNOWDON',$1) ON CONFLICT DO NOTHING`,[floor]);
  }
  const locations=[...new Map(registry.map(p=>[p.assetId,p])).values()];
  for(const p of locations){
   await client.query(`INSERT INTO ${SCHEMA}.monitoring_locations
    (location_code,display_name,floor_level,building_code) VALUES($1,$2,$3,'SNOWDON')
    ON CONFLICT(location_code) DO UPDATE SET display_name=EXCLUDED.display_name,
     floor_level=EXCLUDED.floor_level,building_code=EXCLUDED.building_code`,
    [p.assetId,p.locationLabel,p.floor]);
  }
  await client.query(`INSERT INTO ${SCHEMA}.bim_models(building_code,model_name,file_reference)
   VALUES('SNOWDON','FYP whole building · 18 markers','/models/FYP_WholeBuilding_18Sensors.xkt')
   ON CONFLICT(building_code) DO NOTHING`);
  for(const p of registry){
   await client.query(`INSERT INTO ${SCHEMA}.sensor_registry
     (point_code,simulator_room_id,ifc_sensor_id,ifc_global_id,location_code,
      floor_level,measurement_type,unit,mapping_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(point_code) DO UPDATE SET
      simulator_room_id=EXCLUDED.simulator_room_id,
      ifc_sensor_id=EXCLUDED.ifc_sensor_id,
      ifc_global_id=EXCLUDED.ifc_global_id,
      location_code=EXCLUDED.location_code,
      floor_level=EXCLUDED.floor_level,
      measurement_type=EXCLUDED.measurement_type,
      unit=EXCLUDED.unit,mapping_status=EXCLUDED.mapping_status`,
    [p.code,p.simulatorRoomId,p.ifcSensorId,p.guid,p.assetId,p.floor,p.sensorType,p.unit,p.mappingStatus]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}
 const ext=await client.query("SELECT extversion FROM pg_extension WHERE extname='timescaledb'");
 if(!ext.rowCount)throw new Error('TimescaleDB extension not installed in this database. The v3 tables and registry are ready; install/enable TimescaleDB then rerun setup.');
 await client.query("SELECT create_hypertable('digital_twin.sensor_readings','reading_timestamp',if_not_exists => TRUE,migrate_data => TRUE)");
 const status=await client.query(`SELECT (SELECT count(*) FROM digital_twin.sensor_registry)::int AS sensor_points,
  (SELECT count(*) FROM digital_twin.monitoring_locations)::int AS locations,
  (SELECT count(*) FROM digital_twin.sensor_readings)::int AS readings`);
 console.log('Unified v3 ready:',JSON.stringify(status.rows[0]));
 console.log('IMPORTANT: Existing public/twin18 tables and readings remain untouched.');
 console.log('To use v3 for the website, add TWIN_DB_SCHEMA=digital_twin in local .env and restart npm run dev.');
}catch(e){console.error('v3 setup failed:',e.message);process.exitCode=1}
finally{client?.release();await pool.end()}
