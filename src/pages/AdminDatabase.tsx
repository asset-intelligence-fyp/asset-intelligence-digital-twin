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
 const [active,setActive]=useState<string>('locations');
 const [dataset,setDataset]=useState<DataSet|null>(null);
 const [buildings,setBuildings]=useState<BuildingOption[]>([]);
 const [building,setBuilding]=useState('');
 const [location,setLocation]=useState('');
 const [point,setPoint]=useState('');
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const load=useCallback(async(table:string,offset=0)=>{
  setLoading(true);setError('');
  try {const params=new URLSearchParams({offset:String(offset)});if(building)params.set('building',building);if(location&&['sensors','readings','maintenance'].includes(table))params.set('location',location);if(point&&table==='readings')params.set('point',point);setDataset(await json(`/api/admin/database/${table}?${params}`) as DataSet);}
  catch(e){setError(String(e));setDataset(null);}
  finally{setLoading(false);}
 },[building,location,point]);
 useEffect(()=>{json('/api/admin/buildings').then(data=>setBuildings((data as {buildings:BuildingOption[]}).buildings)).catch(()=>setBuildings([]));},[]);
 useEffect(()=>{json('/api/admin/database/summary').then(data=>setSummary(data as Summary)).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{void load(active);},[active,load]);
 const available=summary?.available_views||[...tables];
 const names:Record<string,string>={locations:'Locations',sensors:'Sensor registry',readings:'Sensor readings',maintenance:'Maintenance history',buildings:'Buildings',floors:'Building floors',bim:'BIM models',bim_elements:'BIM elements',ai_results:'AI results',forecasts:'Forecast results',alerts:'Alerts',notifications:'Notifications'};
 const descriptions:Record<string,string>={locations:'Monitored spaces for the selected building.',sensors:'Sensor channels and BIM mappings for the selected location.',readings:'Stored synthetic readings; select a sensor to follow its history.',maintenance:'Maintenance records for monitored spaces.',buildings:'Select a building to explore its locations.',floors:'Floors registered under the selected building.',bim:'Building model file references.',bim_elements:'BIM elements assigned to the building.',ai_results:'Stored anomaly detection results (shown when AI persistence is enabled).',forecasts:'Stored forecast results (shown when forecast persistence is enabled).',alerts:'Saved alerts (shown when alert integration is enabled).',notifications:'Saved notifications (shown when notification integration is enabled).'};
 const cols=dataset?.rows.length?Object.keys(dataset.rows[0]):[];
 const chooseBuilding=(code:string)=>{setBuilding(code);setLocation('');setPoint('');setActive('locations');};
 const chooseLocation=(code:string)=>{setLocation(code);setPoint('');setActive('sensors');};
 const openRelated=(row:Record<string,unknown>)=>{if(['buildings','bim','floors','bim_elements'].includes(active)){chooseBuilding(String(row.building_code||''));return;}if(active==='locations'){chooseLocation(String(row.location_code||''));return;}if(active==='sensors'){setLocation(String(row.location_code||''));setPoint(String(row.point_code||''));setActive('readings');}};
 const clickable=['buildings','floors','bim','bim_elements','locations','sensors'].includes(active);
 return <section className="admin-page">
  <div className="page-heading admin-heading"><div><span className="eyebrow admin-eyebrow">DATABASE / ADMINISTRATOR</span><h1>Database Management</h1><p>PostgreSQL + TimescaleDB · Read-only monitoring data</p></div><div className="admin-heading-actions"><button type="button" className="admin-outline" onClick={onClose}>Close</button><button type="button" className="admin-outline" onClick={onLogout}>Logout</button></div></div>
  {summary&&<div className="admin-summary"><div className="surface"><small>Database / Schema</small><strong>{summary.database.database} / {summary.active_schema||'twin18'}</strong></div><div className="surface"><small>PostgreSQL</small><strong>{summary.database.postgres_version}</strong></div><div className="surface"><small>TimescaleDB</small><strong>{summary.timescaledb.installed?summary.timescaledb.version:'Not enabled'}</strong></div><div className="surface"><small>Hypertables</small><strong>{summary.timescaledb.hypertables.map(h=>h.hypertable_name).join(', ')||'None'}</strong></div></div>}
  <div className="admin-view-groups">{sections.map(group=>{const keys=group.keys.filter(t=>available.includes(t));return keys.length?<div className="admin-view-group" key={group.title}><span className="admin-group-label">{group.title}</span><div className="admin-tabs">{keys.map(t=><button type="button" key={t} className={active===t?'selected':''} onClick={()=>setActive(t)}>{names[t]||t}</button>)}</div></div>:null})}</div>
  {summary?.active_schema==='digital_twin'&&<div className="admin-context-bar"><div className="admin-context-field"><label htmlFor="admin-building">Building</label><select id="admin-building" value={building} onChange={e=>chooseBuilding(e.target.value)}><option value="">All buildings</option>{buildings.map(b=><option key={b.building_code} value={b.building_code}>{b.building_name} ({b.building_code})</option>)}</select></div>{location&&<div className="admin-context-scope"><span>Location: {location}</span><button type="button" className="admin-outline" onClick={()=>{setLocation('');setPoint('')}}>Clear location</button></div>}{point&&<div className="admin-context-scope"><span>Sensor: {point}</span><button type="button" className="admin-outline" onClick={()=>setPoint('')}>Clear sensor</button></div>}<p>Choose a building to scope its locations and sensors. Select a row to explore related records.</p></div>}
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <div className="surface admin-table-wrap"><div className="admin-table-title"><div className="admin-table-heading"><strong>{names[active]||active}</strong><p>{descriptions[active]||'Database records'}</p></div><button className="admin-outline" disabled={loading} onClick={()=>load(active,dataset?.offset||0)}>Refresh</button></div>
  {loading?<p>Loading database records…</p>:dataset?.rows.length?<table className="admin-table"><thead><tr>{cols.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{dataset.rows.map((row,i)=><tr key={i} className={clickable?'admin-navigable-row':undefined} tabIndex={clickable?0:undefined} role={clickable?'button':undefined} onKeyDown={clickable?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openRelated(row)}}:undefined} onClick={clickable?()=>openRelated(row):undefined}>{cols.map(k=><td key={k}>{row[k]===null?'—':typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}{clickable&&k===cols[0]?<span className="admin-row-link">View related →</span>:null}</td>)}</tr>)}</tbody></table>:<p>No records yet in this section.</p>}
  </div>
  {dataset&&<div className="admin-pagination"><span>Rows {dataset.offset+1}–{dataset.offset+dataset.rows.length}</span><button disabled={loading||dataset.offset===0} onClick={()=>load(active,Math.max(0,dataset.offset-100))}>Previous</button><button disabled={loading||dataset.rows.length<100} onClick={()=>load(active,dataset.offset+100)}>Next</button></div>}
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
