
import { db, getReading, getAssetCurrentValues, getLatestAnomalyRows } from "./data/dataStore.js";

const esc = x => String(x ?? "—").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const latest = code => getReading(code)?.value ?? null;
const display = code => {
 const value = latest(code);
 if (value == null || !Number.isFinite(Number(value))) return "—";
 if (code === "FS-501A") return Number(value) === 1 ? "ON" : Number(value) === 0 ? "OFF" : "—";
 return Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
};
const info = code => db.Sensor_Points.find(p=>p.point_code===code);
const history = code => db.Historical_Sensor_Readings.filter(r=>String(r.point_code??r.sensor_id)===code && Number.isFinite(Number(r.value))).sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))).slice(-110);
const when = ts => { if (!ts) return "Not available";const d=new Date(ts);return Number.isNaN(d.getTime())?String(ts):d.toLocaleString(); };

export function heading(title,subtitle) {
 return '<div class="ai-heading"><div><div class="ai-kicker">Workspace / Level 5</div><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div></div>';
}
export function banner(title,text) {
 return '<div class="ai-banner"><strong>'+esc(title)+'</strong><div>'+esc(text)+'</div></div>';
}
export function metrics(items){
 return '<div class="ai-metric-grid '+(items.length===3?'three':'')+'">'+items.map(p=>'<div class="ai-metric"><div class="ai-metric-label">'+esc(p[0])+'</div><div class="ai-metric-value">'+esc(p[1])+'</div><div class="ai-metric-foot">'+esc(p[2]||'')+'</div></div>').join('')+'</div>';
}
const titleCard=(title,caption,action,label)=>'<div class="ai-card-title"><div><strong>'+esc(title)+'</strong>'+(caption?'<small>'+esc(caption)+'</small>':'')+'</div>'+(action?'<button class="ai-link" data-route="'+esc(action)+'">'+esc(label||'View ↗')+'</button>':'')+'</div>';

