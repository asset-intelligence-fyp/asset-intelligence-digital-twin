
import { db, getReading, getAssetCurrentValues, getLatestAnomalyRows } from "./data/dataStore.js";

const esc = x => String(x ?? "—").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const latest = code => getReading(code)?.value ?? null;
const display = code => latest(code) == null ? "—" : Number(latest(code)).toLocaleString(undefined,{maximumFractionDigits:2});
const info = code => db.Sensor_Points.find(p=>p.point_code===code);
const history = code => db.Historical_Sensor_Readings.filter(r=>String(r.point_code??r.sensor_id)===code && Number.isFinite(Number(r.value))).sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))).slice(-110);
const when = ts => { if (!ts) return "Not available";const d=new Date(ts);return Number.isNaN(d.getTime())?String(ts):d.toLocaleString(); };

export function heading(title,subtitle) {
 return '<div class="ai-heading"><div><div class="ai-kicker">Workspace / Level 5</div><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div><span class="ai-badge">Demo environment</span></div>';
}
export function banner(title,text) {
 return '<div class="ai-banner"><strong>'+esc(title)+'</strong><div>'+esc(text)+'</div></div>';
}
export function metrics(items){
 return '<div class="ai-metric-grid '+(items.length===3?'three':'')+'">'+items.map(p=>'<div class="ai-metric"><div class="ai-metric-label">'+esc(p[0])+'</div><div class="ai-metric-value">'+esc(p[1])+'</div><div class="ai-metric-foot">'+esc(p[2]||'')+'</div></div>').join('')+'</div>';
}
const titleCard=(title,caption,action,label)=>'<div class="ai-card-title"><div><strong>'+esc(title)+'</strong>'+(caption?'<small>'+esc(caption)+'</small>':'')+'</div>'+(action?'<button class="ai-link" data-route="'+esc(action)+'">'+esc(label||'View ↗')+'</button>':'')+'</div>';

export function chart(codes){
 const palettes=['#668cb8','#4a9a83','#b77f5f','#9274b6'];
 const lines=codes.map((code,i)=>({code,rows:history(code),color:palettes[i%palettes.length]}));
 const available=lines.filter(p=>p.rows.length);
 if(!available.length)return '<div class="ai-empty">No historical readings are available for these channels yet.<br/>Start replay and verify PostgreSQL ingestion.</div>';
 const vals=available.flatMap(c=>c.rows.map(r=>Number(r.value)));
 const min=Math.min(...vals),max=Math.max(...vals),pad=Math.max((max-min)*.16,.1);
 const lo=min-pad,hi=max+pad,left=44,right=674,top=14,bottom=155;
 const y=v=>top+(hi-v)/(hi-lo)*(bottom-top);
 const grids=Array.from({length:4},(_,i)=>{
  const v=lo+(hi-lo)*i/3,cy=y(v).toFixed(1);
  return '<line class="ai-chart-grid" x1="'+left+'" y1="'+cy+'" x2="'+right+'" y2="'+cy+'"/><text class="ai-chart-label" x="2" y="'+(Number(cy)+4)+'">'+v.toFixed(1)+'</text>';
 }).join('');
 const drawings=available.map(c=>{
  const points=c.rows.map((r,i)=>(left+(i/Math.max(1,c.rows.length-1))*(right-left)).toFixed(1)+','+y(Number(r.value)).toFixed(1)).join(' ');
  return '<polyline points="'+points+'" fill="none" stroke="'+c.color+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
 }).join('');
 const legend=lines.map(c=>'<span><span class="ai-legend-dot" style="background:'+c.color+'"></span>'+esc(c.code)+(c.rows.length?'':' · no data')+'</span>').join('');
 return '<svg class="ai-chart" viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label="Recorded sensor time series">'+grids+drawings+'<text class="ai-chart-label" x="44" y="177">Earlier</text><text class="ai-chart-label" x="674" y="177" text-anchor="end">Latest</text></svg><div class="ai-chart-legend">'+legend+'</div>';
}

