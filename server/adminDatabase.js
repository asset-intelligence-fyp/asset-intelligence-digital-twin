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
 floors:'digital_twin.building_floors',
 bim:'digital_twin.bim_models',
 bim_elements:'digital_twin.bim_elements',
 maintenance:'digital_twin.maintenance_events',
 ai_results:'digital_twin.ai_results',
 forecasts:'digital_twin.forecast_results',
 alerts:'digital_twin.alerts',
 notifications:'digital_twin.notifications'
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
    const table=req.params.table;
    const offset=Math.max(0,Math.min(1000000,Number.parseInt(String(req.query.offset||'0'),10)||0));
    const readParam=(key)=>typeof req.query[key]==='string'?req.query[key].trim():'';
    const building=readParam('building'),location=readParam('location'),point=readParam('point'),floor=readParam('floor');
    const search=readParam('search'),start=readParam('start'),end=readParam('end');
    const status=readParam('status'),quality=readParam('quality');
    if([building,location,point,floor,search,status,quality].some(v=>v.length>120)||[start,end].some(v=>v.length>40))
      return res.status(400).json({error:'Invalid filter length'});
    if((start&&!Number.isFinite(Date.parse(start)))||(end&&!Number.isFinite(Date.parse(end)))||(start&&end&&Date.parse(start)>Date.parse(end)))
      return res.status(400).json({error:'Invalid date range'});
    const where=[],params=[];
    const bind=(v)=>{params.push(v);return '$'+params.length;};
    let from=`${qualified} r`;
    const textSearch=(columns)=>{if(search)where.push('('+columns.map(c=>`CAST(${c} AS TEXT) ILIKE ${bind('%'+search+'%')}`).join(' OR ')+')');};
    if(schema==='digital_twin'){
      if(table==='buildings'){textSearch(['r.building_name','r.building_code']);}
      if(table==='floors'){if(building)where.push(`r.building_code=${bind(building)}`);}
      if(table==='bim'||table==='bim_elements'){if(building)where.push(`r.building_code=${bind(building)}`);}
      if(table==='locations'){
        if(floor)where.push(`r.floor_level=${bind(floor)}`);
        if(building)where.push(`r.building_code=${bind(building)}`);
        textSearch(['r.display_name','r.location_code']);
      }
      if(table==='sensors'){
        if(location)where.push(`r.location_code=${bind(location)}`);
        if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=r.location_code';where.push(`l.building_code=${bind(building)}`);}
        textSearch(['r.point_code','r.measurement_type','r.ifc_sensor_id']);
      }
      if(table==='readings'||table==='ai_results'||table==='forecasts'){
        if(point)where.push(`r.point_code=${bind(point)}`);
        if(location||building){
          from+=' JOIN digital_twin.sensor_registry sr ON sr.point_code=r.point_code';
          if(location)where.push(`sr.location_code=${bind(location)}`);
          if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=sr.location_code';where.push(`l.building_code=${bind(building)}`);}
        }
      }
      if(table==='readings'){
        if(quality)where.push(`r.quality=${bind(quality)}`);
        if(start)where.push(`r.reading_timestamp>=${bind(start)}::timestamptz`);
        if(end)where.push(`r.reading_timestamp<=${bind(end)}::timestamptz`);
      }
      if(table==='ai_results'||table==='forecasts'){
        const timeCol=table==='ai_results'?'r.observation_timestamp':'r.target_timestamp';
        if(start)where.push(`${timeCol}>=${bind(start)}::timestamptz`);
        if(end)where.push(`${timeCol}<=${bind(end)}::timestamptz`);
        if(table==='ai_results'&&status)where.push(`r.prediction=${bind(status)}`);
      }
      if(table==='maintenance'){
        if(location)where.push(`r.location_code=${bind(location)}`);
        if(building){from+=' JOIN digital_twin.monitoring_locations l ON l.location_code=r.location_code';where.push(`l.building_code=${bind(building)}`);}
        if(status)where.push(`r.maintenance_status=${bind(status)}`);
      }
      if(table==='alerts'&&status)where.push(`r.alert_status_id IN (SELECT alert_status_id FROM digital_twin.alert_status WHERE status_name=${bind(status)})`);
    }
    const order=table==='readings'?'r.reading_timestamp DESC':table==='maintenance'?'r.event_date DESC':
      table==='alerts'?'r.triggered_at DESC':table==='ai_results'||table==='forecasts'||table==='notifications'?'r.created_at DESC':'1';
    try {
      // Sensor registry is an overview, not a raw metadata dump. The LATERAL
      // lookup uses the (point_code, reading_timestamp) readings index and
      // returns the latest stored observation, even when the simulator is offline.
      const columns=table==='sensors'
        ? 'r.point_code, r.measurement_type, r.unit, r.location_code, latest.reading_value AS latest_value, latest.reading_timestamp AS latest_timestamp, latest.quality AS latest_quality'
        : 'r.*';
      const latestJoin=table==='sensors'
        ? ` LEFT JOIN LATERAL (
            SELECT sr_latest.reading_value, sr_latest.reading_timestamp, sr_latest.quality
            FROM ${schema}.sensor_readings sr_latest
            WHERE sr_latest.point_code=r.point_code
            ORDER BY sr_latest.reading_timestamp DESC LIMIT 1
          ) latest ON TRUE`
        : '';
      const result=await pool.query(
        `SELECT ${columns} FROM ${from}${latestJoin} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${order} LIMIT ${bind(LIMIT)} OFFSET ${bind(offset)}`,
        params);
      res.setHeader('Cache-Control','no-store');
      res.json({table,rows:result.rows,offset,limit:LIMIT});
    }catch(e){errorJson(res,e);}
  });
}
