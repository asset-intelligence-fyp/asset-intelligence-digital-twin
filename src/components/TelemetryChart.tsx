import {useId,useMemo} from 'react';import {POINTS,useTwin,type Reading} from '../services/twin';import {roomTitle} from '../viewer/sensorPresentation.js';
const palette=['#20d2d9','#9b83ed','#56a8e0','#e4af61'];
export function TelemetryChart({codes,title,height=170,limit=90,windowHours}:{codes:string[];title?:string;height?:number;limit?:number;windowHours?:number}){
 const {history}=useTwin(),uid=useId().replaceAll(':','');
 const series=useMemo(()=>codes.map(code=>{const rows=history.filter(r=>r.point_code===code);const end=Math.max(...rows.map(r=>Date.parse(r.timestamp)));return {code,rows:windowHours?rows.filter(r=>Date.parse(r.timestamp)>=end-windowHours*3600000):rows.slice(-limit)}}),[history,codes.join('|'),limit,windowHours]);
 const values=series.flatMap(s=>s.rows.map(r=>r.value)).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 if(!values.length)return <div className="chart-skeleton" role="status"><i/><i/><i/><span>Collecting sensor history…</span></div>;
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.15,.3),low=min-pad,high=max+pad;
 const stamps=series.flatMap(s=>s.rows.map(r=>Date.parse(r.timestamp))),first=Math.min(...stamps),last=Math.max(...stamps);
 const x=(r:Reading)=>last===first?400:18+(Date.parse(r.timestamp)-first)/(last-first)*764,y=(v:number)=>14+(1-(v-low)/(high-low))*154;
 const point=POINTS.find(p=>p.code===codes[0]),accent=point?.sensorType==='humidity'?'#9b83ed':palette[0];
 const format=(t:number)=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuching',hour:'2-digit',minute:'2-digit'});
 const latest=series[0]?.rows.at(-1)?.value;
 return <div className="twin-chart-wrap"><div className="twin-chart-labels"><span><i style={{background:accent}}/>{title||'Sensor history'}</span>{codes.length===1&&<strong>{latest==null?'Unavailable':latest.toFixed(2)} <small>{point?.unit}</small></strong>}</div>
 <svg viewBox="0 0 800 185" preserveAspectRatio="none" role="img" aria-label={title||codes.join(', ')} style={{height,width:'100%'}}><defs>{series.map((s,i)=><linearGradient id={uid+'-'+i} key={s.code} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={codes.length===1?accent:palette[i%palette.length]} stopOpacity=".30"/><stop offset="100%" stopColor={codes.length===1?accent:palette[i%palette.length]} stopOpacity="0"/></linearGradient>)}</defs>
 {[0,1,2,3].map(i=><line key={i} x1="18" x2="782" y1={16+i*50} y2={16+i*50} stroke="currentColor" className="chart-grid-line" strokeDasharray="3 6"/>)}
 {series.flatMap((s,i)=>{const segments:Reading[][]=[[]];for(const row of s.rows){if(row.value===null){if(segments.at(-1)!.length)segments.push([])}else segments.at(-1)!.push(row)}return segments.filter(rows=>rows.length).map((rows,j)=>{const coords=rows.map(r=>`${x(r)},${y(r.value!)}`),d='M'+coords.join(' L');return <g key={s.code+j}>{codes.length===1&&rows.length>1&&<path d={d+` L${x(rows.at(-1)!)},181 L${x(rows[0])},181 Z`} fill={`url(#${uid}-${i})`}/>}<path d={d} fill="none" stroke={codes.length===1?accent:palette[i%palette.length]} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>{rows.length===1&&<circle cx={x(rows[0])} cy={y(rows[0].value!)} r="2.5" fill={accent}/>}</g>})})}
 </svg><div className="chart-time-axis"><span>{format(first)}</span><small>{min.toFixed(1)} – {max.toFixed(1)} {point?.unit}</small><span>{format(last)}</span></div>{codes.length>1&&<div className="twin-chart-legend">{series.map((s,i)=><span key={s.code}><i style={{background:palette[i%palette.length]}}/>{roomTitle(POINTS.find(p=>p.code===s.code)!)} {s.rows.at(-1)?.value?.toFixed(2)??'Unavailable'}</span>)}</div>}</div>;
}
