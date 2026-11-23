import {randomBytes,createHash,scryptSync} from 'node:crypto';
import {requireAdmin,requireConfirmedAdmin} from './adminAuth.js';
import {registry} from './sensorContract.js';
import {sendInvitationEmail,emailConfigured} from './invitationEmail.js';

const fixed=new Set(registry.map(p=>p.code));
const clean=(v,max=120)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const validCode=v=>/^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(v);
const fail=(res,e)=>{const code=e.code;
 if(code==='23505')return res.status(409).json({error:'This code, IFC identifier, or email is already in use.'});
 if(code==='23503')return res.status(409).json({error:'This record is referenced elsewhere and cannot be deleted.'});
 if(code==='23514'||code==='23502'||code==='22P02')return res.status(400).json({error:'Invalid value or missing required field.'});
 console.error('Management API:',e);return res.status(503).json({error:'Database operation failed. Check the server log.'});
};
const safe=handler=>async(req,res)=>{try{await handler(req,res)}catch(e){fail(res,e)}};
function enabled(pool,schema,res){if(pool&&schema==='digital_twin')return true;res.status(503).json({error:'Digital Twin PostgreSQL schema is required.'});return false;}
async function audit(client,actor,action,target,detail={}){
 await client.query('INSERT INTO digital_twin.admin_audit(actor,action,target,detail) VALUES($1,$2,$3,$4::jsonb)',[actor,action,target,JSON.stringify(detail)]);
}
function transaction(pool,fn){return (async()=>{const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}})();}
export function registerAdminManagement(app,pool,schema='digital_twin'){
 app.get('/api/admin/manage/overview',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const [counts,locations,buildings]=await Promise.all([
   pool.query(`SELECT
    (SELECT count(*)::int FROM digital_twin.sensor_registry) sensors,
    (SELECT count(*)::int FROM digital_twin.monitoring_locations) locations,
    (SELECT count(*)::int FROM digital_twin.users) users,
    (SELECT count(*)::int FROM digital_twin.access_invites WHERE used_at IS NULL AND expires_at>now()) invites,
    (SELECT count(*)::int FROM digital_twin.sensor_readings) readings`),
   pool.query('SELECT location_code,display_name,floor_level,building_code FROM digital_twin.monitoring_locations ORDER BY floor_level,display_name'),
   pool.query('SELECT building_code,building_name FROM digital_twin.buildings ORDER BY building_code')
  ]);
  res.json({counts:counts.rows[0],locations:locations.rows,buildings:buildings.rows,fixedSensors:[...fixed],emailConfigured:emailConfigured()});
 }));
 app.get('/api/admin/manage/sensors',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const data=await pool.query(`SELECT r.point_code,r.location_code,r.floor_level,r.measurement_type,r.unit,
   r.mapping_status,r.simulator_room_id,r.ifc_sensor_id,r.ifc_global_id,
   l.display_name, (SELECT count(*)::int FROM digital_twin.sensor_readings d WHERE d.point_code=r.point_code) reading_count
   FROM digital_twin.sensor_registry r JOIN digital_twin.monitoring_locations l USING(location_code)
   ORDER BY r.location_code,r.point_code LIMIT 1000`);
  res.json({rows:data.rows.map(r=>({...r,model_bound:fixed.has(r.point_code)}))});
 }));
 app.post('/api/admin/manage/sensors',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const b=req.body||{},point_code=clean(b.point_code,80),location_code=clean(b.location_code,80);
  const measurement_type=clean(b.measurement_type,60),unit=clean(b.unit,24);
  const simulator_room_id=clean(b.simulator_room_id,80)||'manual_unmapped';
  const ifc_sensor_id=clean(b.ifc_sensor_id,80)||'manual:'+point_code;
  const ifc_global_id=clean(b.ifc_global_id,80)||'unmapped:'+point_code;
  if(!validCode(point_code)||!location_code||!measurement_type||!unit)return res.status(400).json({error:'Valid sensor code, location, type and unit are required.'});
  if(fixed.has(point_code))return res.status(409).json({error:'This is a built-in sensor. Edit its metadata instead.'});
  await transaction(pool,async c=>{
   const loc=await c.query('SELECT floor_level FROM digital_twin.monitoring_locations WHERE location_code=$1',[location_code]);
   if(!loc.rowCount){const e=new Error('Unknown location');e.code='22P02';throw e}
   await c.query(`INSERT INTO digital_twin.sensor_registry
    (point_code,location_code,floor_level,measurement_type,unit,simulator_room_id,ifc_sensor_id,ifc_global_id,mapping_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending_bim_mapping')`,
   [point_code,location_code,loc.rows[0].floor_level,measurement_type,unit,simulator_room_id,ifc_sensor_id,ifc_global_id]);
   await audit(c,req.admin.username,'sensor.create',point_code,{location_code});
  });
  res.status(201).json({ok:true,note:'Database sensor created. It is not in the fixed simulator or XKT model until both are updated.'});
 }));
 app.patch('/api/admin/manage/sensors/:code',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const code=req.params.code,b=req.body||{};
  const allowed=['location_code','measurement_type','unit'];
  const changes=allowed.filter(k=>Object.hasOwn(b,k));
  if(!changes.length)return res.status(400).json({error:'No editable sensor fields supplied.'});
  const values=changes.map(k=>clean(b[k],k==='unit'?24:80));
  if(values.some(x=>!x))return res.status(400).json({error:'Sensor fields cannot be empty.'});
  const changed=await transaction(pool,async c=>{
   const current=await c.query('SELECT * FROM digital_twin.sensor_registry WHERE point_code=$1 FOR UPDATE',[code]);
   if(!current.rowCount)return null;
   const i=changes.indexOf('location_code');
   let floor=current.rows[0].floor_level;
   if(i>=0){const loc=await c.query('SELECT floor_level FROM digital_twin.monitoring_locations WHERE location_code=$1',[values[i]]);if(!loc.rowCount)return null;floor=loc.rows[0].floor_level;}
   const set=changes.map((k,i)=>k+'=$'+(i+1));
   set.push('floor_level=$'+(values.length+1));
   const query=`UPDATE digital_twin.sensor_registry SET ${set.join(',')} WHERE point_code=$${values.length+2} RETURNING point_code`;
   const updated=await c.query(query,[...values,floor,code]);
   await audit(c,req.admin.username,'sensor.update',code,{fields:changes});
   return updated.rows[0];
  });
  if(!changed)return res.status(404).json({error:'Sensor or target location not found.'});
  res.json({ok:true,note:fixed.has(code)?'Metadata updated. Built-in viewer/simulator mappings still come from code files.':'Sensor metadata updated.'});
 }));
 app.delete('/api/admin/manage/sensors/:code',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const code=req.params.code;
  if(fixed.has(code))return res.status(409).json({error:'Built-in sensors cannot be removed here; this would desynchronise the fixed BIM and simulator.'});
  const result=await transaction(pool,async c=>{
   const existing=await c.query('SELECT point_code FROM digital_twin.sensor_registry WHERE point_code=$1 FOR UPDATE',[code]);
   if(!existing.rowCount)return 'missing';
   const refs=await c.query(`SELECT
    (SELECT count(*)::int FROM digital_twin.sensor_readings WHERE point_code=$1) readings,
    (SELECT count(*)::int FROM digital_twin.ai_results WHERE point_code=$1) ai,
    (SELECT count(*)::int FROM digital_twin.forecast_results WHERE point_code=$1) forecasts,
    (SELECT count(*)::int FROM digital_twin.alerts WHERE point_code=$1) alerts,
    (SELECT count(*)::int FROM digital_twin.maintenance_events WHERE point_code=$1) maintenance`,[code]);
   if(Object.values(refs.rows[0]).some(n=>n>0))return 'referenced';
   await c.query('DELETE FROM digital_twin.sensor_registry WHERE point_code=$1',[code]);
   await audit(c,req.admin.username,'sensor.delete',code);
   return 'deleted';
  });
  if(result==='missing')return res.status(404).json({error:'Sensor not found.'});
  if(result==='referenced')return res.status(409).json({error:'Cannot remove a sensor with readings, AI results, alerts or maintenance records. Historical data is preserved.'});
  res.json({ok:true});
 }));
 app.patch('/api/admin/manage/locations/:code',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const display_name=clean(req.body?.display_name,120),code=req.params.code;
  if(!display_name)return res.status(400).json({error:'Location name is required.'});
  const changed=await transaction(pool,async c=>{
   const r=await c.query('UPDATE digital_twin.monitoring_locations SET display_name=$1 WHERE location_code=$2 RETURNING location_code',[display_name,code]);
   if(r.rowCount)await audit(c,req.admin.username,'location.rename',code,{display_name});
   return r.rowCount;
  });
  if(!changed)return res.status(404).json({error:'Location not found.'});
  res.json({ok:true});
 }));
 app.get('/api/admin/manage/users',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const [users,invites,auditRows]=await Promise.all([
   pool.query(`SELECT u.user_id,u.username,u.email,u.is_active,r.role_name,u.created_at FROM digital_twin.users u JOIN digital_twin.roles r USING(role_id) ORDER BY u.created_at DESC LIMIT 250`),
   pool.query(`SELECT invite_id,email,role_name,expires_at,used_at,created_at,email_status,email_sent_at FROM digital_twin.access_invites ORDER BY created_at DESC LIMIT 100`),
   pool.query('SELECT actor,action,target,created_at FROM digital_twin.admin_audit ORDER BY audit_id DESC LIMIT 15')
  ]);
  res.json({users:users.rows,invites:invites.rows,audit:auditRows.rows});
 }));
 app.get('/api/admin/manage/audit',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const limit=50,offset=Math.min(10000,Math.max(0,Number.parseInt(req.query.offset,10)||0));
  const search=clean(req.query.search,100);
  const result=await pool.query(`SELECT audit_id,actor,action,target,detail,created_at
    FROM digital_twin.admin_audit
    WHERE ($1='' OR actor ILIKE '%'||$1||'%' OR action ILIKE '%'||$1||'%' OR target ILIKE '%'||$1||'%')
    ORDER BY audit_id DESC LIMIT $2 OFFSET $3`,[search,limit,offset]);
  res.json({rows:result.rows,limit,offset});
 }));
 app.get('/api/admin/manage/alerts',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const r=await pool.query(`SELECT a.alert_id,a.point_code,a.alert_type,a.message,a.triggered_at,a.resolved_at,
    a.detector,s.severity_name,t.status_name
    FROM digital_twin.alerts a JOIN digital_twin.alert_severity s ON s.alert_severity_id=a.alert_severity_id
    JOIN digital_twin.alert_status t ON t.alert_status_id=a.alert_status_id
    ORDER BY a.triggered_at DESC,a.alert_id DESC LIMIT 200`);
  res.json({rows:r.rows});
 }));
 app.patch('/api/admin/manage/alerts/:id/status',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id),status=clean(req.body?.status,32);
  if(!Number.isSafeInteger(id)||id<1||!['New','Review','Acknowledged','Closed'].includes(status))
   return res.status(400).json({error:'Invalid alert or status.'});
  const changed=await transaction(pool,async c=>{
   const prior=await c.query(`SELECT a.alert_id,t.status_name FROM digital_twin.alerts a
     JOIN digital_twin.alert_status t ON t.alert_status_id=a.alert_status_id WHERE a.alert_id=$1 FOR UPDATE OF a`,[id]);
   if(!prior.rowCount)return false;
   await c.query(`UPDATE digital_twin.alerts SET
     alert_status_id=(SELECT alert_status_id FROM digital_twin.alert_status WHERE status_name=$1),
     resolved_at=CASE WHEN $1='Closed' THEN COALESCE(resolved_at,now()) ELSE NULL END
     WHERE alert_id=$2`,[status,id]);
   await audit(c,req.admin.username,'alert.status',String(id),{previous:prior.rows[0].status_name,new:status});
   return true;
  });
  if(!changed)return res.status(404).json({error:'Alert not found.'});
  res.json({ok:true});
 }));
 app.get('/api/admin/manage/notifications',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const r=await pool.query(`SELECT n.notification_id,n.alert_id,n.user_id,u.username,
    n.message,n.created_at,n.read_at FROM digital_twin.notifications n
    JOIN digital_twin.users u ON u.user_id=n.user_id
    ORDER BY n.created_at DESC,n.notification_id DESC LIMIT 200`);
  res.json({rows:r.rows});
 }));
 app.patch('/api/admin/manage/notifications/:id/read',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id),read=req.body?.read;
  if(!Number.isSafeInteger(id)||id<1||typeof read!=='boolean')
    return res.status(400).json({error:'Invalid notification or read state.'});
  const changed=await transaction(pool,async c=>{
   const previous=await c.query('SELECT read_at FROM digital_twin.notifications WHERE notification_id=$1 FOR UPDATE',[id]);
   if(!previous.rowCount)return false;
   await c.query(`UPDATE digital_twin.notifications SET read_at=CASE WHEN $1 THEN now() ELSE NULL END
     WHERE notification_id=$2`,[read,id]);
   await audit(c,req.admin.username,read?'notification.read':'notification.unread',String(id));
   return true;
  });
  if(!changed)return res.status(404).json({error:'Notification not found.'});
  res.json({ok:true});
 }));
 app.post('/api/admin/manage/invites',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const email=clean(req.body?.email,254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
  const code=randomBytes(18).toString('base64url'),digest=createHash('sha256').update(code).digest('hex');
  const result=await transaction(pool,async c=>{
   const r=await c.query(`INSERT INTO digital_twin.access_invites (email,role_name,code_hash,expires_at,created_by)
    VALUES($1,'viewer',$2,now()+interval '7 days',$3) RETURNING invite_id,expires_at`,[email,digest,req.admin.username]);
   await audit(c,req.admin.username,'invite.create',email);
   return r.rows[0];
  });
  const delivery=await sendInvitationEmail({to:email,code,expiresAt:result.expires_at});
  try{
   await pool.query("UPDATE digital_twin.access_invites SET email_status=$1,email_sent_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE invite_id=$3",
    [delivery.sent?'sent':emailConfigured()?'failed':'not_configured',delivery.sent,result.invite_id]);
  }catch(e){console.error('Invitation delivery status update failed:',e.message);}

  res.status(201).json({...result,code,email,role:'viewer',emailSent:delivery.sent,deliveryMessage:delivery.sent?'Invitation accepted by email provider.':delivery.reason});
 }));
 app.post('/api/admin/manage/invites/:id/revoke',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid invitation ID.'});
  const rows=await transaction(pool,async c=>{
   const r=await c.query('DELETE FROM digital_twin.access_invites WHERE invite_id=$1 AND used_at IS NULL RETURNING email',[id]);
   if(r.rowCount)await audit(c,req.admin.username,'invite.revoke',r.rows[0].email);
   return r.rowCount;
  });
  if(!rows)return res.status(404).json({error:'Invitation was already used or does not exist.'});
  res.json({ok:true});
 }));
 app.post('/api/admin/manage/users/:id/role',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id),role=clean(req.body?.role,30);
  if(!Number.isSafeInteger(id)||!['viewer','admin'].includes(role))return res.status(400).json({error:'Invalid account or role.'});
  const result=await transaction(pool,async c=>{
   const rows=await c.query('SELECT user_id,username FROM digital_twin.users WHERE user_id=$1 FOR UPDATE',[id]);
   if(!rows.rowCount)return 'missing';
   if(rows.rows[0].user_id===req.admin.userId)return 'self';
   if(role==='viewer'){
    const admins=await c.query(`SELECT count(*)::int AS total FROM digital_twin.users u JOIN digital_twin.roles r USING(role_id) WHERE r.role_name='admin'`);
    if(admins.rows[0].total<=1)return 'last';
   }
   await c.query(`UPDATE digital_twin.users SET role_id=(SELECT role_id FROM digital_twin.roles WHERE role_name=$1) WHERE user_id=$2`,[role,id]);
   await audit(c,req.admin.username,'user.role',rows.rows[0].username,{role});
   return 'ok';
  });
  if(result!=='ok')return res.status(result==='missing'?404:409).json({error:result==='self'?'You cannot change your own role.':result==='last'?'Cannot remove the last administrator.':'User not found.'});
  res.json({ok:true});
 }));
 app.post('/api/admin/manage/users/:id/active',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id),active=req.body?.is_active;
  if(!Number.isSafeInteger(id)||id<1||typeof active!=='boolean')return res.status(400).json({error:'Invalid user or activation state.'});
  const status=await transaction(pool,async c=>{
   const user=await c.query('SELECT user_id,username,is_active FROM digital_twin.users WHERE user_id=$1 FOR UPDATE',[id]);
   if(!user.rowCount)return 'missing';
   if(user.rows[0].user_id===req.admin.userId&&!active)return 'self';
   if(!active){
    const admins=await c.query(`SELECT count(*)::int AS total FROM digital_twin.users u
      JOIN digital_twin.roles r USING(role_id) WHERE r.role_name='admin' AND u.is_active=TRUE`);
    const isAdmin=await c.query(`SELECT 1 FROM digital_twin.users u
      JOIN digital_twin.roles r USING(role_id) WHERE u.user_id=$1 AND r.role_name='admin'`,[id]);
    if(isAdmin.rowCount&&admins.rows[0].total<=1)return 'last';
   }
   await c.query('UPDATE digital_twin.users SET is_active=$1 WHERE user_id=$2',[active,id]);
   await audit(c,req.admin.username,active?'user.activate':'user.disable',user.rows[0].username);
   return 'updated';
  });
  if(status!=='updated')return res.status(status==='missing'?404:409).json({error:status==='self'?'You cannot disable your own account.':status==='last'?'Cannot disable the last active administrator.':'User not found.'});
  res.json({ok:true});
 }));
 app.get('/api/admin/manage/maintenance',requireAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const r=await pool.query(`SELECT m.maintenance_id,m.location_code,m.point_code,m.event_type,m.event_date,
    m.description,m.maintenance_status,m.performed_by,m.created_at,
    l.display_name
    FROM digital_twin.maintenance_events m JOIN digital_twin.monitoring_locations l USING(location_code)
    ORDER BY m.event_date DESC,m.maintenance_id DESC LIMIT 250`);
  res.json({rows:r.rows});
 }));
 app.post('/api/admin/manage/maintenance',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const b=req.body||{},location_code=clean(b.location_code,80),
   point_code=clean(b.point_code,80),event_type=clean(b.event_type,80),description=clean(b.description,1000),
   date=clean(b.event_date,60);
  if(!location_code||!event_type||!description||!date||!Number.isFinite(Date.parse(date)))return res.status(400).json({error:'Location, work type, date and description are required.'});
  const result=await transaction(pool,async c=>{
   const point=point_code?await c.query('SELECT location_code FROM digital_twin.sensor_registry WHERE point_code=$1',[point_code]):null;
   if(point_code&&(!point?.rowCount||point.rows[0].location_code!==location_code))return null;
   const row=await c.query(`INSERT INTO digital_twin.maintenance_events(location_code,point_code,event_type,event_date,description)
    VALUES($1,$2,$3,$4,$5) RETURNING maintenance_id`,[location_code,point_code||null,event_type,date,description]);
   await audit(c,req.admin.username,'maintenance.create',String(row.rows[0].maintenance_id),{location_code});
   return row.rows[0];
  });
  if(!result)return res.status(400).json({error:'The selected sensor does not belong to that location.'});
  res.status(201).json({ok:true,id:result.maintenance_id});
 }));
 app.patch('/api/admin/manage/maintenance/:id',requireAdmin,requireConfirmedAdmin,safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const id=Number(req.params.id),status=clean(req.body?.maintenance_status,30);
  if(!Number.isSafeInteger(id)||!['Scheduled','In Progress','Completed','Cancelled'].includes(status))return res.status(400).json({error:'Invalid maintenance ID or status.'});
  const rows=await transaction(pool,async c=>{
   const updated=await c.query('UPDATE digital_twin.maintenance_events SET maintenance_status=$1 WHERE maintenance_id=$2 RETURNING maintenance_id',[status,id]);
   if(updated.rowCount)await audit(c,req.admin.username,'maintenance.status',String(id),{status});
   return updated.rowCount;
  });
  if(!rows)return res.status(404).json({error:'Maintenance record not found.'});
  res.json({ok:true});
 }));
 // Invitation redemption is public by design: it creates only a viewer account.
 app.post('/api/access/redeem',safe(async(req,res)=>{
  if(!enabled(pool,schema,res))return;
  const code=clean(req.body?.code,100),username=clean(req.body?.username,80),password=req.body?.password;
  if(!/^[a-zA-Z0-9_-]{5,80}$/.test(username)||typeof password!=='string'||password.length<12||password.length>128||code.length<20)
   return res.status(400).json({error:'Use a valid username, 12+ character password and invitation code.'});
  const digest=createHash('sha256').update(code).digest('hex');
  const result=await transaction(pool,async c=>{
   const invite=await c.query(`SELECT invite_id,email FROM digital_twin.access_invites
    WHERE code_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,[digest]);
   if(!invite.rowCount)return false;
   const salt=randomBytes(16);
   const hash='scrypt:'+salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
   await c.query(`INSERT INTO digital_twin.users(role_id,username,email,password_hash)
    VALUES((SELECT role_id FROM digital_twin.roles WHERE role_name='viewer'),$1,$2,$3)`,
    [username,invite.rows[0].email,hash]);
   await c.query('UPDATE digital_twin.access_invites SET used_at=now() WHERE invite_id=$1',[invite.rows[0].invite_id]);
   await audit(c,username,'invite.redeem',invite.rows[0].email);
   return true;
  });
  if(!result)return res.status(400).json({error:'Invitation code invalid, expired, or already used.'});
  res.status(201).json({ok:true,message:'Viewer account created. You can now sign in.'});
 }));
}