export function overviewDetails(){
 const channels=[
  {name:"Supply-air temperature",codes:["SAT-501A","SAT-504","SAT-507"],path:"/sensor-data"},
  {name:"Supply-air velocity",codes:["AF-501A","AF-504","AF-507"],path:"/sensor-data"}
 ];
 const cards=channels.map(c=>'<section class="ai-card">'+titleCard(c.name,'Available stored time-series readings',c.path,'Monitoring ↗')+chart(c.codes)+'</section>').join('');
 const assets=["HRU501A","HRU504","HRU507"].map(name=>{
  const values=getAssetCurrentValues(name);
  const summary=values.slice(0,2).map(p=>esc(p.point_code||p.sensor_id)+' '+esc(display(p.point_code||p.sensor_id))+' '+esc(p.unit||'')).join(' · ');
  return '<div class="ai-key-value"><span>'+name+'</span><strong>'+(summary||'No current readings')+'</strong></div>';
 }).join('');
 return '<div class="ai-grid-two">'+cards+'</div><div class="ai-grid-two"><section class="ai-card">'+
 titleCard('Equipment & latest readings','Three Level 5 HRU assets','/sensor-data','All channels ↗')+assets+
 '</section><section class="ai-card">'+titleCard('AI forecasting & anomalies','Actual experiment outputs are not connected','/model-results','Forecast ↗')+
 '<div class="ai-demo-foot">TFT and Chronos metrics are not evaluated on this website. No fabricated forecasts are shown.</div><hr class="ai-divider"/>'+
 titleCard('Recent anomaly records','PostgreSQL demonstration data','/anomalies','Investigate ↗')+
 (getLatestAnomalyRows().slice(0,3).map(a=>'<div class="ai-key-value"><span>'+esc(a.point_code||a.sensor_id)+'</span><strong>'+esc(a.anomaly_status||a.severity||'Recorded')+'</strong></div>').join('')||'<p class="ai-demo-foot">No current anomaly records.</p>')+'</section></div>';
}

