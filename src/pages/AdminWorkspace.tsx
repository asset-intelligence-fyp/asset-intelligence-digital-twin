import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Database,Radio,MapPin,Users,RefreshCw,Plus,Trash2,Save,Copy,ShieldCheck} from 'lucide-react';
import './adminWorkspace.css';

type Rec=Record<string,unknown>;
type Overview={counts:Record<string,number>;locations:Rec[];buildings:Rec[];fixedSensors:string[]};
type DataSet={rows:Rec[];offset:number;limit:number;total?:number};
type Tab='overview'|'sensors'|'locations'|'users'|'data';
const tabs:{key:Tab;label:string}[]=[
 {key:'overview',label:'Overview'},{key:'sensors',label:'Sensors'},
 {key:'locations',label:'Locations'},{key:'users',label:'Access'},
 {key:'data',label:'Database'}
];
const datasets=[
 ['buildings','Buildings'],['floors','Floors'],['locations','Locations'],['sensors','Sensors'],
 ['readings','Readings'],['bim','BIM models'],['bim_elements','BIM elements'],
 ['ai_results','AI results'],['forecasts','Forecasts'],['alerts','Alerts'],
 ['maintenance','Maintenance'],['notifications','Notifications']
];
async function request(url:string,options?:RequestInit){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 const data=await r.json().catch(()=>({error:'Invalid server response'}));
 if(!r.ok)throw Error(data.error||'Request failed ('+r.status+')');
 return data;
}
const send=(method:string,payload?:unknown)=>({method,headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
const value=(x:unknown)=>x===null||x===undefined?'—':typeof x==='object'?JSON.stringify(x):String(x);
const brief=(x:unknown)=>{const s=value(x);return s.length>110?s.slice(0,107)+'…':s;};
const baseSensor={point_code:'',location_code:'',measurement_type:'temperature',unit:'°C'};
type SensorForm=typeof baseSensor;
export function AdminWorkspace(){
 const [tab,setTab]=useState<Tab>('overview'),[overview,setOverview]=useState<Overview|null>(null);
 const [sensors,setSensors]=useState<Rec[]>([]),[users,setUsers]=useState<Rec[]>([]),[invites,setInvites]=useState<Rec[]>([]),[audit,setAudit]=useState<Rec[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [sensorSearch,setSensorSearch]=useState(''),[showNew,setShowNew]=useState(false);
 const [sensorForm,setSensorForm]=useState<SensorForm>(baseSensor),[editing,setEditing]=useState<string|null>(null);
 const [editForm,setEditForm]=useState({location_code:'',measurement_type:'',unit:''});
 const [locationEdit,setLocationEdit]=useState<string|null>(null),[locationName,setLocationName]=useState('');
 const [inviteEmail,setInviteEmail]=useState(''),[newInvite,setNewInvite]=useState('');
 const [datasetName,setDatasetName]=useState('buildings'),[dataset,setDataset]=useState<DataSet|null>(null);
 const [offset,setOffset]=useState(0),[dataSearch,setDataSearch]=useState('');
 const notify=(e:unknown)=>{setError(e instanceof Error?e.message:String(e));setMessage('');};
 const loadOverview=useCallback(async()=>setOverview(await request('/api/admin/manage/overview') as Overview),[]);
 const loadSensors=useCallback(async()=>setSensors((await request('/api/admin/manage/sensors') as {rows:Rec[]}).rows),[]);
 const loadUsers=useCallback(async()=>{const data=await request('/api/admin/manage/users') as {users:Rec[];invites:Rec[];audit:Rec[]};setUsers(data.users);setInvites(data.invites);setAudit(data.audit)},[]);
 const loadDataset=useCallback(async()=>{const params=new URLSearchParams({offset:String(offset)});if(dataSearch&&['buildings','locations','sensors'].includes(datasetName))params.set('search',dataSearch);setDataset(await request('/api/admin/database/'+datasetName+'?'+params) as DataSet)},[datasetName,offset,dataSearch]);
 const refresh=useCallback(async(t:Tab=tab)=>{setBusy(true);setError('');try{
  if(t==='overview'||t==='locations')await loadOverview();
  if(t==='sensors')await Promise.all([loadSensors(),loadOverview()]);
  if(t==='users')await loadUsers();
  if(t==='data')await loadDataset();
 }catch(e){notify(e)}finally{setBusy(false)}},[tab,loadOverview,loadSensors,loadUsers,loadDataset]);
 useEffect(()=>{void refresh(tab)},[tab,refresh]);
 async function mutate(url:string,method:string,payload?:unknown,after?:()=>void){
  setBusy(true);setError('');setMessage('');
  try{const res=await request(url,send(method,payload));setMessage((res as {note?:string}).note||'Saved.');after?.();await refresh(tab);return true}
  catch(e){notify(e);return false}finally{setBusy(false)}
 }
 function startEdit(row:Rec){setEditing(String(row.point_code));setEditForm({location_code:String(row.location_code),measurement_type:String(row.measurement_type),unit:String(row.unit)})}
 const filtered=sensors.filter(r=>[r.point_code,r.display_name,r.measurement_type,r.location_code].some(v=>String(v).toLowerCase().includes(sensorSearch.toLowerCase())));
 const locations=overview?.locations||[];
 return <section className="admin-workspace" aria-label="Administration workspace">
  <header className="aw-header"><div><h1>Administration</h1></div><div className="aw-head-actions"><span className="aw-status">PostgreSQL · digital_twin</span><button type="button" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={15}/> Refresh</button></div></header>
  <nav className="aw-tabs" aria-label="Administration sections">{tabs.map(t=><button key={t.key} type="button" className={tab===t.key?'active':''} onClick={()=>{setError('');setMessage('');setTab(t.key)}}>{t.label}</button>)}</nav>
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
   <button onClick={()=>setTab('locations')}><MapPin size={17}/> Manage locations</button>
   <button onClick={()=>setTab('users')}><ShieldCheck size={17}/> Invite a user</button>
   <button onClick={()=>setTab('data')}><Database size={17}/> View database</button>
  </div></section><section className="aw-panel"><h2>System</h2><div className="aw-system-row"><span>Schema</span><strong>digital_twin</strong></div><div className="aw-system-row"><span>Built-in BIM sensors</span><strong>{overview?.fixedSensors.length??'—'}</strong></div><div className="aw-system-row"><span>Open invitations</span><strong>{overview?.counts.invites??'—'}</strong></div><p className="aw-footnote">Database-only sensors require a separate BIM/XKT mapping and simulator configuration before they appear in the building viewer.</p></section></div></div>}
  {tab==='sensors'&&<div className="aw-content"><div className="aw-toolbar"><input aria-label="Search sensors" placeholder="Search sensor, room or type" value={sensorSearch} onChange={e=>setSensorSearch(e.target.value)}/><button className="aw-primary" onClick={()=>{setShowNew(s=>!s);setEditing(null)}}><Plus size={15}/> Add sensor</button></div>
   {showNew&&<form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{e.preventDefault();const ok=await mutate('/api/admin/manage/sensors','POST',sensorForm,()=>{setShowNew(false);setSensorForm(baseSensor)});if(ok)await loadSensors()}}><h2>New sensor</h2><div className="aw-fields">
    <label>Sensor code<input required value={sensorForm.point_code} onChange={e=>setSensorForm({...sensorForm,point_code:e.target.value})} placeholder="TEMP-NEW-01"/></label>
    <label>Location<select required value={sensorForm.location_code} onChange={e=>setSensorForm({...sensorForm,location_code:e.target.value})}><option value="">Choose location</option>{locations.map(r=><option key={String(r.location_code)} value={String(r.location_code)}>{String(r.display_name)}</option>)}</select></label>
    <label>Type<input required value={sensorForm.measurement_type} onChange={e=>setSensorForm({...sensorForm,measurement_type:e.target.value})}/></label>
    <label>Unit<input required value={sensorForm.unit} onChange={e=>setSensorForm({...sensorForm,unit:e.target.value})}/></label>
   </div><div className="aw-actions"><button type="submit" className="aw-primary" disabled={busy}><Save size={14}/> Create</button><button type="button" onClick={()=>setShowNew(false)}>Cancel</button></div><p className="aw-footnote">The new sensor is saved to PostgreSQL with pending BIM mapping. It will not automatically appear inside the XKT model.</p></form>}
   <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Sensor registry</h2><span>{filtered.length} sensors</span></div><div className="aw-table-scroll"><table><thead><tr><th>Sensor</th><th>Location</th><th>Type</th><th>Unit</th><th>Mapping</th><th>Readings</th><th>Actions</th></tr></thead><tbody>{filtered.map(r=><tr key={String(r.point_code)}>
    <td><strong>{String(r.point_code)}</strong></td><td>{String(r.display_name)}</td><td>{String(r.measurement_type)}</td><td>{String(r.unit)}</td><td><span className={r.model_bound?'aw-tag good':'aw-tag pending'}>{r.model_bound?'Built-in':'Pending BIM'}</span></td><td>{String(r.reading_count)}</td>
    <td className="aw-row-actions"><button onClick={()=>startEdit(r)}>Edit</button><button disabled={Boolean(r.model_bound)||busy} title={r.model_bound?'Built-in BIM sensors are protected':'Remove database-only sensor'} onClick={async()=>{if(window.confirm('Delete '+r.point_code+'? Only unreferenced, database-only sensors can be removed.'))await mutate('/api/admin/manage/sensors/'+encodeURIComponent(String(r.point_code)),'DELETE')}}><Trash2 size={14}/></button></td>
   </tr>)}</tbody></table>{!filtered.length&&<p className="aw-empty">No matching sensors.</p>}</div></div>
   {editing&&<div className="aw-panel aw-form"><div className="aw-panel-head"><h2>Edit {editing}</h2><button onClick={()=>setEditing(null)}>Close</button></div><div className="aw-fields"><label>Location<select value={editForm.location_code} onChange={e=>setEditForm({...editForm,location_code:e.target.value})}>{locations.map(r=><option key={String(r.location_code)} value={String(r.location_code)}>{String(r.display_name)}</option>)}</select></label><label>Type<input value={editForm.measurement_type} onChange={e=>setEditForm({...editForm,measurement_type:e.target.value})}/></label><label>Unit<input value={editForm.unit} onChange={e=>setEditForm({...editForm,unit:e.target.value})}/></label></div><div className="aw-actions"><button className="aw-primary" disabled={busy} onClick={async()=>{if(await mutate('/api/admin/manage/sensors/'+encodeURIComponent(editing),'PATCH',editForm))setEditing(null)}}><Save size={14}/> Save</button></div><p className="aw-footnote">Changing metadata does not rewrite the fixed simulator registry or relocate IFC geometry.</p></div>}
  </div>}
  {tab==='locations'&&<div className="aw-content"><div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Monitoring locations</h2><span>{locations.length} locations</span></div><div className="aw-table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Floor</th><th>Building</th><th>Action</th></tr></thead><tbody>{locations.map(r=><tr key={String(r.location_code)}><td>{String(r.location_code)}</td><td>{locationEdit===r.location_code?<input autoFocus value={locationName} onChange={e=>setLocationName(e.target.value)}/>:String(r.display_name)}</td><td>{String(r.floor_level)}</td><td>{String(r.building_code)}</td><td className="aw-row-actions">{locationEdit===r.location_code?<><button disabled={busy} onClick={async()=>{if(await mutate('/api/admin/manage/locations/'+encodeURIComponent(String(r.location_code)),'PATCH',{display_name:locationName}))setLocationEdit(null)}}>Save</button><button onClick={()=>setLocationEdit(null)}>Cancel</button></>:<button onClick={()=>{setLocationEdit(String(r.location_code));setLocationName(String(r.display_name))}}>Rename</button>}</td></tr>)}</tbody></table></div></div></div>}
  {tab==='users'&&<div className="aw-content"><div className="aw-grid"><form className="aw-panel aw-form" onSubmit={async(e:FormEvent)=>{e.preventDefault();setBusy(true);setNewInvite('');try{const r=await request('/api/admin/manage/invites',send('POST',{email:inviteEmail})) as {code:string};setNewInvite(r.code);setInviteEmail('');await loadUsers();setMessage('Invitation created. Copy the code now.')}catch(e){notify(e)}finally{setBusy(false)}}><h2>Invite a user</h2><label>Email<input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} required placeholder="person@example.com"/></label><button className="aw-primary" disabled={busy} type="submit"><Plus size={15}/> Generate invitation</button>{newInvite&&<div className="aw-invite-code"><code>{newInvite}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(newInvite)}><Copy size={14}/> Copy</button></div>}<p className="aw-footnote">One-time viewer invite, valid for seven days. Share code privately. Users redeem it from the Login window. Codes are stored hashed.</p></form><section className="aw-panel"><h2>Recent activity</h2><div className="aw-activity">{audit.map((a,i)=><div key={i}><span>{String(a.action)}</span><strong>{String(a.target)}</strong><small>{new Date(String(a.created_at)).toLocaleString()}</small></div>)}{!audit.length&&<p>No changes yet.</p>}</div></section></div>
  <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Accounts</h2><span>{users.length} users</span></div><div className="aw-table-scroll"><table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Created</th><th>Change access</th></tr></thead><tbody>{users.map(u=><tr key={String(u.user_id)}><td>{String(u.username)}</td><td>{String(u.email)}</td><td><span className="aw-tag">{String(u.role_name)}</span></td><td>{new Date(String(u.created_at)).toLocaleDateString()}</td><td><select aria-label={'Role for '+u.username} value={String(u.role_name)} disabled={busy} onChange={async e=>{if(window.confirm('Change role for '+u.username+'?'))await mutate('/api/admin/manage/users/'+u.user_id+'/role','POST',{role:e.target.value})}}><option value="viewer">Viewer</option><option value="admin">Admin</option></select></td></tr>)}</tbody></table></div></div>
  <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>Invitations</h2><span>{invites.length} recent</span></div><div className="aw-table-scroll"><table><thead><tr><th>Email</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>{invites.map(i=><tr key={String(i.invite_id)}><td>{String(i.email)}</td><td>{i.used_at?'Used':new Date(String(i.expires_at)).getTime()<Date.now()?'Expired':'Open'}</td><td>{new Date(String(i.expires_at)).toLocaleString()}</td><td>{!i.used_at&&<button onClick={()=>void mutate('/api/admin/manage/invites/'+i.invite_id+'/revoke','POST')}>Revoke</button>}</td></tr>)}</tbody></table></div></div>
  <p className="aw-footnote">Accounts and roles are managed in PostgreSQL. The existing public dashboard is not restricted by these roles; admin APIs remain admin-only.</p></div>}
  {tab==='data'&&<div className="aw-content"><div className="aw-toolbar"><label className="aw-select-label">Table<select value={datasetName} onChange={e=>{setDatasetName(e.target.value);setOffset(0);setDataSearch('')}}>{datasets.map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>{['buildings','locations','sensors'].includes(datasetName)&&<input aria-label="Search table" placeholder="Search records" value={dataSearch} onChange={e=>{setDataSearch(e.target.value);setOffset(0)}}/>}</div>
  <div className="aw-panel aw-table-shell"><div className="aw-panel-head"><h2>{datasets.find(x=>x[0]===datasetName)?.[1]}</h2><span>{dataset?.rows.length||0} rows on page</span></div><div className="aw-table-scroll"><table><thead><tr>{Object.keys(dataset?.rows[0]||{}).map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{dataset?.rows.map((r,i)=><tr key={i}>{Object.keys(dataset.rows[0]||{}).map(k=><td title={value(r[k])} key={k}>{brief(r[k])}</td>)}</tr>)}</tbody></table>{!dataset?.rows.length&&<p className="aw-empty">No records.</p>}</div></div>
  <div className="aw-pagination"><span>Offset {offset}</span><button disabled={offset===0||busy} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><button disabled={!dataset||dataset.rows.length<100||busy} onClick={()=>setOffset(offset+100)}>Next</button></div></div>}
 </section>;
}
