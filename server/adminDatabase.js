import {requireAdmin} from './adminAuth.js';

const LEGACY_TABLES = Object.freeze({
  locations:'twin18.monitoring_locations',
  sensors:'twin18.sensor_registry',
  readings:'twin18.sensor_readings',
  maintenance:'twin18.maintenance_events'
});
// Curated administrator views. Internal lookup tables and unfinished features remain
// in PostgreSQL, but should not appear as user-facing database sections.
const V3_TABLES=Object.freeze({
 locations:'digital_twin.monitoring_locations',
 sensors:'digital_twin.sensor_registry',
 readings:'digital_twin.sensor_readings',
 buildings:'digital_twin.buildings',
 bim:'digital_twin.bim_models',
 maintenance:'digital_twin.maintenance_events'
});
const LIMIT=100;
function errorJson(res,e) {
 console.error('Admin database read error:',e.message);
 res.status(503).json({error:'Database query unavailable. Check PostgreSQL and migrations.'});
}
export function registerAdminDatabase(app,pool,activeSchema='twin18') {
  const schema=activeSchema==='digital_twin'?'digital_twin':'twin18';
  const TABLES=schema==='digital_twin'?V3_TABLES:LEGACY_TABLES;
  app.get('/api/admin/database/summary',requireAdmin,async (_req,res)=>{
    if(!pool) return res.status(503).json({error:'Configure PostgreSQL (not memory mode) first.'});
    try {
      const db=await pool.query('SELECT current_database() AS database, current_user AS database_user, current_setting(\'server_version\') AS postgres_version');
      const tables=await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name`,[schema]);
      const ext=await pool.query("SELECT extversion FROM pg_extension WHERE extname='timescaledb'");
      let hypertables=[];
      if(ext.rowCount) {
        const h=await pool.query("SELECT hypertable_schema,hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema=$1",[schema]);
        hypertables=h.rows;
      }
      res.json({database:db.rows[0],active_schema:schema,available_views:Object.keys(TABLES),tables:tables.rows.map(r=>r.table_name),timescaledb:{installed:ext.rowCount>0,version:ext.rows[0]?.extversion||null,hypertables}});
    } catch(e){errorJson(res,e);}
  });
  app.get('/api/admin/database/:table',requireAdmin,async(req,res)=>{
    if(!pool) return res.status(503).json({error:'Configure PostgreSQL first.'});
    const qualified=TABLES[req.params.table];
    if(!qualified) return res.status(404).json({error:'Unknown allowed table'});
    const offset=Math.max(0,Math.min(1000000,Number.parseInt(String(req.query.offset||'0'),10)||0));
    const order=req.params.table==='readings'?'reading_timestamp DESC':req.params.table==='maintenance'?'event_date DESC':req.params.table==='ai_results'?'created_at DESC':req.params.table==='forecasts'?'created_at DESC':req.params.table==='alerts'?'triggered_at DESC':req.params.table==='simulation_runs'?'created_at DESC':req.params.table==='notifications'?'created_at DESC':'1';
    try {
      const result=await pool.query(`SELECT * FROM ${qualified} ORDER BY ${order} LIMIT $1 OFFSET $2`,[LIMIT,offset]);
      res.setHeader('Cache-Control','no-store');
      res.json({table:req.params.table,rows:result.rows,offset,limit:LIMIT});
    }catch(e){errorJson(res,e);}
  });
}