function pointAsset(point){
 const sensor=db.Sensors.find(s=>String(s.sensor_id??s.sensor_code)===String(point.sensor_id??point.sensor_code));
 return String(sensor?.asset_id??sensor?.equipment_code??'');
}
function pointRow(p){
 const reading=getReading(p.point_code);
 return '<div class="ai-point-row" data-channel="'+esc(p.point_code)+'"><div><div class="point-code">'+esc(p.point_code)+'</div><div class="point-name">'+esc(p.measurement_type)+'</div><div class="point-time">'+(reading?esc(when(reading.latest_update||reading.timestamp)):'No current reading')+'</div></div><div><div class="point-value">'+esc(display(p.point_code))+' <small>'+esc(p.unit)+'</small></div><div class="point-quality">'+esc(reading?.quality||(reading?'Recorded':'No data'))+'</div></div></div>';
}
export function monitoring(){
 const plots=[
  ['Supply-air temperature',['SAT-501A','SAT-504','SAT-507'],'°C'],
  ['Supply-air velocity',['AF-501A','AF-504','AF-507'],'m/s'],
  ['Relative humidity',['S-L5-008-HUM'],'%RH'],
  ['CO₂ concentration',['S-L5-008-CO2'],'ppm']
 ];
 const plotsHtml=plots.map(p=>'<section class="ai-card">'+titleCard(p[0],p[1].map(c=>c+' '+display(c)).join(' / ')+' '+p[2])+chart(p[1])+'</section>').join('');
 const groups=[
  ['HRU501A',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU501A')],
  ['HRU504',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU504')],
  ['HRU507',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU507'&&!p.point_code.startsWith('S-L5-008'))],
  ['Unit 507 Environmental Sensor',db.Sensor_Points.filter(p=>p.point_code.startsWith('S-L5-008'))]
 ];
 const cards=groups.map(g=>'<section class="ai-point-card" data-equipment="'+esc(g[0])+'">'+titleCard(g[0],g[1].length+' measurement channels','/bim-viewer','BIM ↗')+(g[1].map(pointRow).join('')||'<div class="ai-empty">No points registered.</div>')+'</section>').join('');
 return '<div class="page ai-page">'+heading('Sensor Monitoring','All 11 measurement channels, organized by equipment.')+
 banner('Local simulation · no physical sensor feed',db.Sensor_Points.length+' point registrations, '+db.Sensor_Readings.length+' cached latest readings. Data may be stale if replay has stopped.')+
 '<div class="ai-chip-row"><input id="channelSearch" class="field" aria-label="Search channels" placeholder="Search channels or equipment…" style="max-width:260px"/><span class="ai-chip">Building / Level 5</span><span class="ai-chip">Simulated data</span></div>'+
 '<div class="ai-grid-two">'+plotsHtml+'</div><div class="ai-point-grid" id="channelCards">'+cards+'</div><p class="ai-demo-foot">Recorded values come from the PostgreSQL cache, not external live building sensors. A connected SSE stream does not guarantee the latest values are fresh.</p></div>';
}

export function forecasting(horizon=15,code='SAT-507'){
 const point=info(code),unit=point?.unit||'';
 const choices=db.Sensor_Points.map(p=>'<option value="'+esc(p.point_code)+'" '+(p.point_code===code?'selected':'')+'>'+esc(p.point_code)+'</option>').join('');
 const buttons=[5,15,30,60].map(h=>'<button class="ai-chip '+(h===horizon?'is-active':'')+'" data-horizon="'+h+'" aria-pressed="'+(h===horizon)+'">'+h+' min</button>').join('');
 const rows=[['Output source','Not connected'],['Model version','Unavailable'],['Training run','Not verified'],['MAE','Not evaluated'],['RMSE','Not evaluated'],['Confidence','Not available']].map(p=>'<div class="ai-key-value"><span>'+p[0]+'</span><strong>'+p[1]+'</strong></div>').join('');
 return '<div class="page ai-page">'+heading('AI Forecasting','See what could happen next. Understand what is illustrative.')+
 banner('No trained forecasting model connected','No TFT or Chronos inference service is connected. Accuracy, confidence and calibrated uncertainty are not available.')+
 '<div class="ai-chip-row"><label class="ai-chip">Channel <select class="select" data-forecast-point>'+choices+'</select></label><div style="flex:1"></div>'+buttons+'</div>'+
 '<div class="ai-grid-forecast"><section class="ai-card">'+titleCard('Supply-air temperature / sensor trend',code+' · recorded simulation values')+
 '<div class="ai-metric-value" style="font-size:24px;margin:6px 0 12px">'+esc(display(code))+' '+esc(unit)+' <small style="font-size:11px;color:var(--muted)">Latest → forecast unavailable</small></div>'+chart([code])+
 '<div class="ai-forecast-note">Selected horizon: '+horizon+' minutes. This chart contains historical readings only, not model predictions.</div></section>'+
 '<section class="ai-card">'+titleCard('Model & evaluation','Training and production inference status')+
 '<span class="ai-badge">Not connected</span>'+rows+
 '<p class="ai-demo-foot">Evaluate a trained forecasting model before relying on its outputs.</p><button class="btn" data-route="/settings">Data source settings</button></section></div>'+
 '<section class="ai-card" style="margin-bottom:14px">'+titleCard('Forecast values','No fabricated prediction table')+
 '<div class="ai-empty">No model predictions available for the selected '+horizon+'-minute horizon.</div></section>'+
 '<section class="ai-card"><strong>How to read this forecast</strong><p class="ai-demo-foot">The recorded trend is from simulated values in PostgreSQL. No forecast, uncertainty interval, or AI-based anomaly diagnosis has been generated.</p></section></div>';
}

export function historical(){
 const rows=db.Historical_Sensor_Readings.slice().sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
 const table=rows.slice(0,60).map(r=>{const code=String(r.point_code??r.sensor_id??'');return '<tr><td>'+esc(when(r.timestamp))+'</td><td>'+esc(code)+'</td><td>'+esc(r.value)+'</td><td>'+esc(info(code)?.unit||'')+'</td><td>'+esc(r.quality||'simulated')+'</td></tr>';}).join('');
 return '<div class="page ai-page">'+heading('Historical Data','Explore the fault-free baseline behind the simulation.')+
 banner('Historical + simulated · not physical measurements','The 525,540-row historical dataset is a prepared local research artifact. Only records actually loaded from the backend are displayed here.')+
 metrics([['Loaded history rows',rows.length.toLocaleString(),'Current API/browser cache'],['Sampling interval','1 min','Dataset specification'],['CSV columns','16','Prepared historical dataset'],['HRU assets','3','Level 5 scope']])+
 '<section class="ai-card" style="margin-bottom:14px">'+titleCard('Historical temperature profile','Loaded PostgreSQL history · no illustrative CSV values')+chart(['SAT-501A','SAT-504','SAT-507'])+'</section>'+
 '<section class="ai-card" style="margin-bottom:14px">'+titleCard('Record explorer','Latest 60 cached readings')+
 (table?'<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>Timestamp</th><th>Point</th><th>Value</th><th>Unit</th><th>Quality</th></tr></thead><tbody>'+table+'</tbody></table></div>':'<div class="ai-empty">No historical records loaded into this browser session.</div>')+'</section>'+
 '<div class="ai-grid-two"><section class="ai-card">'+titleCard('Chronological partitions','Research dataset split · no random shuffling')+
 '<div style="display:flex;height:12px;overflow:hidden;border-radius:5px"><span style="width:70%;background:#648dbf"></span><span style="width:15%;background:#7eb4a1"></span><span style="width:15%;background:#9da8b5"></span></div>'+
 '<div class="ai-key-value"><span>Training</span><strong>70%</strong></div><div class="ai-key-value"><span>Validation</span><strong>15%</strong></div><div class="ai-key-value"><span>Holdout</span><strong>15%</strong></div></section>'+
 '<section class="ai-card">'+titleCard('Dataset details','Provenance and integration state')+
 '<div class="ai-key-value"><span>Origin</span><strong>LBNL-derived simulation</strong></div><div class="ai-key-value"><span>Adaptation</span><strong>Level 5 synthetic channels</strong></div><div class="ai-key-value"><span>Historical CSV</span><strong>Separate local file</strong></div><div class="ai-key-value"><span>Frontend CSV import</span><strong>Not implemented</strong></div></section></div></div>';
}

export function simulator(){
 const timestamp=db.Sensor_Readings.map(r=>r.latest_update||r.timestamp).filter(Boolean).sort().at(-1);
 const summary=['SAT-501A','AF-501A','SAT-504','AF-504','SAT-507','AF-507','S-L5-008-CO2'].map(code=>
  '<div class="ai-key-value"><span>'+esc(code)+'</span><strong>'+esc(display(code))+' '+esc(info(code)?.unit||'')+'</strong></div>').join('');
 return '<div class="page ai-page">'+heading('Sensor Simulator','Run local historical replay without controlling physical equipment.')+
 banner('Local simulation · no equipment controlled','The Python simulator runs at http://127.0.0.1:8001. The separate replay application implements Start / Stop / Reset, while fault-injection controls shown in the design reference are not implemented.')+
 '<div class="ai-chip-row"><span class="ai-badge">11 MQTT measurement channels</span><span class="ai-chip">Last cached reading: '+esc(timestamp?when(timestamp):'Unavailable')+'</span></div>'+
 '<div class="ai-grid-forecast"><section class="ai-card">'+titleCard('Historical MQTT replay','Controlled by the final Python simulator')+
 '<a class="btn btn-primary" href="http://127.0.0.1:8001/" target="_blank" rel="noopener noreferrer">Open simulator ↗</a>'+
 '<div class="ai-demo-foot">Start Mosquitto and the Node API, then run <code>python app.py</code> in <code>tools/level5_digital_twin_simulator_final</code>. Open the separate simulator for its Start / Stop / Reset controls.</div>'+
 '<div class="ai-key-value"><span>Replay mode</span><strong>Historical CSV</strong></div>'+
 '<div class="ai-key-value"><span>Transport</span><strong>MQTT · dt/+/+</strong></div>'+
 '<div class="ai-key-value"><span>Physical sensors</span><strong>Not connected</strong></div>'+
 '<div class="ai-key-value"><span>Fault injection</span><strong>Not available in current replay</strong></div></section>'+
 '<section class="ai-card">'+titleCard('Latest stored values','PostgreSQL · not simulator running state')+summary+'</section></div>'+
 '<section class="ai-card"><strong>Test the integration</strong><p class="ai-demo-foot">Start replay, open Sensor Monitoring, and check the newest timestamps. If they do not update, verify the Mosquitto broker and backend ingestion logs.</p><button class="btn" data-route="/sensor-data">Open Sensor Monitoring ↗</button></section></div>';
}

export function settings(theme,connectionState){
 const sources=[
 ['LBNL-derived CSV','Historical simulation','External local file'],
 ['Local simulator','Python MQTT replay','Separate process'],
 ['MQTT broker','Messaging','Backend configuration'],
 ['PostgreSQL','Database',connectionState.status==='connected'?'Connected':'Unavailable'],
 ['Smart Citizen','Public IoT','Under investigation'],
 ['openSenseMap','Public IoT','Under investigation'],
 ['ThingSpeak','Public IoT','Under investigation'],
 ['Physical sensors','Future BMS','Not connected']
 ];
 const sourceTable=sources.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('');
 const themes=['light','dark','system'].map(name=>
 '<button type="button" class="ai-appearance-option '+(name===theme?'is-selected':'')+'" aria-pressed="'+(name===theme)+'" data-appearance-option="'+name+'"><span class="ai-theme-preview '+name+'"></span><span class="ai-theme-name">'+name[0].toUpperCase()+name.slice(1)+'</span></button>').join('');
 return '<div class="page ai-page">'+heading('Settings','Manage data sources, integrations, and your workspace.')+
 '<div class="ai-tablist" role="tablist"><button class="ai-tab" data-settings-tab="sources" aria-selected="true">Data sources & integrations</button><button class="ai-tab" data-settings-tab="appearance" aria-selected="false">Appearance</button><button class="ai-tab" data-settings-tab="workspace" aria-selected="false">Workspace</button></div>'+
 banner('Connection transparency','The backend loads demonstration data from PostgreSQL. MQTT and Python replay run separately; no external IoT or physical hardware feed is connected.')+
 '<div data-settings-section="sources"><section class="ai-card">'+titleCard('Data sources & integrations','Source type and configured state')+
 '<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>Source</th><th>Type</th><th>Status</th></tr></thead><tbody>'+sourceTable+'</tbody></table></div></section></div>'+
 '<div data-settings-section="appearance"><section class="ai-card">'+titleCard('Appearance','Saved on this browser')+
 '<div class="ai-appearance-grid">'+themes+'</div><p class="ai-demo-foot">System mode follows your device color preference.</p></section></div>'+
 '<div data-settings-section="workspace"><section class="ai-card">'+titleCard('Workspace','Snowdon Towers Level 5 pilot')+
 '<div class="ai-key-value"><span>BIM Viewer</span><strong>xeokit 3D</strong></div><div class="ai-key-value"><span>Mapped physical sensors</span><strong>8</strong></div><div class="ai-key-value"><span>Measurement channels</span><strong>11</strong></div><div class="ai-key-value"><span>Source classification</span><strong>Simulated PoC</strong></div></section></div></div>';
}
