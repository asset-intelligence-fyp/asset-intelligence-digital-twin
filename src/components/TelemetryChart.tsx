import { useMemo } from 'react';
import {POINTS} from '../services/twin';
import {roomTitle} from '../viewer/sensorPresentation.js';
import { useTwin, type Reading } from '../services/twin';
const palette=['#299da5','#5885b3','#aa8c63','#8070a6'];
export function TelemetryChart({codes,title,height=170,limit=90}:{codes:string[];title?:string;height?:number;limit?:number}){
 const {history,readings,scenario,events,horizon}=useTwin();
 const series=useMemo(()=>codes.map(code=>({code,rows:history.filter(x=>x.point_code===code).slice(-limit)})),[history,codes.join('|'),limit]);
 const type=POINTS.find(p=>p.code===codes[0])?.sensorType;const threshold=type==='co2'?1000:type==='temperature'?27:type==='humidity'?65:null;
 const values=series.flatMap(x=>x.rows.map(r=>r.value)).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 if(!values.length)return <div className="chart-skeleton" role="status"><i/><i/><i/><span>Collecting sensor history…</span></div>;
 const extra=scenario?codes.map(code=>readings[code]?.value).filter((v):v is number=>Number.isFinite(v)):[];
 const minimum=Math.min(...values,...extra,...(threshold!==null?[threshold]:[])),maximum=Math.max(...values,...extra,...(threshold!==null?[threshold]:[])),pad=Math.max((maximum-minimum)*.15,.3);
 const low=minimum-pad,high=maximum+pad;
 const timestamps=Array.from(new Set(series.flatMap(s=>s.rows.map(x=>x.timestamp)))).sort();
 const first=new Date(timestamps[0]).getTime(),last=new Date(timestamps[timestamps.length-1]).getTime();
 const x=(r:Reading,i:number,n:number)=> last===first? (n===1?400:35+i/Math.max(1,n-1)*730):35+((new Date(r.timestamp).getTime()-first)/(last-first))*(scenario?570:730);
 const y=(value:number|null)=>14+(1-((value??low)-low)/(high-low))*144;
 return <div className="twin-chart-wrap"><div className="twin-chart-labels"><span>{title||'Live telemetry'}</span><span>{new Date(timestamps[timestamps.length-1]).toLocaleTimeString()}</span></div><svg viewBox="0 0 800 185" preserveAspectRatio="none" role="img" aria-label={title||codes.join(', ')} style={{height,width:'100%'}}>
  {[0,1,2,3,4].map(j=><g key={j}><line x1="35" y1={14+j*36} x2="765" y2={14+j*36} stroke="#e2e9e6" strokeDasharray="4 4"/><text x="1" y={18+j*36} fontSize="12" fill="#86969c">{(high-j*(high-low)/4).toFixed(1)}</text></g>)}
  {series.flatMap((s,i)=>{
   const segments:Reading[][]=[[]];for(const row of s.rows){if(row.value===null){if(segments.at(-1)!.length)segments.push([])}else segments.at(-1)!.push(row)}
   return segments.filter(rows=>rows.length).map((rows,k)=><polyline key={s.code+':'+k} points={rows.map((r,j)=>`${x(r,j,s.rows.length)},${y(r.value)}`).join(' ')} fill="none" stroke={palette[i%palette.length]} className="chart-path" pathLength="1" strokeWidth="2.3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>);
  })}
  {threshold!==null&&<g><line x1="35" x2="765" y1={y(threshold)} y2={y(threshold)} stroke="#c3903c" strokeDasharray="5 5"/><text x="40" y={y(threshold)-4} fontSize="10" fill="#a57d39">{threshold} · demo guide</text></g>}
  {scenario&&series.map((s,i)=>{const last=s.rows.at(-1),target=readings[s.code];return last?.value!=null&&target?.value!=null?<line key={'projection'+s.code} x1={x(last,s.rows.length-1,s.rows.length)} x2="765" y1={y(last.value)} y2={y(target.value)} stroke={palette[i%palette.length]} strokeWidth="2" strokeDasharray="7 5"/>:null})}
  {events.filter(e=>Date.parse(e.time)>=first&&Date.parse(e.time)<=last).map(e=><circle key={e.id} cx={35+(Date.parse(e.time)-first)/Math.max(1,last-first)*(scenario?570:730)} cy="174" r="4" fill="#ca9560"><title>{e.title}</title></circle>)}
 </svg>{scenario&&<p className="experience-note">Dashed: +{horizon} h what-if illustration · no validated AI forecast or uncertainty interval.</p>}<div className="twin-chart-legend">{series.map((s,i)=><span key={s.code}><i style={{background:palette[i%palette.length]}}/>{POINTS.find(p=>p.code===s.code)?roomTitle(POINTS.find(p=>p.code===s.code)!):s.code} {s.rows.length?`${s.rows[s.rows.length-1].value?.toFixed(2)??'Unavailable'}`:'—'}</span>)}</div></div>;
}

