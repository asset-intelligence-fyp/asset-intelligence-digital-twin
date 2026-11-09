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
  // Building selector options come from the same active PostgreSQL schema.
  // Legacy twin18 has no buildings table, so it has no building selector.
  app.get('/api/admin/buildings',requireAdmin,async(_req,res)=>{
    if(!pool)return res.status(503).json({error:'Configure PostgreSQL first.'});
    if(schema!=='digital_twin')return res.json({buildings:[]});
    try{
      const result=await pool.query('SELECT building_code, building_name FROM digital_twin.buildings ORDER BY building_name, building_code');
      res.setHeader('Cache-Control','no-store');
      res.json({buildings:result.rows});
    }catch(e){errorJson(res,e);}
  });
  app.get('/api/admin/database/:table',requireAdmin,async(req,res)=>{
    if(!pool) return res.status(503).json({error:'Configure PostgreSQL first.'});
    const qualified=TABLES[req.params.table];
    if(!qualified) return res.status(404).json({error:'Unknown allowed table'});
    const offset=Math.max(0,Math.min(1000000,Number.parseInt(String(req.query.offset||'0'),10)||0));
    const table=req.params.table;
    const order=table==='readings'?'r.reading_timestamp DESC':table==='maintenance'?'r.event_date DESC':table==='alerts'?'r.triggered_at DESC':'1';
    const building=typeof req.query.building==='string'?req.query.building.trim():'';
    const location=typeof req.query.location==='string'?req.query.location.trim():'';
    const point=typeof req.query.point==='string'?req.query.point.trim():'';
    if(building.length>100||location.length>100||point.length>100)return res.status(400).json({error:'Invalid filter'});
    const where=[],params=[];
    const bind=(value)=>{params.push(value);return '$'+params.length;};
    // Use parameterized filters, not string-interpolated user values.
    // Every filtered reading is linked via its registered sensor and location.
    let from=`${qualified} r`;
    if(schema==='digital_twin'){
      if(table==='locations'&&building)where.push(`r.building_code=${bind(building)}`);
      if(table==='sensors'){
        if(location)where.push(`r.location_code=${bind(location)}`);
        if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=r.location_code';where.push(`l.building_code=${bind(building)}`);}
      }
      if(table==='readings'){
        if(point)where.push(`r.point_code=${bind(point)}`);
        if(location||building){
          from+=' JOIN digital_twin.sensor_registry sr ON sr.point_code=r.point_code';
          if(location)where.push(`sr.location_code=${bind(location)}`);
          if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=sr.location_code';where.push(`l.building_code=${bind(building)}`);}
        }
      }
      if(table==='maintenance'){
        if(location)where.push(`r.location_code=${bind(location)}`);
        if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=r.location_code';where.push(`l.building_code=${bind(building)}`);}
      }
      if((table==='buildings'||table==='bim')&&building)where.push(`r.building_code=${bind(building)}`);
    }
    try {
      const result=await pool.query(`SELECT r.* FROM ${from} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${order} LIMIT ${bind(LIMIT)} OFFSET ${bind(offset)}`,params);
      res.setHeader('Cache-Control','no-store');
      res.json({table,rows:result.rows,offset,limit:LIMIT,filters:{building:building||null,location:location||null,point:point||null}});
    }catch(e){errorJson(res,e);}
  });
}
