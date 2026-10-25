import { useMemo } from 'react';
import { useTwin, type Reading } from '../services/twin';
const palette=['#299da5','#5885b3','#aa8c63','#8070a6'];
export function TelemetryChart({codes,title,height=170}:{codes:string[];title?:string;height?:number}){
 const {history}=useTwin();
 const series=useMemo(()=>codes.map(code=>({code,rows:history.filter(x=>x.point_code===code).slice(-90)})),[history,codes.join('|')]);
 const values=series.flatMap(x=>x.rows.map(r=>r.value));
 if(!values.length)return <div className="empty-state">Waiting for incoming sensor readings…</div>;
 const minimum=Math.min(...values),maximum=Math.max(...values),pad=Math.max((maximum-minimum)*.15,.3);
 const low=minimum-pad,high=maximum+pad;
 const timestamps=Array.from(new Set(series.flatMap(s=>s.rows.map(x=>x.timestamp)))).sort();
 const first=new Date(timestamps[0]).getTime(),last=new Date(timestamps[timestamps.length-1]).getTime();
 const x=(r:Reading,i:number,n:number)=> last===first? (n===1?400:35+i/Math.max(1,n-1)*730):35+((new Date(r.timestamp).getTime()-first)/(last-first))*730;
 const y=(value:number)=>14+(1-(value-low)/(high-low))*144;
 return <div className="twin-chart-wrap"><div className="twin-chart-labels"><span>{title||'Live telemetry'}</span><span>{new Date(timestamps[timestamps.length-1]).toLocaleTimeString()}</span></div><svg viewBox="0 0 800 185" preserveAspectRatio="none" role="img" aria-label={title||codes.join(', ')} style={{height,width:'100%'}}>
  {[0,1,2,3,4].map(j=><g key={j}><line x1="35" y1={14+j*36} x2="765" y2={14+j*36} stroke="#e2e9e6" strokeDasharray="4 4"/><text x="1" y={18+j*36} fontSize="12" fill="#86969c">{(high-j*(high-low)/4).toFixed(1)}</text></g>)}
  {series.map((s,i)=>s.rows.length?<polyline key={s.code} points={s.rows.map((r,j)=>`${x(r,j,s.rows.length)},${y(r.value)}`).join(' ')} fill="none" stroke={palette[i%palette.length]} strokeWidth="2.3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>:null)}
 </svg><div className="twin-chart-legend">{series.map((s,i)=><span key={s.code}><i style={{background:palette[i%palette.length]}}/>{s.code} {s.rows.length?`${s.rows[s.rows.length-1].value.toFixed(2)}`:'—'}</span>)}</div></div>;
}
