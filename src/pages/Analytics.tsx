import {ValueMotion} from '../components/ValueMotion';
import { useState } from 'react';
import { POINTS, ASSETS, readingLabel, useTwin } from '../services/twin';
import { TelemetryChart } from '../components/TelemetryChart';
import {comfort} from '../services/experienceMath.js';
import {roomTitle} from '../viewer/sensorPresentation.js';
import { Eyebrow } from '../components/UI';
export function Analytics(){
 const {readings,history}=useTwin();
 const [windowSize,setWindowSize]=useState(30);
 const supply=['TEMP-L03-OPEN-01','TEMP-L03-MEET-01'];
 const active=POINTS.filter(p=>readings[p.code]).length;
 const temps=supply.map(code=>readings[code]?.value).filter((v):v is number=>typeof v==='number');
 const mean=temps.length?temps.reduce((a,b)=>a+b,0)/temps.length:null;
 const samples=history.slice(-windowSize*18);
 const latest=(code:string)=>readingLabel(code,readings[code]);
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>ANALYTICS</Eyebrow><h1>Building performance</h1><p>Generated sensor readings · FYP whole building</p></div><div className="segmented">{[15,30,60,90].map(n=><button className={windowSize===n?'active':''} key={n} onClick={()=>setWindowSize(n)}>{n} samples</button>)}</div></div>
 <div className="kpi-grid"><KPI title="Active channels" value={String(active)} unit="/ 18" delta="Simulated sensor data"/><KPI title="Mean room temp" value={mean?.toFixed(2)||'—'} unit="°C" delta="Two monitored rooms"/><KPI title="Virtual power" value={readings['PWR-L03-PWR-POINT-01']?.value?.toFixed(1)||'—'} unit="kW" delta="Illustrative aggregate"/><KPI title="Meeting CO₂" value={readings['CO2-L03-MEET-01']?.value?.toFixed(1)||'—'} unit="ppm" delta="Meeting room"/></div>
 <div className="analytics-row-main"><section className="surface chart-panel energy-chart"><div className="chart-heading"><h3>Room temperatures</h3><span>°C · live history</span></div><TelemetryChart limit={windowSize} codes={supply} title="Room temperature"/></section><section className="surface chart-panel room-comfort"><div className="chart-heading"><h3>Comfort by location</h3><span>Demo bands · available sensors</span></div>{ASSETS.map(asset=>{const score=comfort(POINTS,readings,asset),point=POINTS.find(p=>p.assetId===asset)!;return <div className="comfort-comparison" key={asset}><span>{roomTitle(point)}</span><div><i style={{width:`${score.score??0}%`,background:score.score===null?'#b7c5cb':score.score>=80?'#3f9d88':score.score>=60?'#d7a34b':'#cc6a57'}}/></div><code>{score.score===null?'N/A':score.score+'/100'}</code></div>})}<p className="experience-note">N/A means no configured comfort sensors; occupancy and leakage do not establish comfort.</p></section></div>
 <div className="analytics-row-second"><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Carbon dioxide</h3><span>ppm</span></div><TelemetryChart limit={windowSize} codes={['CO2-L03-OPEN-01','CO2-L03-MEET-01']} title="Carbon dioxide"/></section><section className="surface chart-panel comfort-panel"><div className="chart-heading"><h3>Relative humidity</h3><span>%RH</span></div><TelemetryChart limit={windowSize} codes={['RH-L03-OPEN-01','RH-L03-MEET-01','RH-L03-WC-01']} title="Relative humidity"/></section></div>
 <section className="surface air-quality"><div className="air-quality-title"><h3>Current sensor values</h3><p>{samples.length} recent samples in the rolling chart window</p></div>{POINTS.map(p=><div className="air-row" key={p.code}><span>{p.code}</span><div className="air-progress"><div style={{width:`${p.unit==='%RH'?Math.min(100,readings[p.code]?.value||0):p.unit==='binary'?(readings[p.code]?.value?100:0):Math.min(100,(readings[p.code]?.value||0)*3)}%`}}/></div><code>{latest(p.code)}</code><code>{p.assetId}</code></div>)}</section>
 </div>;
}
function KPI({title,value,unit,delta}:{title:string;value:string;unit:string;delta:string}){return <div className="surface kpi-card"><Eyebrow>{title}</Eyebrow><div className="kpi-value">{Number.isFinite(Number(value))?<ValueMotion value={Number(value)} decimals={value.includes('.')?2:0}/>:value}<small>{unit}</small></div><div className="kpi-delta">{delta}</div></div>}

