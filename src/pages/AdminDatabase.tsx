import {useCallback,useEffect,useState,type FormEvent} from 'react';
import './admin.css';
type Session={authenticated:boolean;username:string|null};
type Summary={database:{database:string;database_user:string;postgres_version:string};active_schema?:string;available_views?:string[];tables:string[];timescaledb:{installed:boolean;version:string|null;hypertables:{hypertable_schema:string;hypertable_name:string}[]}};
type DataSet={table:string;rows:Record<string,unknown>[];offset:number;limit:number};
type BuildingOption={building_code:string;building_name:string};
const tables=['locations','sensors','readings','maintenance'] as const;
const sections=[{title:'Building & BIM',keys:['buildings','floors','bim','bim_elements','locations']},{title:'Sensors & history',keys:['sensors','readings']},{title:'AI & operations',keys:['ai_results','forecasts','alerts','maintenance','notifications']}] as const;
async function json(url:string,options?:RequestInit) {
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 const body=await res.json().catch(()=>({error:'Invalid server response'}));
 if(!res.ok)throw Error(body.error||`HTTP ${res.status}`);
 return body;
}
export function AdminDatabase({onLogout,onClose}:{onLogout:()=>void;onClose:()=>void}) {
 const [summary,setSummary]=useState<Summary|null>(null);
 const [active,setActive]=useState('home');
 const [historyStack,setHistoryStack]=useState<Array<{active:string;building:string;location:string;point:string;floor:string;search:string;start:string;end:string;status:string;quality:string}>>([]);
 const [dataset,setDataset]=useState<DataSet|null>(null);
 const [buildings,setBuildings]=useState<BuildingOption[]>([]);
 const [building,setBuilding]=useState('');
 const [location,setLocation]=useState('');
 const [point,setPoint]=useState('');
 const [floor,setFloor]=useState('');
 const [search,setSearch]=useState('');
 const [start,setStart]=useState('');
 const [end,setEnd]=useState('');
 const [status,setStatus]=useState('');
 const [quality,setQuality]=useState('');
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const [reload,setReload]=useState(0);
 const available=summary?.available_views||[...tables];
 const names:Record<string,string>={buildings:'Buildings',floors:'Building floors',bim:'BIM models',bim_elements:'BIM elements',locations:'Locations',sensors:'Sensor registry',readings:'Sensor readings',ai_results:'AI results',forecasts:'Forecast results',alerts:'Alerts',maintenance:'Maintenance history',notifications:'Notifications'};
 const descriptions:Record<string,string>={
  buildings:'Registered buildings. Open a building to explore its monitored spaces.',
  floors:'Floors associated with the building.',
  bim:'BIM model references and linked building information.',
  bim_elements:'BIM elements associated with the building.',
  locations:'Monitoring locations and their building/floor assignments.',
  sensors:'Sensor channels and their location / IFC mappings.',
  readings:'Time-series sensor observations stored in PostgreSQL + TimescaleDB.',
  ai_results:'Persisted anomaly results, when the AI integration becomes active.',
  forecasts:'Persisted prediction results, when forecasting integration becomes active.',
  alerts:'Stored alerts, when automated alert persistence becomes active.',
  maintenance:'Maintenance and inspection records.',
  notifications:'Stored notifications, when the notification service becomes active.'
 };
 const pushPage=(next:string,updates:{building?:string;floor?:string;location?:string;point?:string}={})=>{
  setHistoryStack(prev=>[...prev,{active,building,location,point,floor,search,start,end,status,quality}]);
  setActive(next);setBuilding(updates.building??building);setFloor(updates.floor??floor);
  setLocation(updates.location??location);setPoint(updates.point??point);
  setSearch('');setStart('');setEnd('');setStatus('');setQuality('');
  setDataset(null);setReload(n=>n+1);
 };
 const back=()=>{
  const previous=historyStack[historyStack.length-1];if(!previous)return;
  setHistoryStack(prev=>prev.slice(0,-1));
  setActive(previous.active);setBuilding(previous.building);setFloor(previous.floor);
  setLocation(previous.location);setPoint(previous.point);
  setSearch(previous.search);setStart(previous.start);setEnd(previous.end);
  setStatus(previous.status);setQuality(previous.quality);setDataset(null);
 };
 const home=()=>{setHistoryStack([]);setActive('home');setDataset(null);setBuilding('');setFloor('');setLocation('');setPoint('');setSearch('');setStart('');setEnd('');setStatus('');setQuality('')};
 const navigate=(row:Record<string,unknown>)=>{
  if(active==='buildings')pushPage('locations',{building:String(row.building_code||''),floor:'',location:'',point:''});
  else if(active==='floors')pushPage('locations',{building:String(row.building_code||''),floor:String(row.floor_level||''),location:'',point:''});
  else if(active==='bim'||active==='bim_elements')pushPage('locations',{building:String(row.building_code||''),floor:'',location:'',point:''});
  else if(active==='locations')pushPage('sensors',{location:String(row.location_code||''),point:''});
  else if(active==='sensors')pushPage('readings',{location:String(row.location_code||''),point:String(row.point_code||'')});
 };
 const navigable=['buildings','floors','bim','bim_elements','locations','sensors'].includes(active);
 const showBuilding=summary?.active_schema==='digital_twin'&&buildings.length>1&&['floors','bim','bim_elements','locations','sensors','readings','ai_results','forecasts','maintenance'].includes(active);
 const showContext=Boolean(floor)&&active==='locations'||showBuilding||Boolean(location)&&['sensors','readings','ai_results','forecasts','maintenance'].includes(active)||Boolean(point)&&['readings','ai_results','forecasts'].includes(active);
 const load=useCallback(async(table:string,offset=0)=>{
  setLoading(true);setError('');
  const params=new URLSearchParams({offset:String(offset)});
  if(building&&table!=='buildings')params.set('building',building);
  if(floor&&table==='locations')params.set('floor',floor);
  if(location&&['sensors','readings','maintenance','ai_results','forecasts'].includes(table))params.set('location',location);
  if(point&&['readings','ai_results','forecasts'].includes(table))params.set('point',point);
  if(search&&['buildings','locations','sensors'].includes(table))params.set('search',search);
  if(start&&['readings','ai_results','forecasts'].includes(table))params.set('start',new Date(start).toISOString());
  if(end&&['readings','ai_results','forecasts'].includes(table))params.set('end',new Date(end).toISOString());
  if(status&&['ai_results','alerts','maintenance'].includes(table))params.set('status',status);
  if(quality&&table==='readings')params.set('quality',quality);
  try{setDataset(await json(`/api/admin/database/${table}?${params}`) as DataSet)}
  catch(e){setError(String(e));setDataset(null)}
  finally{setLoading(false)}
 },[building,location,point,floor,search,start,end,status,quality]);
 useEffect(()=>{json('/api/admin/database/summary').then(data=>{const value=data as Summary;setSummary(value);}).catch(e=>setError(String(e)))},[]);
 useEffect(()=>{json('/api/admin/buildings').then(data=>setBuildings((data as {buildings:BuildingOption[]}).buildings)).catch(()=>setBuildings([]))},[]);
 useEffect(()=>{if(active!=='home')void load(active)},[active,load,reload]);
 const cols=dataset?.rows.length?Object.keys(dataset.rows[0]):[];
 const hasFilters=['buildings','locations','sensors','readings','ai_results','forecasts','alerts','maintenance'].includes(active);
 const emptyText=active==='ai_results'?'No stored AI anomaly results yet. The AI persistence workflow has not been connected.':active==='forecasts'?'No saved forecast results yet.':active==='alerts'?'No persisted alerts yet.':active==='notifications'?'No notifications have been saved yet.':active==='maintenance'?'No maintenance records yet.':'No records match the current selection.';
 return <section className="admin-page">
  <div className="page-heading admin-heading"><div><span className="eyebrow admin-eyebrow">DATABASE / ADMINISTRATOR</span><h1>Database Management</h1><p>PostgreSQL + TimescaleDB · Read-only operational data</p></div><div className="admin-heading-actions"><button type="button" className="admin-outline" onClick={onClose}>Close</button><button type="button" className="admin-outline" onClick={onLogout}>Logout</button></div></div>
  {summary&&<div className="admin-summary"><div className="surface"><small>Database / Schema</small><strong>{summary.database.database} / {summary.active_schema||'twin18'}</strong></div><div className="surface"><small>PostgreSQL</small><strong>{summary.database.postgres_version}</strong></div><div className="surface"><small>TimescaleDB</small><strong>{summary.timescaledb.installed?summary.timescaledb.version:'Not enabled'}</strong></div><div className="surface"><small>Hypertables</small><strong>{summary.timescaledb.hypertables.map(h=>h.hypertable_name).join(', ')||'None'}</strong></div></div>}
  {active==='home'?<div className="admin-navigation-home">
    <div className="admin-home-intro"><h2>Explore database</h2><p>Browse building information, sensor history and operational records. Select a section to view its records.</p></div>
    {sections.map(group=>{const keys=group.keys.filter(t=>available.includes(t));return keys.length?<section key={group.title} className="admin-home-group"><h3>{group.title}</h3><div className="admin-home-cards">{keys.map(t=><button type="button" key={t} className="admin-home-card" onClick={()=>pushPage(t,{building:'',location:'',floor:'',point:''})}><span>{names[t]||t}</span><span className="admin-home-card-description">{descriptions[t]||'View stored data'}</span><span className="admin-home-card-arrow">Explore →</span></button>)}</div></section>:null})}
   </div>:<nav className="admin-breadcrumb" aria-label="Database navigation"><button type="button" className="admin-outline" onClick={back} disabled={!historyStack.length}>← Back</button><button type="button" className="admin-crumb-home" onClick={home}>Database</button>{historyStack.filter(p=>p.active!=='home').map((p,i)=><span key={i} className="admin-crumb-text">/ {names[p.active]||p.active}</span>)}<span className="admin-crumb-current">/ {names[active]||active}</span></nav>}
  {active!=='home'&&<>
  {showContext&&<div className="admin-context-bar">{showBuilding&&<div className="admin-context-field"><label htmlFor="admin-building">Building</label><select id="admin-building" value={building} onChange={e=>{setBuilding(e.target.value);setFloor('');setLocation('');setPoint('')}}><option value="">All buildings</option>{buildings.map(b=><option key={b.building_code} value={b.building_code}>{b.building_name}</option>)}</select></div>}{floor&&active==='locations'&&<div className="admin-context-scope"><span>Floor: {floor}</span><button type="button" className="admin-outline" onClick={()=>setFloor('')}>Clear</button></div>}{location&&<div className="admin-context-scope"><span>Location: {location}</span><button type="button" className="admin-outline" onClick={()=>{setLocation('');setPoint('')}}>Clear</button></div>}{point&&<div className="admin-context-scope"><span>Sensor: {point}</span><button type="button" className="admin-outline" onClick={()=>setPoint('')}>Clear</button></div>}</div>}
  {hasFilters&&<div className="admin-task-filters">
    {['buildings','locations','sensors'].includes(active)&&!(active==='buildings'&&buildings.length<=1)&&<label>Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder={active==='buildings'?'Building name or code':active==='locations'?'Location name or code':'Sensor code or type'}/></label>}
    {['readings','ai_results','forecasts'].includes(active)&&<><label>From<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>To<input type="datetime-local" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label></>}
    {active==='readings'&&<label>Quality<select value={quality} onChange={e=>setQuality(e.target.value)}><option value="">All qualities</option><option value="synthetic">Synthetic</option><option value="missing">Missing</option></select></label>}
    {active==='ai_results'&&<label>Prediction<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All predictions</option><option value="Normal">Normal</option><option value="Abnormal">Abnormal</option><option value="Unknown">Unknown</option></select></label>}
    {active==='alerts'&&<label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['New','Review','Acknowledged','Closed'].map(t=><option key={t} value={t}>{t}</option>)}</select></label>}
    {active==='maintenance'&&<label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['Scheduled','In Progress','Completed','Cancelled'].map(t=><option key={t} value={t}>{t}</option>)}</select></label>}
   </div>}
  </>}
  {error&&<p className="admin-error" role="alert">{error}</p>}
  {active!=='home'&&<>
  <div className="surface admin-table-wrap"><div className="admin-table-title"><div className="admin-table-heading"><strong>{names[active]||active}</strong><p>{descriptions[active]||'Database records'}</p></div><button className="admin-outline" disabled={loading} onClick={()=>void load(active,dataset?.offset||0)}>Refresh</button></div>
  {loading?<p>Loading database records…</p>:dataset?.rows.length?<table className="admin-table"><thead><tr>{cols.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{dataset.rows.map((row,i)=><tr key={i} className={navigable?'admin-navigable-row':undefined} tabIndex={navigable?0:undefined} onKeyDown={navigable?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(row)}}:undefined} onClick={navigable?()=>navigate(row):undefined}>{cols.map(k=><td key={k}>{row[k]===null?'—':typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}{navigable&&k===cols[0]?<span className="admin-row-link">{active==='sensors'?'View readings →':active==='locations'?'View sensors →':'View locations →'}</span>:null}</td>)}</tr>)}</tbody></table>:<p>{emptyText}</p>}
  </div>
  {dataset&&<div className="admin-pagination"><span>Rows {dataset.rows.length?dataset.offset+1:0}–{dataset.offset+dataset.rows.length}</span><button disabled={loading||dataset.offset===0} onClick={()=>void load(active,Math.max(0,dataset.offset-100))}>Previous</button><button disabled={loading||dataset.rows.length<100} onClick={()=>void load(active,dataset.offset+100)}>Next</button></div>}
  </>}
 </section>;
}
export function AdminLogin({onSuccess,onClose}:{onSuccess:(session:Session)=>void;onClose:()=>void}) {
 const [username,setUsername]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setError('');setLoading(true);try{const session=await json('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}) as Session;setPassword('');onSuccess(session);}catch(e){setError(String(e));}finally{setLoading(false);}}
 return <section className="admin-login"><div className="admin-login-card"><button type="button" className="admin-close" aria-label="Close login" onClick={onClose}>×</button><span className="admin-eyebrow">RESTRICTED ACCESS</span><h1>Admin Login</h1><p>Use the administrator credentials configured locally on the Node.js server.</p><form onSubmit={submit}><label>Username<input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="admin-error" role="alert">{error}</p>}<button className="admin-submit" disabled={loading} type="submit">{loading?'Signing in…':'Sign in'}</button></form></div></section>;
}
export function useAdminSession(){
 const [session,setSession]=useState<Session>({authenticated:false,username:null});
 useEffect(()=>{json('/api/admin/session').then(s=>setSession(s as Session)).catch(()=>setSession({authenticated:false,username:null}));},[]);
 const logout=async()=>{try{await json('/api/admin/logout',{method:'POST'});}finally{setSession({authenticated:false,username:null});}};
 return {session,setSession,logout};
}
