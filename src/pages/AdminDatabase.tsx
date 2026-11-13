import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Building2,MapPin,SlidersHorizontal,ChevronDown,ChevronUp} from 'lucide-react';
import './admin.css';
type Session={authenticated:boolean;username:string|null};
type Summary={database:{database:string;database_user:string;postgres_version:string};active_schema?:string;available_views?:string[];tables:string[];timescaledb:{installed:boolean;version:string|null;hypertables:{hypertable_schema:string;hypertable_name:string}[]}};
type DataSet={table:string;rows:Record<string,unknown>[];offset:number;limit:number;total?:number};
type BuildingOption={building_code:string;building_name:string};
type LocationOption={location_code:string;display_name:string;floor_level:string;building_code:string};
const tables=['locations','sensors','readings','maintenance'] as const;
type MainTab='buildings'|'sensors'|'ai'|'alerts'|'maintenance';
const mainTabs:{id:MainTab;label:string;section:string}[]=[
 {id:'buildings',label:'Buildings',section:'buildings'},
 {id:'sensors',label:'Sensors',section:'sensors'},
 {id:'ai',label:'AI Results',section:'ai_results'},
 {id:'alerts',label:'Alerts',section:'alerts'},
 {id:'maintenance',label:'Maintenance',section:'maintenance'}
];
const secondaryViews:Record<MainTab,{id:string;label:string}[]>={
 buildings:[{id:'floors',label:'Building floors'},{id:'bim',label:'BIM models'},{id:'bim_elements',label:'BIM elements'}],
 sensors:[],
 ai:[{id:'ai_results',label:'Anomaly results'},{id:'forecasts',label:'Forecast results'}],
 alerts:[{id:'alerts',label:'Alerts'},{id:'notifications',label:'Notifications'}],
 maintenance:[]
};
async function json(url:string,options?:RequestInit) {
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 const body=await res.json().catch(()=>({error:'Invalid server response'}));
 if(!res.ok)throw Error(body.error||`HTTP ${res.status}`);
 return body;
}
export function AdminDatabase() {
 const [summary,setSummary]=useState<Summary|null>(null);
 const [active,setActive]=useState('buildings');
 const [mainTab,setMainTab]=useState<MainTab>('buildings');
 const [filtersOpen,setFiltersOpen]=useState(false);
 const [measurementType,setMeasurementType]=useState('');
 const [locationOptions,setLocationOptions]=useState<LocationOption[]>([]);
 const [sensorTypes,setSensorTypes]=useState<string[]>([]);
 const [historyStack,setHistoryStack]=useState<Array<{active:string;building:string;location:string;point:string;floor:string;locationName:string;search:string;start:string;end:string;status:string;quality:string}>>([]);
 const [dataset,setDataset]=useState<DataSet|null>(null);
 const [buildings,setBuildings]=useState<BuildingOption[]>([]);
 const [building,setBuilding]=useState('');
 const [location,setLocation]=useState('');
 const [locationName,setLocationName]=useState('');
 const offsetRef=useRef(0);
 const latestRequestRef=useRef(0);
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
  sensors:'Latest stored value for each sensor. Select a sensor to view its full reading history.',
  readings:'Time-series sensor observations stored in PostgreSQL + TimescaleDB.',
  ai_results:'Persisted anomaly results, when the AI integration becomes active.',
  forecasts:'Persisted prediction results, when forecasting integration becomes active.',
  alerts:'Stored alerts, when automated alert persistence becomes active.',
  maintenance:'Maintenance and inspection records.',
  notifications:'Stored notifications, when the notification service becomes active.'
 };
 const pushPage=(next:string,updates:{building?:string;floor?:string;location?:string;locationName?:string;point?:string}={})=>{
  setHistoryStack(prev=>[...prev,{active,building,location,point,floor,locationName,search,start,end,status,quality}]);
  setActive(next);setBuilding(updates.building??building);setFloor(updates.floor??floor);
  setLocation(updates.location??location);setLocationName(updates.locationName??locationName);setPoint(updates.point??point);
  setSearch('');setStart('');setEnd('');setStatus('');setQuality('');
  setDataset(null);setReload(n=>n+1);
 };
 const back=()=>{
  const previous=historyStack[historyStack.length-1];if(!previous)return;
  setHistoryStack(prev=>prev.slice(0,-1));
  setActive(previous.active);setBuilding(previous.building);setFloor(previous.floor);
  setLocation(previous.location);setLocationName(previous.locationName);setPoint(previous.point);
  setSearch(previous.search);setStart(previous.start);setEnd(previous.end);
  setStatus(previous.status);setQuality(previous.quality);setDataset(null);
 };
 const switchView=(next:string,tab:MainTab=mainTab)=>{
  setMainTab(tab);setHistoryStack([]);setActive(next);setDataset(null);
  setBuilding('');setFloor('');setLocation('');setLocationName('');setPoint('');
  setMeasurementType('');setFiltersOpen(false);
  setSearch('');setStart('');setEnd('');setStatus('');setQuality('');
  offsetRef.current=0;
 };
 const home=()=>switchView(summary?.active_schema==='twin18'?'locations':'buildings','buildings');
 const navigate=(row:Record<string,unknown>)=>{
  if(active==='buildings')pushPage('locations',{building:String(row.building_code||''),floor:'',location:'',point:''});
  else if(active==='floors')pushPage('locations',{building:String(row.building_code||''),floor:String(row.floor_level||''),location:'',point:''});
  else if(active==='bim'||active==='bim_elements')pushPage('locations',{building:String(row.building_code||''),floor:'',location:'',point:''});
  else if(active==='locations')pushPage('sensors',{location:String(row.location_code||''),locationName:String(row.display_name||row.location_code||''),point:''});
  else if(active==='sensors'){
   setSelectedSensorType(displaySensor(row.measurement_type));
   const code=String(row.location_code||'');
   const meta=locationOptions.find(loc=>loc.location_code===code);
   pushPage('readings',{location:code,locationName:meta?.display_name||code,point:String(row.point_code||'')});
  }
 };
 const navigable=['buildings','floors','bim','bim_elements','locations','sensors'].includes(active);
 const showBuilding=summary?.active_schema==='digital_twin'&&buildings.length>1&&['floors','bim','bim_elements','locations','sensors','readings','ai_results','forecasts','maintenance'].includes(active);
 const scopedLocations=active==='locations'&&Boolean(building);
 const globalSensors=mainTab==='sensors'&&active==='sensors'&&historyStack.length===0;
 const scopedSensors=active==='sensors'&&Boolean(location)&&!globalSensors;
 const scopedReadings=active==='readings'&&Boolean(point);
 const showContext=(Boolean(floor)&&active==='locations')||(showBuilding&&!globalSensors&&!scopedLocations&&!scopedSensors&&!scopedReadings)||(Boolean(location)&&['ai_results','forecasts','maintenance'].includes(active))||(Boolean(point)&&['ai_results','forecasts'].includes(active));
 const availableLocations=locationOptions.filter(loc=>(!building||loc.building_code===building)&&(!floor||loc.floor_level===floor));
 const availableFloors=[...new Set(locationOptions.filter(loc=>!building||loc.building_code===building).map(loc=>loc.floor_level))].sort();
 const filterCount=[building,floor,location,measurementType].filter(Boolean).length;
 const clearSensorFilters=()=>{setBuilding('');setFloor('');setLocation('');setLocationName('');setMeasurementType('')};
 const buildingLabel=buildings.find(b=>b.building_code===building)?.building_code||building;
 const displayLocation=locationName||location;
 const [selectedSensorType,setSelectedSensorType]=useState('Sensor');
 const load=useCallback(async(table:string,offset=0,silent=false)=>{
  offsetRef.current=offset;
  const requestId=++latestRequestRef.current;
  if(!silent){setLoading(true);setError('');}
  const params=new URLSearchParams({offset:String(offset)});
  if(building&&table!=='buildings')params.set('building',building);
  if(floor&&['locations','sensors'].includes(table))params.set('floor',floor);
  if(location&&['sensors','readings','maintenance','ai_results','forecasts'].includes(table))params.set('location',location);
  if(point&&['readings','ai_results','forecasts'].includes(table))params.set('point',point);
  if(search&&['buildings','locations','sensors'].includes(table))params.set('search',search);
  if(measurementType&&table==='sensors')params.set('measurement_type',measurementType);
  if(start&&['readings','ai_results','forecasts'].includes(table))params.set('start',new Date(start).toISOString());
  if(end&&['readings','ai_results','forecasts'].includes(table))params.set('end',new Date(end).toISOString());
  if(status&&['ai_results','alerts','maintenance'].includes(table))params.set('status',status);
  if(quality&&table==='readings')params.set('quality',quality);
  try{
   const result=await json(`/api/admin/database/${table}?${params}`) as DataSet;
   if(requestId===latestRequestRef.current)setDataset(result);
  }catch(e){
   if(requestId===latestRequestRef.current){setError(String(e));if(!silent)setDataset(null)}
  }finally{
   if(requestId===latestRequestRef.current)setLoading(false);
  }
 },[building,location,point,floor,measurementType,search,start,end,status,quality]);
 useEffect(()=>{json('/api/admin/database/summary').then(data=>{const value=data as Summary;setSummary(value);if(value.active_schema==='twin18')setActive('locations');}).catch(e=>setError(String(e)))},[]);
 useEffect(()=>{json('/api/admin/buildings').then(data=>setBuildings((data as {buildings:BuildingOption[]}).buildings)).catch(()=>setBuildings([]))},[]);
 useEffect(()=>{json('/api/admin/database/filter-options').then(data=>{
  const options=data as {locations:LocationOption[];sensor_types:string[]};
  setLocationOptions(options.locations||[]);setSensorTypes(options.sensor_types||[]);
 }).catch(()=>{setLocationOptions([]);setSensorTypes([])})},[]);
 useEffect(()=>{void load(active)},[active,load,reload]);
 // PostgreSQL NOTIFY → authenticated SSE. Keep the current filters and page offset.
 // Reconnection/visibility refresh also recover updates missed while offline.
 useEffect(()=>{
  if(!['sensors','readings'].includes(active)||typeof EventSource==='undefined')return;
  const stream=new EventSource('/api/admin/database/updates');
  let pending:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(pending)clearTimeout(pending);pending=setTimeout(()=>{void load(active,offsetRef.current,true)},120)};
  stream.addEventListener('readings-changed',refresh);
  stream.addEventListener('open',refresh);
  const visible=()=>{if(document.visibilityState==='visible')refresh()};
  document.addEventListener('visibilitychange',visible);
  return()=>{if(pending)clearTimeout(pending);stream.close();document.removeEventListener('visibilitychange',visible)};
 },[active,load]);
 const cols=dataset?.rows.length?Object.keys(dataset.rows[0]).filter(k=>!(scopedLocations&&k==='building_code')&&!(scopedReadings&&['point_code','replay_id'].includes(k))):[];
 const readingDetails=scopedReadings&&active==='readings';
 const formatReading=(value:unknown)=>typeof value==='number'?Number(value.toFixed(2)).toString():value===null||value===undefined?'—':String(value);
 const formatTimestamp=(value:unknown)=>value?new Date(String(value)).toLocaleString('en-MY',{dateStyle:'medium',timeStyle:'medium',hour12:true}):'No readings yet';
 const displaySensor=(value:unknown)=>{const text=String(value||'');return text==='co2'?'CO₂':text.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());};

 const hasFilters=['buildings','locations','sensors','readings','ai_results','forecasts','alerts','maintenance'].includes(active);
 const emptyText=active==='ai_results'?'No stored AI anomaly results yet. The AI persistence workflow has not been connected.':active==='forecasts'?'No saved forecast results yet.':active==='alerts'?'No persisted alerts yet.':active==='notifications'?'No notifications have been saved yet.':active==='maintenance'?'No maintenance records yet.':'No records match the current selection.';
 return <section className="admin-page">
  <div className="page-heading admin-heading"><div><span className="eyebrow admin-eyebrow">DATABASE / ADMINISTRATOR</span><h1>Database Management</h1></div></div>
  <nav className="admin-main-tabs" aria-label="Database sections">
   {mainTabs.filter(tab=>available.includes(tab.section)||tab.id==='buildings').map(tab=><button key={tab.id} type="button" className={mainTab===tab.id?'selected':''} aria-current={mainTab===tab.id?'page':undefined} onClick={()=>switchView(tab.section,tab.id)}>{tab.label}</button>)}
  </nav>
  <nav className="admin-breadcrumb" aria-label="Database navigation">
   {historyStack.length>0&&<button type="button" className="admin-outline" onClick={back}>← Back</button>}
   <button type="button" className="admin-crumb-home" onClick={home}>Database</button>
   {historyStack.filter(p=>p.active!=='home').map((p,i)=><span key={i} className="admin-crumb-text">/ {names[p.active]||p.active}</span>)}
   <span className="admin-crumb-current">/ {names[active]||active}</span>
  </nav>
  {historyStack.length===0&&secondaryViews[mainTab].length>0&&<div className="admin-secondary-links" aria-label="Related database records">
   {secondaryViews[mainTab].filter(view=>available.includes(view.id)).map(view=><button key={view.id} type="button" className={active===view.id?'selected':''} onClick={()=>switchView(view.id,mainTab)}>{view.label}</button>)}
  </div>}
  {globalSensors&&<div className="admin-sensor-tools">
   <button type="button" className="admin-outline admin-filter-toggle" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/> Filters{filterCount? ` (${filterCount})`:''} {filtersOpen?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</button>
   {filterCount>0&&<button type="button" className="admin-clear-filters" onClick={clearSensorFilters}>Clear filters</button>}
  </div>}
  {globalSensors&&filtersOpen&&<div className="admin-sensor-filter-panel">
   <div className="admin-filter-grid">
    <label>Building<select value={building} onChange={e=>{setBuilding(e.target.value);setFloor('');setLocation('');setLocationName('')}}><option value="">All buildings</option>{buildings.map(b=><option key={b.building_code} value={b.building_code}>{b.building_code}</option>)}</select></label>
    <label>Floor<select value={floor} onChange={e=>{setFloor(e.target.value);setLocation('');setLocationName('')}}><option value="">All floors</option>{availableFloors.map(f=><option key={f} value={f}>{f.replace('_',' ')}</option>)}</select></label>
    <label>Location<select value={location} onChange={e=>{setLocation(e.target.value);setLocationName(locationOptions.find(l=>l.location_code===e.target.value)?.display_name||'')}}><option value="">All locations</option>{availableLocations.map(l=><option key={l.location_code} value={l.location_code}>{l.display_name} ({l.location_code})</option>)}</select></label>
    <label>Sensor type<select value={measurementType} onChange={e=>setMeasurementType(e.target.value)}><option value="">All types</option>{sensorTypes.map(t=><option key={t} value={t}>{displaySensor(t)}</option>)}</select></label>
   </div>
   <div className="admin-filter-actions"><button type="button" className="admin-outline" onClick={clearSensorFilters}>Clear filters</button><button type="button" className="admin-outline" onClick={()=>setFiltersOpen(false)}>Done</button></div>
  </div>}
  {showContext&&<div className="admin-context-bar">{showBuilding&&<div className="admin-context-field"><label htmlFor="admin-building">Building</label><select id="admin-building" value={building} onChange={e=>{setBuilding(e.target.value);setFloor('');setLocation('');setPoint('')}}><option value="">All buildings</option>{buildings.map(b=><option key={b.building_code} value={b.building_code}>{b.building_name}</option>)}</select></div>}{floor&&active==='locations'&&<div className="admin-context-scope"><span>Floor: {floor}</span><button type="button" className="admin-outline" onClick={()=>setFloor('')}>Clear</button></div>}{location&&<div className="admin-context-scope"><span>Location: {location}</span><button type="button" className="admin-outline" onClick={()=>{setLocation('');setPoint('')}}>Clear</button></div>}{point&&<div className="admin-context-scope"><span>Sensor: {point}</span><button type="button" className="admin-outline" onClick={()=>setPoint('')}>Clear</button></div>}</div>}
  {hasFilters&&<div className="admin-task-filters">
    {['buildings','locations','sensors'].includes(active)&&!(active==='buildings'&&buildings.length<=1)&&<label>Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder={active==='buildings'?'Building name or code':active==='locations'?'Location name or code':'Sensor code or type'}/></label>}
    {['readings','ai_results','forecasts'].includes(active)&&<><label>From<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>To<input type="datetime-local" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label></>}
    {active==='readings'&&<label>Quality<select value={quality} onChange={e=>setQuality(e.target.value)}><option value="">All qualities</option><option value="synthetic">Synthetic</option><option value="missing">Missing</option></select></label>}
    {active==='ai_results'&&<label>Prediction<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All predictions</option><option value="Normal">Normal</option><option value="Abnormal">Abnormal</option><option value="Unknown">Unknown</option></select></label>}
    {active==='alerts'&&<label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['New','Review','Acknowledged','Closed'].map(t=><option key={t} value={t}>{t}</option>)}</select></label>}
    {active==='maintenance'&&<label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['Scheduled','In Progress','Completed','Cancelled'].map(t=><option key={t} value={t}>{t}</option>)}</select></label>}
   </div>}
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <div className="surface admin-table-wrap">
   <div className="admin-table-title">
    <div className="admin-table-heading">
     {scopedReadings?<><span className="admin-heading-overline">SENSOR READINGS</span><strong className="admin-reading-sensor-title">{point}</strong><p>{selectedSensorType}{displayLocation?' · '+displayLocation:''} · Historical sensor observations</p></>
      :<><strong>{globalSensors?'All Sensors':names[active]||active}</strong>
      {scopedLocations?<p className="admin-table-context"><Building2 size={13} aria-hidden="true"/> {buildingLabel} · {dataset?.total??dataset?.rows.length??0} monitoring locations</p>
       :scopedSensors?<p className="admin-table-context"><MapPin size={13} aria-hidden="true"/> {displayLocation} ({location}) · {dataset?.total??dataset?.rows.length??0} sensors</p>
       :globalSensors?<p>{dataset?.total??dataset?.rows.length??0} registered sensors · Select a sensor to view its historical readings.</p>
       :<p>{descriptions[active]||'Database records'}</p>}</>}
    </div>
    <button className="admin-outline" disabled={loading} onClick={()=>void load(active,offsetRef.current)}>Refresh</button>
   </div>
   {loading?<p>Loading database records…</p>
    :dataset?.rows.length&&active==='sensors'
    ?<table className="admin-table admin-sensor-overview">
      <thead><tr><th>Sensor</th>{!scopedSensors&&<th>Location</th>}<th>Latest reading</th><th>Last recorded</th></tr></thead>
      <tbody>{dataset.rows.map((row,i)=><tr key={i} className="admin-navigable-row" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(row)}}} onClick={()=>navigate(row)}>
       <td><strong className="admin-sensor-code">{String(row.point_code)}</strong><span className="admin-sensor-type">{displaySensor(row.measurement_type)}</span></td>
       {!scopedSensors&&<td>{String(row.location_code||'—')}</td>}
       <td><strong className="admin-latest-value">{row.latest_timestamp?formatReading(row.latest_value):'—'}</strong>{Boolean(row.latest_timestamp)&&<span className="admin-latest-unit">{String(row.unit||'')}</span>}</td>
       <td>{formatTimestamp(row.latest_timestamp)}</td>
      </tr>)}</tbody>
     </table>
    :dataset?.rows.length
    ?<table className="admin-table">
      <thead><tr>{cols.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}{readingDetails&&<th>Details</th>}</tr></thead>
      <tbody>{dataset.rows.map((row,i)=><tr key={i} className={navigable?'admin-navigable-row':undefined} tabIndex={navigable?0:undefined} onKeyDown={navigable?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(row)}}:undefined} onClick={navigable?()=>navigate(row):undefined}>
       {cols.map(k=><td key={k}>{row[k]===null?'—':typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}</td>)}
       {readingDetails&&<td><details className="admin-reading-details"><summary>View</summary><div><b>Replay ID</b><span>{String(row.replay_id??'—')}</span></div><div><b>Point code</b><span>{String(row.point_code??'—')}</span></div></details></td>}
      </tr>)}</tbody>
     </table>
    :<p>{emptyText}</p>}

  </div>
  {dataset&&<div className="admin-pagination"><span>Rows {dataset.rows.length?dataset.offset+1:0}–{dataset.offset+dataset.rows.length}</span><button disabled={loading||dataset.offset===0} onClick={()=>void load(active,Math.max(0,dataset.offset-100))}>Previous</button><button disabled={loading||dataset.rows.length<100} onClick={()=>void load(active,dataset.offset+100)}>Next</button></div>}
 </section>;
}
export function AdminLogin({onSuccess,onClose}:{onSuccess:(session:Session)=>void;onClose:()=>void}) {
 const [username,setUsername]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setError('');setLoading(true);try{const session=await json('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}) as Session;setPassword('');onSuccess(session);}catch(e){setError(String(e));}finally{setLoading(false);}}
 return <section className="admin-login"><div className="admin-login-card"><button type="button" className="admin-close" aria-label="Close login" onClick={onClose}>×</button><span className="admin-eyebrow">RESTRICTED ACCESS</span><h1>Admin Login</h1><form onSubmit={submit}><label>Username<input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="admin-error" role="alert">{error}</p>}<button className="admin-submit" disabled={loading} type="submit">{loading?'Signing in…':'Sign in'}</button></form></div></section>;
}
export function useAdminSession(){
 const [session,setSession]=useState<Session>({authenticated:false,username:null});
 useEffect(()=>{json('/api/admin/session').then(s=>setSession(s as Session)).catch(()=>setSession({authenticated:false,username:null}));},[]);
 const logout=async()=>{try{await json('/api/admin/logout',{method:'POST'});}finally{setSession({authenticated:false,username:null});}};
 return {session,setSession,logout};
}