function chartContent(codes){
 const palettes=['#668cb8','#4a9a83','#b77f5f','#9274b6'];
 const lines=codes.map((code,i)=>({code,rows:history(code),color:palettes[i%palettes.length]}));
 const available=lines.filter(p=>p.rows.length);
 if(!available.length)return '<div class="ai-empty">No readings available yet.</div>';
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

// Refresh chart contents without recreating the surrounding page or xeokit.
export function chart(codes) {
 return '<div data-chart-codes="'+esc(codes.join(","))+'">'+chartContent(codes)+'</div>';
}
export function refreshLiveCharts(root = document) {
 root.querySelectorAll("[data-chart-codes]").forEach(node=>{
  node.innerHTML=chartContent(node.dataset.chartCodes.split(",").filter(Boolean));
 });
 root.querySelectorAll("[data-live-asset-summary]").forEach(node=>{
  const points=getAssetCurrentValues(node.dataset.liveAssetSummary);
  node.textContent=points.slice(0,2).map(p=>(p.point_code||p.sensor_id)+" "+display(p.point_code||p.sensor_id)+" "+(p.unit||"")).join(" · ") || "No readings";
 });
 root.querySelectorAll("[data-live-current-code]").forEach(node=>{
  const code=node.dataset.liveCurrentCode;
  node.textContent=display(code)+(code==="FS-501A"?"":" "+(info(code)?.unit||""));
 });
 root.querySelectorAll("[data-live-plot-caption]").forEach(node=>{
  node.textContent=node.dataset.livePlotCaption.split(",").map(c=>c+" "+display(c)).join(" / ");
 });
}
export function overviewDetails(){
 const channels=[
  {name:"Supply-air temperature",codes:["SAT-501A","SAT-504","SAT-507"],path:"/sensor-data"},
  {name:"Damper and cooling controls",codes:["DP-504","DPCMD-504","CV-507"],path:"/sensor-data"}
 ];
 const cards=channels.map(c=>'<section class="ai-card">'+titleCard(c.name,'Available stored time-series readings',c.path,'Monitoring ↗')+chart(c.codes)+'</section>').join('');
 const assets=["HRU501A","HRU504","HRU507"].map(name=>{
  const values=getAssetCurrentValues(name);
  const summary=values.slice(0,2).map(p=>esc(p.point_code||p.sensor_id)+' '+esc(display(p.point_code||p.sensor_id))+' '+esc(p.unit||'')).join(' · ');
  return '<div class="ai-key-value"><span>'+name+'</span><strong data-live-asset-summary="'+esc(name)+'">'+(summary||'No readings')+'</strong></div>';
 }).join('');
 return '<div class="ai-grid-two">'+cards+'</div><div class="ai-grid-two"><section class="ai-card">'+
 titleCard('Equipment & latest readings','Three Level 5 HRU units','/sensor-data','All channels ↗')+assets+
 '</section><section class="ai-card">'+titleCard('Forecasting & anomalies','Operational status','/model-results','Forecast ↗')+
 '<hr class="ai-divider"/>'+
 titleCard('Recent anomalies','Recorded events','/anomalies','Investigate ↗')+
 (getLatestAnomalyRows().slice(0,3).map(a=>'<div class="ai-key-value"><span>'+esc(a.point_code||a.sensor_id)+'</span><strong>'+esc(a.anomaly_status||a.severity||'Recorded')+'</strong></div>').join('')||'<p class="ai-demo-foot">No current anomaly records.</p>')+'</section></div>';
}

function pointAsset(point){
 const sensor=db.Sensors.find(s=>String(s.sensor_id??s.sensor_code)===String(point.sensor_id??point.sensor_code));
 return String(sensor?.asset_id??sensor?.equipment_code??'');
}
function pointRow(p){
 const reading=getReading(p.point_code);
 return '<div class="ai-point-row" data-channel="'+esc(p.point_code)+'"><div><div class="point-code">'+esc(p.point_code)+'</div><div class="point-name">'+esc(p.measurement_type)+'</div><div class="point-time">'+(reading?esc(when(reading.latest_update||reading.timestamp)):'No current reading')+'</div></div><div><div class="point-value">'+esc(display(p.point_code))+' <small>'+esc(p.point_code === "FS-501A" ? "" : p.unit)+'</small></div><div class="point-quality">'+esc(reading?.quality||(reading?'Recorded':'No data'))+'</div></div></div>';
}
export function monitoring(){
 const plots=[
  ['Supply-air temperature',['SAT-501A','SAT-504','SAT-507'],'°C'],
  ['Mixed-air and room temperature',['MAT-501A','S-L5-008-TEMP'],'°C'],
  ['Outdoor-air damper position and command',['DP-504','DPCMD-504'],'%'],
  ['Cooling-valve position',['CV-507'],'%']
 ];
 const plotsHtml=plots.map(p=>'<section class="ai-card"><div class="ai-card-title"><div><strong>'+esc(p[0])+'</strong><small data-live-plot-caption="'+esc(p[1].join(','))+'">'+esc(p[1].map(c=>c+' '+display(c)).join(' / '))+'</small></div></div>'+chart(p[1])+'</section>').join('');
 const groups=[
  ['HRU501A',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU501A')],
  ['HRU504',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU504')],
  ['HRU507',db.Sensor_Points.filter(p=>pointAsset(p)==='HRU507'&&!p.point_code.startsWith('S-L5-008'))],
  ['Unit 507 Environmental Sensor',db.Sensor_Points.filter(p=>p.point_code.startsWith('S-L5-008'))]
 ];
 const cards=groups.map(g=>'<section class="ai-point-card" data-equipment="'+esc(g[0])+'">'+titleCard(g[0],g[1].length+' measurement channels','/bim-viewer','BIM ↗')+(g[1].map(pointRow).join('')||'<div class="ai-empty">No points registered.</div>')+'</section>').join('');
 return '<div class="page ai-page">'+heading('Sensor Monitoring','All 9 measurement channels, organized by equipment.')+
 
 '<div class="ai-chip-row"><input id="channelSearch" class="field" aria-label="Search channels" placeholder="Search channels or equipment…" style="max-width:260px"/><span class="ai-chip">Building / Level 5</span></div>'+
 '<div class="ai-grid-two">'+plotsHtml+'</div><div class="ai-point-grid" id="channelCards">'+cards+'</div></div>';
}

export function forecasting(horizon=15,code='SAT-507'){
 const point=info(code),unit=point?.unit||'';
 const choices=db.Sensor_Points.map(p=>'<option value="'+esc(p.point_code)+'" '+(p.point_code===code?'selected':'')+'>'+esc(p.point_code)+'</option>').join('');
 const buttons=[5,15,30,60].map(h=>'<button class="ai-chip '+(h===horizon?'is-active':'')+'" data-horizon="'+h+'" aria-pressed="'+(h===horizon)+'">'+h+' min</button>').join('');
 return '<div class="page ai-page">'+heading('AI Forecasting','Sensor trends and forecasting status.')+
 '<div class="ai-chip-row"><label class="ai-chip">Channel <select class="select" data-forecast-point>'+choices+'</select></label><div style="flex:1"></div>'+buttons+'</div>'+
 '<div class="ai-grid-forecast"><section class="ai-card">'+titleCard('Sensor trend',code+' · recorded values')+
 '<div class="ai-metric-value" data-live-current-code="'+esc(code)+'" style="font-size:24px;margin:6px 0 12px">'+esc(display(code))+' '+esc(unit)+'</div>'+chart([code])+
 '</section><section class="ai-card">'+titleCard('Forecast status','Model availability')+
 '<div class="ai-key-value"><span>Forecast model</span><strong>Unavailable</strong></div>'+
 '<div class="ai-key-value"><span>Selected horizon</span><strong>'+horizon+' minutes</strong></div>'+
 '<div class="ai-key-value"><span>Forecast values</span><strong>—</strong></div>'+
 '<div class="ai-key-value"><span>Accuracy metrics</span><strong>—</strong></div></section></div></div>';
}

export function historical(){
 const rows=db.Historical_Sensor_Readings.slice().sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
 const table=rows.slice(0,60).map(r=>{const code=String(r.point_code??r.sensor_id??'');return '<tr><td>'+esc(when(r.timestamp))+'</td><td>'+esc(code)+'</td><td>'+esc(r.value)+'</td><td>'+esc(info(code)?.unit||'')+'</td><td>'+esc(r.quality||'simulated')+'</td></tr>';}).join('');
 return '<div class="page ai-page">'+heading('Historical Data','Sensor history and recorded trends.')+
 '<section class="ai-card" style="margin-bottom:14px">'+titleCard('Supply-air temperature','Recorded history')+chart(['SAT-501A','SAT-504','SAT-507'])+'</section>'+
 '<section class="ai-card" style="margin-bottom:14px">'+titleCard('Recent readings','Latest 60 stored records')+
 (table?'<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>Timestamp</th><th>Point</th><th>Value</th><th>Unit</th><th>Quality</th></tr></thead><tbody>'+table+'</tbody></table></div>':'<div class="ai-empty">No historical readings available.</div>')+'</section></div>';
}

export function simulator(){
 const timestamp=db.Sensor_Readings.map(r=>r.latest_update||r.timestamp).filter(Boolean).sort().at(-1);
 const summary=['SAT-501A','MAT-501A','FS-501A','SAT-504','DP-504','DPCMD-504','SAT-507','CV-507','S-L5-008-TEMP'].map(code=>
  '<div class="ai-key-value"><span>'+esc(code)+'</span><strong data-live-current-code="'+esc(code)+'">'+esc(display(code))+' '+esc(code==='FS-501A'?'':info(code)?.unit||'')+'</strong></div>').join('');
 return '<div class="page ai-page">'+heading('Sensor Simulator','Three-HRU MQTT telemetry.')+
 '<div class="ai-chip-row"><div data-live-status role="status" aria-live="polite" class="ai-badge">Checking MQTT connection…</div><span class="ai-chip">Last reading: <span data-live-last>'+esc(timestamp?when(timestamp):'Unavailable')+'</span></span></div>'+
 '<div data-live-coverage class="ai-demo-foot">Checking sensor coverage…</div>'+
 '<div class="ai-grid-two"><section class="ai-card">'+titleCard('Data connection','Synthetic MQTT stream')+
 '<div class="ai-key-value"><span>Source</span><strong>Independent three-HRU simulation</strong></div>'+
 '<div class="ai-key-value"><span>Transport</span><strong>MQTT → PostgreSQL</strong></div>'+
 '<div class="ai-key-value"><span>Channels</span><strong>9</strong></div></section>'+
 '<section class="ai-card">'+titleCard('Latest sensor values','PostgreSQL')+summary+'</section></div></div>';
}

export function settings(theme,connectionState){
 const sources=[
 ['Three-HRU simulator','Synthetic MQTT','Active when publishing'],
 ['MQTT broker','Messaging','Configured'],
 ['PostgreSQL','Database',connectionState.status==='connected'?'Connected':'Unavailable'],
 ['Physical BMS sensors','Hardware','Not connected']
 ];
 const sourceTable=sources.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('');
 const themes=['light','dark','system'].map(name=>
 '<button type="button" class="ai-appearance-option '+(name===theme?'is-selected':'')+'" aria-pressed="'+(name===theme)+'" data-appearance-option="'+name+'"><span class="ai-theme-preview '+name+'"></span><span class="ai-theme-name">'+name[0].toUpperCase()+name.slice(1)+'</span></button>').join('');
 return '<div class="page ai-page">'+heading('Settings','Manage data sources, integrations, and your workspace.')+
 '<div class="ai-tablist" role="tablist"><button class="ai-tab" data-settings-tab="sources" aria-selected="true">Data sources & integrations</button><button class="ai-tab" data-settings-tab="appearance" aria-selected="false">Appearance</button><button class="ai-tab" data-settings-tab="workspace" aria-selected="false">Workspace</button></div>'+
 
 '<div data-settings-section="sources"><section class="ai-card">'+titleCard('Data sources & integrations','Source type and configured state')+
 '<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>Source</th><th>Type</th><th>Status</th></tr></thead><tbody>'+sourceTable+'</tbody></table></div></section></div>'+
 '<div data-settings-section="appearance"><section class="ai-card">'+titleCard('Appearance','Saved on this browser')+
 '<div class="ai-appearance-grid">'+themes+'</div><p class="ai-demo-foot">System mode follows your device color preference.</p></section></div>'+
 '<div data-settings-section="workspace"><section class="ai-card">'+titleCard('Workspace','Snowdon Towers · Level 5')+
 '<div class="ai-key-value"><span>BIM Viewer</span><strong>xeokit 3D</strong></div><div class="ai-key-value"><span>Mapped physical sensors</span><strong>8</strong></div><div class="ai-key-value"><span>Measurement channels</span><strong>9</strong></div><div class="ai-key-value"><span>Data source</span><strong>Synthetic MQTT</strong></div></section></div></div>';
}

