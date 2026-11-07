import {useCallback,useEffect,useState,type FormEvent} from 'react';
import './admin.css';
type Session={authenticated:boolean;username:string|null};
type Summary={database:{database:string;database_user:string;postgres_version:string};tables:string[];timescaledb:{installed:boolean;version:string|null;hypertables:{hypertable_schema:string;hypertable_name:string}[]}};
type DataSet={table:string;rows:Record<string,unknown>[];offset:number;limit:number};
const tables=['locations','sensors','readings','maintenance'] as const;
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
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const load=useCallback(async(table:string,offset=0)=>{
  setLoading(true);setError('');
  try {setDataset(await json(`/api/admin/database/${table}?offset=${offset}`) as DataSet);}
  catch(e){setError(String(e));setDataset(null);}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{json('/api/admin/database/summary').then(data=>setSummary(data as Summary)).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{void load(active);},[active,load]);
 const cols=dataset?.rows.length?Object.keys(dataset.rows[0]):[];
 return <section className="admin-page">
  <div className="page-heading admin-heading"><div><span className="eyebrow admin-eyebrow">DATABASE / ADMINISTRATOR</span><h1>Database Management</h1><p>PostgreSQL + TimescaleDB · Read-only monitoring data</p></div><div className="admin-heading-actions"><button type="button" className="admin-outline" onClick={onClose}>Close</button><button type="button" className="admin-outline" onClick={onLogout}>Logout</button></div></div>
  {summary&&<div className="admin-summary"><div className="surface"><small>Database</small><strong>{summary.database.database}</strong></div><div className="surface"><small>PostgreSQL</small><strong>{summary.database.postgres_version}</strong></div><div className="surface"><small>TimescaleDB</small><strong>{summary.timescaledb.installed?summary.timescaledb.version:'Not enabled'}</strong></div><div className="surface"><small>Hypertables</small><strong>{summary.timescaledb.hypertables.map(h=>h.hypertable_name).join(', ')||'None'}</strong></div></div>}
  <div className="admin-tabs">{tables.map(t=><button key={t} className={active===t?'selected':''} onClick={()=>setActive(t)}>{t==='readings'?'Sensor readings':t==='sensors'?'Sensor registry':t==='maintenance'?'Maintenance events':'Locations'}</button>)}</div>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <div className="surface admin-table-wrap"><div className="admin-table-title"><strong>{active}</strong><button className="admin-outline" disabled={loading} onClick={()=>load(active,dataset?.offset||0)}>Refresh</button></div>
  {loading?<p>Loading database records…</p>:dataset?.rows.length?<table className="admin-table"><thead><tr>{cols.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{dataset.rows.map((row,i)=><tr key={i}>{cols.map(k=><td key={k}>{row[k]===null?'—':typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}</td>)}</tr>)}</tbody></table>:<p>No rows to display. Check database migration if the table is unavailable.</p>}
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
