import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Database,Radio,MapPin,Users,RefreshCw,Plus,Trash2,Save,Copy,ShieldCheck} from 'lucide-react';
import './adminWorkspace.css';

type Rec=Record<string,unknown>;
type Overview={counts:Record<string,number>;locations:Rec[];buildings:Rec[];fixedSensors:string[];emailConfigured?:boolean};
type DataSet={rows:Rec[];offset:number;limit:number;total?:number};
type Tab='overview'|'sensors'|'locations'|'maintenance'|'accounts'|'grant'|'audit'|'alerts'|'announcements'|'data';
const tabs:{key:Tab;label:string}[]=[
 {key:'overview',label:'Overview'},{key:'sensors',label:'Sensors'},
 {key:'locations',label:'Locations'},{key:'maintenance',label:'Maintenance'},
 {key:'alerts',label:'Alerts'},{key:'announcements',label:'Announcements'},
 {key:'accounts',label:'User Accounts'},{key:'grant',label:'Grant Access'},
 {key:'audit',label:'Audit Log'},{key:'data',label:'Database'}
];
const datasets=[
 ['buildings','Buildings'],['floors','Floors'],['locations','Locations'],['sensors','Sensors'],
 ['readings','Readings'],['bim','BIM models'],['bim_elements','BIM elements'],
 ['ai_results','AI results'],['forecasts','Forecasts'],['alerts','Alerts'],
 ['maintenance','Maintenance'],['notifications','Notifications']
];
type PendingChange={method:string;path:string;body:Record<string,unknown>};
let askForAdminPassword:((change:PendingChange)=>Promise<string|null>)|null=null;
async function request(url:string,options?:RequestInit,canConfirm=true){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 if(r.status===428&&canConfirm&&askForAdminPassword&&options?.method&&options.method!=='GET'){
  const change:PendingChange={method:options.method,path:url.split('?')[0],body:options.body?JSON.parse(String(options.body)) as Record<string,unknown>:{}};
  const authorization=await askForAdminPassword(change);
  if(!authorization)throw Error('Change cancelled.');
  return request(url,{...options,headers:{...options.headers,'X-Admin-Confirmation':authorization}},false);
 }
 const data=await r.json().catch(()=>({error:'Invalid server response'}));
 if(!r.ok)throw Error(data.error||'Request failed ('+r.status+')');
 return data;
}
const send=(method:string,payload?:unknown)=>({method,headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
const value=(x:unknown)=>x===null||x===undefined?'—':typeof x==='object'?JSON.stringify(x):String(x);
const brief=(x:unknown)=>{const s=value(x);return s.length>110?s.slice(0,107)+'…':s;};

const auditActionLabels:Record<string,string>={
 'invite.create':'Invitation Created','invite.redeem':'Invitation Accepted','invite.revoke':'Invitation Revoked',
 'user.role':'User Role Changed','user.activate':'Account Enabled','user.disable':'Account Disabled',
 'sensor.create':'Sensor Added','sensor.update':'Sensor Updated','sensor.delete':'Sensor Deleted',
 'alert.status':'Alert Status Changed','alert.acknowledge':'Alert Acknowledged',
 'announcement.create':'Announcement Created','announcement.update':'Announcement Updated',
 'maintenance.create':'Maintenance Created','maintenance.status':'Maintenance Status Changed',
 'notification.read':'Notification Read','notification.unread':'Notification Marked Unread'
};
const auditLabel=(action:unknown)=>{
 const name=String(action||'');
 return auditActionLabels[name]||name.split('.').map(part=>part.replaceAll('_',' ')).join(' · ')||'Unknown action';
};
const auditData=(input:unknown):Record<string,unknown>=>{
 if(input&&typeof input==='object'&&!Array.isArray(input))return input as Record<string,unknown>;
 if(typeof input==='string'){try{const obj:unknown=JSON.parse(input);if(obj&&typeof obj==='object'&&!Array.isArray(obj))return obj as Record<string,unknown>}catch{/* Older entries may not be JSON. */}}
 return {};
};
const auditSummary=(action:unknown,input:unknown)=>{
 const a=String(action||''),d=auditData(input);
 const previous=d.previous,newValue=d.new;
 const fmt=(x:unknown)=>typeof x==='object'&&x!==null?JSON.stringify(x):String(x);
 const changes=previous!==undefined&&newValue!==undefined
  ?(typeof previous==='object'&&previous!==null&&typeof newValue==='object'&&newValue!==null
   ?Object.keys(newValue as Record<string,unknown>).map(k=>k+': '+fmt((previous as Record<string,unknown>)[k])+' → '+fmt((newValue as Record<string,unknown>)[k])).join('; ')
   :fmt(previous)+' → '+fmt(newValue))
  :'';
 if(changes)return changes;
 if(a==='invite.create')return 'Invitation created';
 if(a==='invite.redeem')return 'Invited account registered';
 if(a==='invite.revoke')return d.invite_id!==undefined?'Invitation #'+fmt(d.invite_id)+' revoked':'Invitation revoked';
 if(a==='sensor.create')return d.location_code?'Sensor registered at '+fmt(d.location_code):'Sensor registered';
 if(a==='sensor.delete')return 'Sensor record deleted';
 if(a==='announcement.create')return d.title?'Draft created: '+fmt(d.title):'Announcement created';
 if(a==='announcement.update')return d.title?'Updated: '+fmt(d.title):'Announcement updated';
 if(a==='maintenance.create')return d.location_code?'Maintenance recorded at '+fmt(d.location_code):'Maintenance record created';
 if(a==='alert.acknowledge')return 'Alert acknowledged by the signed-in user';
 if(a==='user.activate')return 'Account enabled';
 if(a==='user.disable')return 'Account disabled';
 if(a==='notification.read')return 'Marked as read';
 if(a==='notification.unread')return 'Marked as unread';
 const entries=Object.entries(d).filter(([key])=>key!=='previous'&&key!=='new');
 return entries.length?entries.map(([key,v])=>key.replaceAll('_',' ')+': '+fmt(v)).join('; '):'No additional details recorded';
};

const baseSensor={point_code:'',location_code:'',measurement_type:'temperature',unit:'°C'};
type SensorForm=typeof baseSensor;
export function AdminWorkspace(){
 const [confirmOpen,setConfirmOpen]=useState(false);
 const [confirmPassword,setConfirmPassword]=useState('');
 const [confirmError,setConfirmError]=useState('');
 const [confirmBusy,setConfirmBusy]=useState(false);
 const confirmResolver=useRef<((value:string|null)=>void)|null>(null);
 const pendingChange=useRef<PendingChange|null>(null);
 useEffect(()=>{
  askForAdminPassword=(change)=>new Promise<string|null>(resolve=>{
   pendingChange.current=change;
   confirmResolver.current=resolve;
   setConfirmPassword('');setConfirmError('');setConfirmOpen(true);
  });
  return ()=>{askForAdminPassword=null;confirmResolver.current?.(null);confirmResolver.current=null;};
 },[]);
 const closeConfirm=(authorization:string|null)=>{
  setConfirmOpen(false);setConfirmPassword('');setConfirmError('');
  confirmResolver.current?.(authorization);confirmResolver.current=null;pendingChange.current=null;
 };
 async function submitConfirm(e:FormEvent){
  e.preventDefault();setConfirmBusy(true);setConfirmError('');
  try{
   const verified=await request('/api/admin/confirm-password',send('POST',{password:confirmPassword,action:pendingChange.current}),false) as {authorization:string};
   closeConfirm(verified.authorization);
  }catch(err){setConfirmError(err instanceof Error?err.message:String(err))}
  finally{setConfirmBusy(false)}
 }
 const [tab,setTab]=useState<Tab>('overview'),[overview,setOverview]=useState<Overview|null>(null);
 const [sensors,setSensors]=useState<Rec[]>([]),[users,setUsers]=useState<Rec[]>([]),[invites,setInvites]=useState<Rec[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [sensorSearch,setSensorSearch]=useState(''),[showNew,setShowNew]=useState(false);
 const [sensorForm,setSensorForm]=useState<SensorForm>(baseSensor),[editing,setEditing]=useState<string|null>(null);
 const [editForm,setEditForm]=useState({location_code:'',measurement_type:'',unit:''});

 const [inviteEmail,setInviteEmail]=useState(''),[newInvite,setNewInvite]=useState('');
 const [emailDelivery,setEmailDelivery]=useState('');
 const [readingSensor,setReadingSensor]=useState(''),[readingRows,setReadingRows]=useState<Rec[]>([]),[readingsLoading,setReadingsLoading]=useState(false);
 const [readingOffset,setReadingOffset]=useState(0);
 const [maintenance,setMaintenance]=useState<Rec[]>([]);
 const [adminAlerts,setAdminAlerts]=useState<Rec[]>([]),[announcements,setAnnouncements]=useState<Rec[]>([]);
 const [announcementForm,setAnnouncementForm]=useState({title:'',body:'',status:'draft'}),[editingAnnouncement,setEditingAnnouncement]=useState<number|null>(null),[announcementStatusFilter,setAnnouncementStatusFilter]=useState('all');
 const [auditRows,setAuditRows]=useState<Rec[]>([]),[auditOffset,setAuditOffset]=useState(0),[auditSearch,setAuditSearch]=useState('');
 const [alertFilter,setAlertFilter]=useState('all');
 const [work,setWork]=useState({location_code:'',point_code:'',event_type:'Inspection',event_date:new Date().toISOString().slice(0,16),description:''});
 const [showWork,setShowWork]=useState(false);
 const [datasetName,setDatasetName]=useState('buildings'),[dataset,setDataset]=useState<DataSet|null>(null);
 const [offset,setOffset]=useState(0),[dataSearch,setDataSearch]=useState('');
 const notify=(e:unknown)=>{setError(e instanceof Error?e.message:String(e));setMessage('');};
 const loadOverview=useCallback(async()=>setOverview(await request('/api/admin/manage/overview') as Overview),[]);
 const loadSensors=useCallback(async()=>setSensors((await request('/api/admin/manage/sensors') as {rows:Rec[]}).rows),[]);
 const loadAlerts=useCallback(async()=>setAdminAlerts((await request('/api/admin/manage/alerts') as {rows:Rec[]}).rows),[]);
 const loadAnnouncements=useCallback(async()=>setAnnouncements((await request('/api/admin/manage/announcements') as {rows:Rec[]}).rows),[]);
 const loadAudit=useCallback(async()=>{const params=new URLSearchParams({offset:String(auditOffset),search:auditSearch});setAuditRows((await request('/api/admin/manage/audit?'+params) as {rows:Rec[]}).rows)},[auditOffset,auditSearch]);
 const loadMaintenance=useCallback(async()=>setMaintenance((await request('/api/admin/manage/maintenance') as {rows:Rec[]}).rows),[]);
 const loadUsers=useCallback(async()=>{const data=await request('/api/admin/manage/users') as {users:Rec[];invites:Rec[]};setUsers(data.users);setInvites(data.invites)},[]);
 const loadDataset=useCallback(async()=>{const params=new URLSearchParams({offset:String(offset)});if(dataSearch&&['buildings','locations','sensors'].includes(datasetName))params.set('search',dataSearch);setDataset(await request('/api/admin/database/'+datasetName+'?'+params) as DataSet)},[datasetName,offset,dataSearch]);
 const refresh=useCallback(async(t:Tab=tab)=>{setBusy(true);setError('');try{
  if(t==='overview'||t==='locations')await loadOverview();
  if(t==='sensors')await Promise.all([loadSensors(),loadOverview()]);
  if(t==='accounts'||t==='grant')await Promise.all([loadUsers(),loadOverview()]);
  if(t==='audit')await loadAudit();
  if(t==='alerts')await loadAlerts();
  if(t==='announcements')await loadAnnouncements();
  if(t==='maintenance')await Promise.all([loadMaintenance(),loadOverview(),loadSensors()]);
  if(t==='data')await loadDataset();
 }catch(e){notify(e)}finally{setBusy(false)}},[tab,loadOverview,loadSensors,loadUsers,loadDataset,loadMaintenance,loadAlerts,loadAnnouncements,loadAudit]);
 useEffect(()=>{void refresh(tab)},[tab,refresh]);
 async function mutate(url:string,method:string,payload?:unknown,after?:()=>void){
  setBusy(true);setError('');setMessage('');
  try{const res=await request(url,send(method,payload));setMessage((res as {note?:string}).note||'Saved.');after?.();await refresh(tab);return true}
  catch(e){notify(e);return false}finally{setBusy(false)}
 }
 function startEdit(row:Rec){setReadingSensor('');setShowNew(false);setEditing(String(row.point_code));setEditForm({location_code:String(row.location_code),measurement_type:String(row.measurement_type),unit:String(row.unit)});window.scrollTo({top:0,behavior:'instant'})}
 function closeSensorEdit(){setEditing(null);window.scrollTo({top:0,behavior:'instant'})}
 async function showSensorReadings(code:string,nextOffset=0){
  setReadingSensor(code);setReadingOffset(nextOffset);setReadingsLoading(true);setError('');
  window.scrollTo({top:0,behavior:'instant'});
  try{
   const params=new URLSearchParams({point:code,offset:String(nextOffset)});
   const result=await request('/api/admin/database/readings?'+params) as DataSet;
   setReadingRows(result.rows);
  }catch(e){notify(e);setReadingRows([])}finally{setReadingsLoading(false)}
 }
 function closeSensorReadings(){
  setReadingSensor('');setReadingRows([]);setReadingOffset(0);
  window.scrollTo({top:0,behavior:'instant'});
 }
 const filtered=sensors.filter(r=>[r.point_code,r.display_name,r.measurement_type,r.location_code].some(v=>String(v).toLowerCase().includes(sensorSearch.toLowerCase())));
 const locations=overview?.locations||[];
 return <section className="admin-workspace" aria-label="Administration workspace">
  <header className="aw-header"><div><h1>Administration</h1></div><div className="aw-head-actions"><span className="aw-status">PostgreSQL · digital_twin</span><button type="button" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={15}/> Refresh</button></div></header>
  <div className="aw-frame"><nav className="aw-tabs" aria-label="Administration sections">{tabs.map(t=><button key={t.key} type="button" className={tab===t.key?'active':''} onClick={()=>{setError('');setMessage('');if(t.key!=='sensors'){closeSensorReadings();setEditing(null)}setTab(t.key)}}>{t.label}</button>)}</nav>
  {error&&<div className="aw-notice aw-error" role="alert">{error}</div>}
  {message&&<div className="aw-notice" role="status">{message}</div>}
  {tab==='overview'&&<div className="aw-content"><div className="aw-stats">{[
   {name:'Sensors',number:overview?.counts.sensors??'—',icon:<Radio size={20}/>},
   {name:'Locations',number:overview?.counts.locations??'—',icon:<MapPin size={20}/>},
   {name:'Accounts',number:overview?.counts.users??'—',icon:<Users size={20}/>},
   {name:'Readings',number:overview?.counts.readings??'—',icon:<Database size={20}/>}
  ].map(s=><div className="aw-stat" key={s.name}>{s.icon}<div><strong>{s.number}</strong><span>{s.name}</span></div></div>)}</div>
  <div className="aw-grid"><section className="aw-panel"><h2>Quick actions</h2><div className="aw-action-grid">
   <button onClick={()=>{setTab('sensors');setShowNew(true)}}><Plus size={17}/> Add sensor</button>
   <button onClick={()=>setTab('locations')}><MapPin size={17}/> View locations</button>
   <button onClick={()=>setTab('grant')}><ShieldCheck size={17}/> Invite a user</button>
   <button onClick={()=>setTab('data')}><Database size={17}/> View database</button>
  </div></section><section className="aw-panel"><h2>System</h2><div className="aw-system-row"><span>Schema</span><strong>digital_twin</strong></div><div className="aw-system-row"><span>Built-in BIM sensors</span><strong>{overview?.fixedSensors.length??'—'}</strong></div><div className="aw-system-row"><span>Open invitations</span><strong>{overview?.counts.invites??'—'}</strong></div><p className="aw-footnote">Database-only sensors require a separate BIM/XKT mapping and simulator configuration before they appear in the building viewer.</p></section></div></div>}
  {tab==='sensors'&&!readingSensor&&!editing&&<div className="aw-content"><div className="aw-toolbar"><input aria-label="Search sensors" placeholder="Search sensor, room or type" value={sensorSearch} onChange={e=>setSensorSearch(e.target.value)}/><button className="aw-primary" onClick={()=>{setShowNew(s=>!s);setEditing(null)}}><Plus size={15}/> Add sensor</button></div>
   {showNew&&<form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{e.preventDefault();const ok=await mutate('/api/admin/manage/sensors','POST',sensorForm,()=>{setShowNew(false);setSensorForm(baseSensor)});if(ok)await loadSensors()}}><h2>New sensor</h2><div className="aw-fields">
    <label>Sensor code<input required value={sensorForm.point_code} onChange={e=>setSensorForm({...sensorForm,point_code:e.target.value})} placeholder="TEMP-NEW-01"/></label>
    <label>Location<select required value={sensorForm.location_code} onChange={e=>setSensorForm({...sensorForm,location_code:e.target.value})}><option value="">Choose location</option>{locations.map(r=><option key={String(r.location_code)} value={String(r.location_code)}>{String(r.display_name)}</option>)}</select></label>
    <label>Type<input required value={sensorForm.measurement_type} onChange={e=>setSensorForm({...sensorForm,measurement_type:e.target.value})}/></label>
    <label>Unit<input required value={sensorForm.unit} onChange={e=>setSensorForm({...sensorForm,unit:e.target.value})}/></label>
   </div><div className="aw-actions"><button type="submit" className="aw-primary" disabled={busy}><Save size={14}/> Create</button><button type="button" onClick={()=>setShowNew(false)}>Cancel</button></div><p className="aw-footnote">The new sensor is saved to PostgreSQL with pending BIM mapping. It will not automatically appear inside the XKT model.</p></form>}
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Sensor registry</h2><span>{filtered.length} sensors</span></div><div className="aw-table-scroll"><table><thead><tr><th>Sensor</th><th>Location</th><th>Type</th><th>Unit</th><th>Mapping</th><th>Readings</th><th>Actions</th></tr></thead><tbody>{filtered.map(r=><tr key={String(r.point_code)}>
    <td><strong>{String(r.point_code)}</strong></td><td>{String(r.display_name)}</td><td>{String(r.measurement_type)}</td><td>{String(r.unit)}</td><td><span className={r.model_bound?'aw-tag good':'aw-tag pending'}>{r.model_bound?'Built-in':'Pending BIM'}</span></td><td>{String(r.reading_count)}</td>
    <td className="aw-row-actions"><button onClick={()=>void showSensorReadings(String(r.point_code))}>Readings</button><button onClick={()=>startEdit(r)}>Edit</button><button disabled={Boolean(r.model_bound)||busy} title={r.model_bound?'Built-in BIM sensors are protected':'Remove database-only sensor'} onClick={async()=>{if(window.confirm('Delete '+r.point_code+'? Only unreferenced, database-only sensors can be removed.'))await mutate('/api/admin/manage/sensors/'+encodeURIComponent(String(r.point_code)),'DELETE')}}><Trash2 size={14}/></button></td>
   </tr>)}</tbody></table>{!filtered.length&&<p className="aw-empty">No matching sensors.</p>}</div></div>
  </div>}
  {tab==='sensors'&&editing&&<div className="aw-content" aria-label="Edit sensor details">
   <div className="aw-reading-toolbar"><button type="button" onClick={closeSensorEdit}>← Back to sensors</button></div>
   <div className="aw-panel aw-form">
    <h2>Edit sensor · {editing}</h2>
    <div className="aw-fields">
     <label>Location<select value={editForm.location_code} onChange={e=>setEditForm({...editForm,location_code:e.target.value})}>{locations.map(r=><option key={String(r.location_code)} value={String(r.location_code)}>{String(r.display_name)}</option>)}</select></label>
     <label>Type<input value={editForm.measurement_type} onChange={e=>setEditForm({...editForm,measurement_type:e.target.value})}/></label>
     <label>Unit<input value={editForm.unit} onChange={e=>setEditForm({...editForm,unit:e.target.value})}/></label>
    </div>
    <div className="aw-actions"><button className="aw-primary" disabled={busy} onClick={async()=>{if(await mutate('/api/admin/manage/sensors/'+encodeURIComponent(editing),'PATCH',editForm))closeSensorEdit()}}><Save size={14}/> Save changes</button><button type="button" disabled={busy} onClick={closeSensorEdit}>Cancel</button></div>
    <p className="aw-footnote">Each save requires administrator password confirmation. Changing metadata does not rewrite the fixed simulator registry or relocate IFC geometry.</p>
   </div>
  </div>}
  {tab==='sensors'&&readingSensor&&<div className="aw-content" aria-label="Sensor reading details">
   <div className="aw-reading-toolbar">
    <button type="button" onClick={closeSensorReadings}>← Back to sensors</button>
    <div className="aw-actions"><button type="button" disabled={readingsLoading} onClick={()=>void showSensorReadings(readingSensor,readingOffset)}><RefreshCw size={14}/> Refresh</button></div>
   </div>
   <section className="aw-panel aw-reading-summary">
    <div><span className="aw-status">Sensor readings</span><h2>{readingSensor}</h2>
    <p className="aw-footnote">{value(sensors.find(r=>r.point_code===readingSensor)?.display_name)} · {value(sensors.find(r=>r.point_code===readingSensor)?.measurement_type)} · {value(sensors.find(r=>r.point_code===readingSensor)?.unit)}</p></div>
    <div className="aw-reading-meta"><strong>{value(sensors.find(r=>r.point_code===readingSensor)?.reading_count)}</strong><span>Total stored readings</span></div>
   </section>
   <section className="aw-panel aw-table-shell">
    <div className="aw-panel-head"><h2>Reading history</h2><span>Most recent first · 100 per page</span></div>
    {readingsLoading?<p className="aw-empty">Loading readings…</p>:<div className="aw-table-scroll">
     <table><thead><tr><th>Recorded at</th><th>Value</th><th>Quality</th><th>Replay ID</th></tr></thead>
     <tbody>{readingRows.map((r,i)=><tr key={i}><td>{new Date(String(r.reading_timestamp||r.timestamp)).toLocaleString()}</td><td>{value(r.reading_value??r.value)} {value(sensors.find(sensor=>sensor.point_code===readingSensor)?.unit)}</td><td>{value(r.quality)}</td><td>{brief(r.replay_id)}</td></tr>)}</tbody></table>
     {!readingRows.length&&<p className="aw-empty">No historical readings for this sensor.</p>}
    </div>}
   </section>
   <div className="aw-pagination"><button disabled={readingOffset===0||readingsLoading} onClick={()=>void showSensorReadings(readingSensor,Math.max(0,readingOffset-100))}>Previous</button><span>{readingRows.length?readingOffset+1:0}–{readingOffset+readingRows.length}</span><button disabled={readingRows.length<100||readingsLoading} onClick={()=>void showSensorReadings(readingSensor,readingOffset+100)}>Next</button></div>
  </div>}
  {tab==='locations'&&<div className="aw-content">
   <div className="aw-panel aw-table-shell">
    <div className="aw-panel-head"><h2>Monitoring locations</h2><span>{locations.length} locations</span></div>
    <div className="aw-table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Floor</th><th>Building</th></tr></thead><tbody>
     {locations.map(r=><tr key={String(r.location_code)}><td>{String(r.location_code)}</td><td>{String(r.display_name)}</td><td>{String(r.floor_level)}</td><td>{String(r.building_code)}</td></tr>)}
    </tbody></table></div>
   </div>
   <p className="aw-footnote">These monitoring locations are fixed to the current building configuration. Sensor assignments and BIM geometry are managed separately.</p>
  </div>}
  {tab==='maintenance'&&<div className="aw-content">
   <div className="aw-toolbar"><span className="aw-status">{maintenance.length} maintenance records</span><button className="aw-primary" onClick={()=>setShowWork(x=>!x)}><Plus size={14}/> New work</button></div>
   {showWork&&<form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{e.preventDefault();const payload={...work,event_date:new Date(work.event_date).toISOString()};const ok=await mutate('/api/admin/manage/maintenance','POST',payload);if(ok){setShowWork(false);setWork({...work,description:''})}}}><h2>Schedule maintenance</h2><div className="aw-fields">
    <label>Location<select required value={work.location_code} onChange={e=>setWork({...work,location_code:e.target.value,point_code:''})}><option value="">Choose location</option>{locations.map(l=><option value={String(l.location_code)} key={String(l.location_code)}>{String(l.display_name)}</option>)}</select></label>
    <label>Sensor (optional)<select value={work.point_code} onChange={e=>setWork({...work,point_code:e.target.value})}><option value="">No specific sensor</option>{sensors.filter(r=>r.location_code===work.location_code).map(r=><option value={String(r.point_code)} key={String(r.point_code)}>{String(r.point_code)}</option>)}</select></label>
    <label>Work type<input required value={work.event_type} onChange={e=>setWork({...work,event_type:e.target.value})}/></label>
    <label>Date<input required type="datetime-local" value={work.event_date} onChange={e=>setWork({...work,event_date:e.target.value})}/></label>
   </div><label>Work description<input required value={work.description} onChange={e=>setWork({...work,description:e.target.value})}/></label><div className="aw-actions"><button type="submit" className="aw-primary" disabled={busy}><Save size={14}/> Create work</button><button type="button" onClick={()=>setShowWork(false)}>Cancel</button></div></form>}
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Maintenance</h2><span>Newest first</span></div><div className="aw-table-scroll"><table><thead><tr><th>ID</th><th>Location</th><th>Type</th><th>Due</th><th>Description</th><th>Status</th></tr></thead><tbody>{maintenance.map(m=><tr key={String(m.maintenance_id)}><td>{String(m.maintenance_id)}</td><td>{String(m.display_name)}</td><td>{String(m.event_type)}</td><td>{new Date(String(m.event_date)).toLocaleString()}</td><td title={String(m.description)}>{brief(m.description)}</td><td><select aria-label={'Maintenance status '+m.maintenance_id} disabled={busy} value={String(m.maintenance_status)} onChange={e=>void mutate('/api/admin/manage/maintenance/'+m.maintenance_id,'PATCH',{maintenance_status:e.target.value})}>{['Scheduled','In Progress','Completed','Cancelled'].map(st=><option key={st}>{st}</option>)}</select></td></tr>)}</tbody></table>{!maintenance.length&&<p className="aw-empty">No maintenance records yet.</p>}</div></div>
  </div>}

  {tab==='accounts'&&<div className="aw-content">
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Accounts</h2><span>{users.length} users</span></div><div className="aw-table-scroll"><table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Access controls</th></tr></thead><tbody>{users.map(u=><tr key={String(u.user_id)}><td>{String(u.username)}</td><td>{String(u.email)}</td><td><span className="aw-tag">{String(u.role_name)}</span></td><td><span className={u.is_active===false?"aw-tag pending":"aw-tag good"}>{u.is_active===false?"Disabled":"Active"}</span></td><td>{new Date(String(u.created_at)).toLocaleDateString()}</td><td><div className="aw-row-actions"><select aria-label={'Role for '+u.username} value={String(u.role_name)} disabled={busy} onChange={async e=>{if(window.confirm('Change role for '+u.username+'?'))await mutate('/api/admin/manage/users/'+u.user_id+'/role','POST',{role:e.target.value})}}><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button disabled={busy||String(u.username)==="admin"&&users.filter(x=>x.role_name==="admin"&&x.is_active!==false).length<=1} onClick={async()=>{const enabling=u.is_active===false;if(window.confirm((enabling?"Enable ":"Disable ")+String(u.username)+"?"))await mutate("/api/admin/manage/users/"+u.user_id+"/active","POST",{is_active:enabling})}}>{u.is_active===false?"Enable":"Disable"}</button></div></td></tr>)}</tbody></table></div></div>
  
   <p className="aw-footnote">Each role or account-status change requires administrator password confirmation. Disabling an account blocks new sign-ins and protected Admin API access.</p>
  </div>}
  {tab==='grant'&&<div className="aw-content">
   <div className="aw-grant-panel"><form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{e.preventDefault();setBusy(true);setNewInvite('');setEmailDelivery('');try{const r=await request('/api/admin/manage/invites',send('POST',{email:inviteEmail})) as {code:string;emailSent:boolean;deliveryMessage:string};setNewInvite(r.code);setEmailDelivery(r.emailSent?'Email accepted by provider.':r.deliveryMessage);setInviteEmail('');await loadUsers();setMessage(r.emailSent?'Invitation email accepted by provider.':'Invitation created; email not sent. Copy and share the code privately.')}catch(e){notify(e)}finally{setBusy(false)}}}><h2>Grant access</h2><label>Email<input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} required placeholder="person@example.com"/></label><button className="aw-primary" disabled={busy} type="submit"><Plus size={15}/> {overview?.emailConfigured?'Send invitation':'Generate invitation code'}</button>{emailDelivery&&<p className="aw-footnote" role="status">{emailDelivery}</p>}{newInvite&&<div className="aw-invite-code"><code>{newInvite}</code><button type="button" onClick={()=>{if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(newInvite);else window.prompt('Copy invitation code:',newInvite)}}><Copy size={14}/> Copy</button></div>}<p className="aw-footnote">One-use viewer invitation, valid for seven days. {overview?.emailConfigured?'Email delivery enabled.':'Email delivery not configured; copy the code to share.'}</p></form></div>
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Invitations</h2><span>{invites.length} recent</span></div><div className="aw-table-scroll"><table><thead><tr><th>Recipient</th><th>Invitation Status</th><th>Email Delivery</th><th>Accepted / Expires</th><th>Action</th></tr></thead><tbody>{invites.map(i=>{const status=i.used_at?'Accepted':i.revoked_at?'Revoked':new Date(String(i.expires_at)).getTime()<=Date.now()?'Expired':'Pending';return <tr key={String(i.invite_id)}><td>{String(i.email)}</td><td><span className={status==='Accepted'?'aw-tag good':status==='Pending'?'aw-tag':'aw-tag pending'}>{status}</span></td><td>{String(i.email_status||'not_configured').replaceAll('_',' ')}</td><td>{status==='Accepted'?'Accepted '+new Date(String(i.used_at)).toLocaleString():status==='Revoked'?'Revoked '+new Date(String(i.revoked_at)).toLocaleString():'Expires '+new Date(String(i.expires_at)).toLocaleString()}</td><td>{status==='Pending'&&<button disabled={busy} onClick={()=>void mutate('/api/admin/manage/invites/'+i.invite_id+'/revoke','POST')}>Revoke</button>}</td></tr>})}</tbody></table></div></div>
  
  </div>}
  {tab==='audit'&&<div className="aw-content">
   <div className="aw-toolbar"><input aria-label="Search audit records" value={auditSearch} placeholder="Search user, action or target" onChange={e=>{setAuditSearch(e.target.value);setAuditOffset(0)}}/><span className="aw-status">Administrator activity · newest first</span></div>
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Audit Log</h2><span>{auditRows.length} records</span></div>
    <div className="aw-table-scroll"><table><thead><tr><th>Time</th><th>Performed by</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
    <tbody>{auditRows.map(a=><tr key={String(a.audit_id)}><td>{new Date(String(a.created_at)).toLocaleString()}</td><td><strong>{value(a.actor)}</strong></td><td title={value(a.action)}>{auditLabel(a.action)}</td><td>{value(a.target)}</td><td><div className="aw-audit-details"><span title={auditSummary(a.action,a.detail)}>{auditSummary(a.action,a.detail)}</span></div></td></tr>)}</tbody></table>{!auditRows.length&&<p className="aw-empty">No audit records for this filter.</p>}</div></div>
   <div className="aw-pagination"><button disabled={auditOffset===0||busy} onClick={()=>setAuditOffset(Math.max(0,auditOffset-50))}>Previous</button><span>{auditOffset+1}–{auditOffset+auditRows.length}</span><button disabled={auditRows.length<50||busy} onClick={()=>setAuditOffset(auditOffset+50)}>Next</button></div>
  </div>}
  {tab==='alerts'&&<div className="aw-content">
   <div className="aw-toolbar"><div className="aw-select-label">Status <select aria-label="Filter alerts" value={alertFilter} onChange={e=>setAlertFilter(e.target.value)}>{['all','New','Review','Acknowledged','Closed'].map(v=><option key={v} value={v}>{v==='all'?'All statuses':v}</option>)}</select></div><span className="aw-status">{adminAlerts.length} recent alerts · last 200</span></div>
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Alerts</h2></div>
    <div className="aw-table-scroll"><table><thead><tr><th>Triggered</th><th>Sensor</th><th>Severity</th><th>Alert</th><th>Message</th><th>Status</th><th>Acknowledged by</th><th>Acknowledged at</th><th>Admin actions</th></tr></thead>
    <tbody>{adminAlerts.filter(a=>alertFilter==='all'||a.status_name===alertFilter).map(a=><tr key={String(a.alert_id)}>
     <td>{new Date(String(a.triggered_at)).toLocaleString()}</td>
     <td>{value(a.point_code)}</td><td><span className="aw-tag">{value(a.severity_name)}</span></td>
     <td>{value(a.alert_type)}</td><td title={value(a.message)}>{brief(a.message)}</td>
     <td><span className="aw-tag">{value(a.status_name)}</span></td>
     <td>{value(a.acknowledged_by)}</td><td>{a.acknowledged_at?new Date(String(a.acknowledged_at)).toLocaleString():'—'}</td>
     <td><div className="aw-row-actions">
      {a.status_name==='Acknowledged'&&<button type="button" disabled={busy} onClick={()=>void mutate('/api/admin/manage/alerts/'+a.alert_id+'/status','PATCH',{status:'Review'})}>Review</button>}
      {a.status_name!=='Closed'&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('Close alert '+a.alert_id+'? This records an administrator closure.'))void mutate('/api/admin/manage/alerts/'+a.alert_id+'/status','PATCH',{status:'Closed'})}}>Close</button>}
      {a.status_name==='Closed'&&<span className="aw-status">Closed</span>}
     </div></td>
    </tr>)}</tbody></table>{!adminAlerts.length&&<p className="aw-empty">No alerts recorded.</p>}</div></div>
   <p className="aw-footnote">Users acknowledge alerts from Events. This page monitors alert status, who acknowledged it and when. Administrators can Review or Close; each change requires password confirmation and is recorded in the Audit Log. Acknowledgement does not mean the fault is resolved.</p>
  </div>}
  {tab==='announcements'&&<div className="aw-content">
   <div className="aw-toolbar"><div className="aw-select-label">Show <select value={announcementStatusFilter} aria-label="Filter announcements" onChange={e=>setAnnouncementStatusFilter(e.target.value)}>
    <option value="all">All announcements</option><option value="draft">Drafts</option><option value="published">Published</option><option value="archived">Archived</option>
   </select></div><span className="aw-status">{announcements.filter(a=>a.status==='published').length} published</span></div>
   <form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{
    e.preventDefault();const data={title:announcementForm.title.trim(),body:announcementForm.body.trim(),status:announcementForm.status};
    const ok=await mutate(editingAnnouncement===null?'/api/admin/manage/announcements':'/api/admin/manage/announcements/'+editingAnnouncement,
     editingAnnouncement===null?'POST':'PATCH',editingAnnouncement===null?{title:data.title,body:data.body}:data);
    if(ok){setEditingAnnouncement(null);setAnnouncementForm({title:'',body:'',status:'draft'});}
   }}>
    <div className="aw-panel-head"><h2>{editingAnnouncement===null?'New announcement':'Edit announcement'}</h2>
     {editingAnnouncement!==null&&<button type="button" onClick={()=>{setEditingAnnouncement(null);setAnnouncementForm({title:'',body:'',status:'draft'})}}>Cancel edit</button>}</div>
    <label>Title<input required maxLength={140} placeholder="Announcement title" value={announcementForm.title} onChange={e=>setAnnouncementForm({...announcementForm,title:e.target.value})}/></label>
    <label>Message<textarea required maxLength={2000} rows={4} placeholder="Write a notice for TwinLabs users" value={announcementForm.body} onChange={e=>setAnnouncementForm({...announcementForm,body:e.target.value})}/></label>
    {editingAnnouncement!==null&&<label>Status<select value={announcementForm.status} onChange={e=>setAnnouncementForm({...announcementForm,status:e.target.value})}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>}
    <div className="aw-actions"><button className="aw-primary" disabled={busy} type="submit"><Save size={14}/>{editingAnnouncement===null?'Save draft':'Save changes'}</button></div>
    <p className="aw-footnote">Publish saved drafts to make them visible to website users. Every change requires your admin password.</p>
   </form>
   <section className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Announcements</h2><span>{announcements.length} records</span></div>
    <div className="aw-table-scroll"><table><thead><tr><th>Title</th><th>Message</th><th>Status</th><th>Updated by</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
     {announcements.filter(a=>announcementStatusFilter==='all'||a.status===announcementStatusFilter).map(a=><tr key={String(a.announcement_id)}>
      <td><strong>{value(a.title)}</strong></td><td title={value(a.body)}>{brief(a.body)}</td><td><span className={a.status==='published'?'aw-tag good':'aw-tag'}>{value(a.status)}</span></td>
      <td>{value(a.updated_by)}</td><td>{new Date(String(a.updated_at)).toLocaleString()}</td>
      <td className="aw-row-actions"><button type="button" disabled={busy} onClick={()=>{setEditingAnnouncement(Number(a.announcement_id));setAnnouncementForm({title:String(a.title),body:String(a.body),status:String(a.status)});window.scrollTo({top:0,behavior:'instant'})}}>Edit</button>
      {a.status!=='published'&&<button type="button" disabled={busy} onClick={()=>void mutate('/api/admin/manage/announcements/'+a.announcement_id,'PATCH',{title:a.title,body:a.body,status:'published'})}>Publish</button>}
      {a.status==='published'&&<button type="button" disabled={busy} onClick={()=>void mutate('/api/admin/manage/announcements/'+a.announcement_id,'PATCH',{title:a.title,body:a.body,status:'archived'})}>Archive</button>}</td>
     </tr>)}</tbody></table>{!announcements.length&&<p className="aw-empty">No announcements yet.</p>}</div>
   </section>
  </div>}
  {tab==='data'&&<div className="aw-content"><div className="aw-toolbar"><label className="aw-select-label">Table<select value={datasetName} onChange={e=>{setDatasetName(e.target.value);setOffset(0);setDataSearch('')}}>{datasets.map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>{['buildings','locations','sensors'].includes(datasetName)&&<input aria-label="Search table" placeholder="Search records" value={dataSearch} onChange={e=>{setDataSearch(e.target.value);setOffset(0)}}/>}</div>
  <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>{datasets.find(x=>x[0]===datasetName)?.[1]}</h2><span>{dataset?.rows.length||0} rows on page</span></div><div className="aw-table-scroll"><table><thead><tr>{Object.keys(dataset?.rows[0]||{}).map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{dataset?.rows.map((r,i)=><tr key={i}>{Object.keys(dataset.rows[0]||{}).map(k=><td title={value(r[k])} key={k}>{brief(r[k])}</td>)}</tr>)}</tbody></table>{!dataset?.rows.length&&<p className="aw-empty">No records.</p>}</div></div>
  <div className="aw-pagination"><span>Offset {offset}</span><button disabled={offset===0||busy} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><button disabled={!dataset||dataset.rows.length<100||busy} onClick={()=>setOffset(offset+100)}>Next</button></div></div>}
 </div>
  {confirmOpen&&<div className="aw-confirm-backdrop" role="presentation">
   <form className="aw-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="aw-confirm-title" onSubmit={e=>void submitConfirm(e)}>
    <h2 id="aw-confirm-title">Confirm administrator password</h2>
    <p>To protect TwinLabs data, confirm your admin password before saving changes. Each change requires its own password confirmation.</p>
    <label>Admin password<input autoFocus required type="password" autoComplete="current-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label>
    {confirmError&&<p role="alert" className="aw-confirm-error">{confirmError}</p>}
    <div className="aw-actions"><button type="button" disabled={confirmBusy} onClick={()=>closeConfirm(null)}>Cancel</button><button className="aw-primary" disabled={confirmBusy} type="submit">{confirmBusy?'Verifying…':'Confirm & continue'}</button></div>
   </form>
  </div>}
 </section>;
}
