import {useCallback,useEffect,useState} from 'react';
import {RefreshCw,Megaphone} from 'lucide-react';
import './announcements.css';

type Announcement={announcement_id:number;title:string;body:string;created_by:string;updated_by:string;published_at:string};
export function Announcements(){
 const [rows,setRows]=useState<Announcement[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/announcements',{cache:'no-store'});
   if(!response.ok)throw Error('Announcements are currently unavailable.');
   const data=await response.json() as {rows:Announcement[]};
   setRows(data.rows);
  }catch(e){setError(e instanceof Error?e.message:'Could not load announcements.')}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load()},[load]);
 return <div className="twin-announcements">
  <header className="twin-announcements-header"><h1>Announcements</h1><button className="small-outline" type="button" disabled={loading} onClick={()=>void load()}><RefreshCw size={14}/> Refresh</button></header>
  {error&&<p role="alert" className="twin-announcements-error">{error}</p>}
  {!error&&loading&&<p className="twin-announcements-empty">Loading announcements…</p>}
  {!error&&!loading&&!rows.length&&<div className="twin-announcements-empty"><Megaphone size={22}/><p>No announcements have been published.</p></div>}
  {!loading&&<div className="twin-announcements-list">{rows.map(a=><article key={a.announcement_id} className="twin-announcement">
   <div className="twin-announcement-meta"><span>Published {new Date(a.published_at).toLocaleString()}</span><span>TwinLabs Administration</span></div>
   <h2>{a.title}</h2><p>{a.body}</p>
  </article>)}</div>}
 </div>;
}
