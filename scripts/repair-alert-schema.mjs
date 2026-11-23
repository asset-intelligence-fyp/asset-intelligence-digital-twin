// Additive, transactional compatibility migration for legacy digital_twin.alerts.
// Does not recreate tables, delete data, or modify sensor readings.
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{
 host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE||'digital_twin_18',
 ...(process.env.PGUSER?{user:process.env.PGUSER}:{}),
 ...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})
});
let client;
try{
 if(process.env.TWIN_STORAGE==='memory')throw Error('PostgreSQL is required; memory mode is not supported.');
 client=await pool.connect();
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock($1)',[81426731]);
 const tables=await client.query(`SELECT
  to_regclass('digital_twin.alerts') IS NOT NULL AS alerts,
  to_regclass('digital_twin.alert_status') IS NOT NULL AS statuses,
  to_regclass('digital_twin.alert_severity') IS NOT NULL AS severities`);
 if(Object.values(tables.rows[0]).some(v=>!v))throw Error('Required v3 alert tables are missing. This repair will not create or replace them.');
 const before=await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='digital_twin' AND table_name='alerts' AND column_name IN ('replay_id','detector','evidence')`);
 const existing=new Set(before.rows.map(x=>x.column_name));
 await client.query(`
  ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS replay_id TEXT;
  ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS detector TEXT;
  ALTER TABLE digital_twin.alerts ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
 `);
 await client.query("INSERT INTO digital_twin.alert_severity(severity_name) VALUES('Medium'),('Critical') ON CONFLICT DO NOTHING");
 await client.query("INSERT INTO digital_twin.alert_status(status_name) VALUES('New'),('Review'),('Acknowledged'),('Closed') ON CONFLICT DO NOTHING");
 await client.query('COMMIT');
 console.log('Alert compatibility verified. Added columns: '+(['replay_id','detector','evidence'].filter(x=>!existing.has(x)).join(', ')||'none')+'. Existing readings and alerts preserved.');
}catch(e){
 if(client)await client.query('ROLLBACK').catch(()=>{});
 console.error('Alert compatibility check failed:',e.message);
 process.exitCode=1;
}finally{client?.release();await pool.end();}
