import { useState } from 'react';
import { POINTS, ASSETS, readingLabel, useTwin } from '../services/twin';
import { TelemetryChart } from '../components/TelemetryChart';
import { Eyebrow } from '../components/UI';
export function Analytics(){
 const {readings,history}=useTwin();
 const [windowSize,setWindowSize]=useState(30);
 const supply=['SAT-501A','SAT-504','SAT-507'];
 const active=POINTS.filter(p=>readings[p.code]).length;
 const temps=supply.map(code=>readings[code]?.value).filter((v):v is number=>typeof v==='number');
 const mean=temps.length?temps.reduce((a,b)=>a+b,0)/temps.length:null;
 const samples=history.slice(-windowSize*9);
 const latest=(code:string)=>readingLabel(code,readings[code]);
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>ANALYTICS</Eyebrow><h1>Building performance</h1><p>Live operational telemetry · Snowdon Towers, Level 5</p></div><div className="segmented">{[15,30,60,90].map(n=><button className={windowSize===n?'active':''} key={n} onClick={()=>setWindowSize(n)}>{n} samples</button>)}</div></div>
 <div className="kpi-grid"><KPI title="Active channels" value={String(active)} unit="/ 9" delta="Simulated sensor data"/><KPI title="Mean supply temp" value={mean?.toFixed(2)||'—'} unit="°C" delta="Three HRU units"/><KPI title="Damper position" value={readings['DP-504']?.value.toFixed(1)||'—'} unit="%" delta="HRU504"/><KPI title="Cooling valve" value={readings['CV-507']?.value.toFixed(1)||'—'} unit="%" delta="HRU507"/></div>
 <div className="analytics-row-main"><section className="surface chart-panel energy-chart"><div className="chart-heading"><h3>Supply-air temperatures</h3><span>°C · live history</span></div><TelemetryChart codes={supply} title="Supply-air temperature"/></section><section className="surface chart-panel occupancy-bars"><div className="chart-heading"><h3>Measurements by HRU</h3><span>Reporting points</span></div><div className="bar-chart"><div className="bar-chart-area">{ASSETS.map(asset=><div key={asset} className="bar-group"><div className="bar-column" style={{height:`${POINTS.filter(p=>p.assetId===asset&&readings[p.code]).length/3*100}%`}}/><span>{asset}</span></div>)}</div></div></section></div>
 <div className="analytics-row-second"><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Air and room temperatures</h3><span>°C</span></div><TelemetryChart codes={['MAT-501A','S-L5-008-TEMP']} title="Mixed air / room temperature"/></section><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Damper and valve positions</h3><span>%</span></div><TelemetryChart codes={['DP-504','DPCMD-504','CV-507']} title="Damper and valve"/></section></div>
 <section className="surface air-quality"><div className="air-quality-title"><h3>Current sensor values</h3><p>{samples.length} recent samples in the rolling chart window</p></div>{POINTS.map(p=><div className="air-row" key={p.code}><span>{p.code}</span><div className="air-progress"><div style={{width:`${p.unit==='%'?Math.min(100,readings[p.code]?.value||0):p.unit==='ON/OFF'?(readings[p.code]?.value?100:0):Math.min(100,(readings[p.code]?.value||0)*3)}%`}}/></div><code>{latest(p.code)}</code><code>{p.assetId}</code></div>)}</section>
 </div>;
}
function KPI({title,value,unit,delta}:{title:string;value:string;unit:string;delta:string}){return <div className="surface kpi-card"><Eyebrow>{title}</Eyebrow><div className="kpi-value">{value}<small>{unit}</small></div><div className="kpi-delta">{delta}</div></div>}
