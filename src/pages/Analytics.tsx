import {ValueMotion} from '../components/ValueMotion';
import { useState } from 'react';
import { POINTS, useTwin } from '../services/twin';
import { TelemetryChart } from '../components/TelemetryChart';
import { Eyebrow } from '../components/UI';
import {sensorDisplay} from '../viewer/sensorPresentation.js';
export function Analytics(){
 const {readings,history}=useTwin();
 const [windowSize,setWindowSize]=useState(30);
 const supply=['TEMP-L03-OPEN-01','TEMP-L03-MEET-01'];
 const active=POINTS.filter(p=>readings[p.code]).length;
 const temps=supply.map(code=>readings[code]?.value).filter((v):v is number=>typeof v==='number');
 const mean=temps.length?temps.reduce((a,b)=>a+b,0)/temps.length:null;
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>ANALYTICS</Eyebrow><h1>Building performance</h1><p>Generated sensor readings · FYP whole building</p></div><div className="segmented">{[15,30,60,90].map(n=><button className={windowSize===n?'active':''} key={n} onClick={()=>setWindowSize(n)}>{n} samples</button>)}</div></div>
 <div className="kpi-grid"><KPI title="Active channels" value={String(active)} unit="/ 18" delta="Simulated sensor data"/><KPI title="Mean room temp" value={mean?.toFixed(2)||'—'} unit="°C" delta="Two monitored rooms"/><KPI title="Virtual power" value={readings['PWR-L03-PWR-POINT-01']?.value?.toFixed(1)||'—'} unit="kW" delta="Illustrative aggregate"/><KPI title="Meeting CO₂" value={readings['CO2-L03-MEET-01']?.value?.toFixed(1)||'—'} unit="ppm" delta="Meeting room"/></div>
 <div className="analytics-row-main"><section className="surface chart-panel energy-chart"><div className="chart-heading"><h3>Room temperatures</h3><span>°C · live history</span></div><TelemetryChart limit={windowSize} codes={supply} title="Room temperature"/></section><section className="surface chart-panel"><div className="chart-heading"><h3>Aggregate power</h3><span>kW · illustrative floor meter</span></div><TelemetryChart limit={windowSize} codes={['PWR-L03-PWR-POINT-01']} title="Aggregate power"/></section></div>
 <div className="analytics-row-second"><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Carbon dioxide</h3><span>ppm</span></div><TelemetryChart limit={windowSize} codes={['CO2-L03-OPEN-01','CO2-L03-MEET-01']} title="Carbon dioxide"/></section><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Relative humidity</h3><span>%RH</span></div><TelemetryChart limit={windowSize} codes={['RH-L03-OPEN-01','RH-L03-MEET-01','RH-L03-WC-01']} title="Relative humidity"/></section></div>
 <section className="surface air-quality"><div className="air-quality-title"><h3>Current building observations</h3><p>Readable sensor values, trends and demonstration reference bands — no arbitrary percentage bars</p></div>
 <div className="analytics-observation-head"><span>Sensor / location</span><span>Current reading</span><span>Change in chart window</span><span>Interpretation</span></div>
 {POINTS.map(p=>{
  const current=readings[p.code],display=sensorDisplay(p,current);
  const previous=history.filter(r=>r.point_code===p.code).slice(-windowSize)[0];
  const change=typeof current?.value==='number'&&typeof previous?.value==='number'&&p.unit!=='binary'?current.value-previous.value:null;
  return <div className="analytics-observation-row" key={p.code}>
   <div><strong>{p.locationLabel} · {p.label}</strong><small>{p.code}</small></div>
   <strong style={{color:display.colour}}>{display.value}</strong>
   <span>{change===null?'—':`${change>0?'+':''}${change.toFixed(2)} ${p.unit}`}</span>
   <span>{display.status}</span>
  </div>;
 })}
 <p className="subtle" style={{padding:'12px 16px'}}>Reference bands describe prototype display expectations and are not certified safety limits. Changes refer to the selected sample window; binary sensors are shown as states.</p>
 </section>
 </div>;
}
function KPI({title,value,unit,delta}:{title:string;value:string;unit:string;delta:string}){return <div className="surface kpi-card"><Eyebrow>{title}</Eyebrow><div className="kpi-value">{Number.isFinite(Number(value))?<ValueMotion value={Number(value)} decimals={value.includes('.')?2:0}/>:value}<small>{unit}</small></div><div className="kpi-delta">{delta}</div></div>}

