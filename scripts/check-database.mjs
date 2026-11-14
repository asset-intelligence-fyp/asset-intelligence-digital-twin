import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const schema=process.env.TWIN_DB_SCHEMA==='digital_twin'?'digital_twin':'twin18';
if(process.env.TWIN_STORAGE==='memory'){
 console.error('TWIN_STORAGE=memory is set: the website will not use PostgreSQL. Remove it to use persistent storage.');process.exit(1);
}
const pool=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'digital_twin_18',...(process.env.PGUSER?{user:process.env.PGUSER}:{}),...(process.env.PGPASSWORD?{password:process.env.PGPASSWORD}:{})});
try{
 const registry=await pool.query(`SELECT count(*)::int AS sensors FROM ${schema}.sensor_registry`);
 const readings=await pool.query(`SELECT count(*)::int AS readings FROM ${schema}.sensor_readings`);
 const alerts=await pool.query(`SELECT count(*)::int AS alerts FROM ${schema}.alerts WHERE detector='threshold_v1'`);
 const ext=await pool.query("SELECT extversion FROM pg_extension WHERE extname='timescaledb'");
 let hypertable=false;if(ext.rows.length){const h=await pool.query('SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema=$1 AND hypertable_name=$2',[schema,'sensor_readings']);hypertable=h.rows.length>0;}
 console.log(JSON.stringify({schema,...registry.rows[0],...readings.rows[0],...alerts.rows[0],timescaledb_version:ext.rows[0]?.extversion||null,readings_hypertable:hypertable},null,2));
 if(registry.rows[0].sensors!==18)throw Error('Expected 18 sensors. Rerun setup for the active schema.');
 if(schema==='digital_twin'&&!hypertable)throw Error('The unified schema is reachable but its TimescaleDB hypertable is not confirmed. Rerun npm run db:setup:v3.');
}catch(e){console.error('Database verification failed:',e.message);process.exitCode=1}finally{await pool.end()}
