import {useState} from 'react';
import {POINTS} from '../services/twin';
type Scenario='rain'|'busy'|'holiday'|'ac_off'|'ventilation';
type Sample={minute:number;time:string;value:number|null;weather:{outdoor_humidity_pct:number;rainfall_mm_per_h:number;outdoor_temp_c:number;solar_radiation_w_m2:number};headcounts:Record<string,number>};
type Result={scenario:Scenario;start_time:string;sensor_id:string;baseline_label:string;intervention_label:string;seed:number;duration_minutes:number;synthetic:boolean;baseline:Sample[];intervention:Sample[]};
const scenarios:[Scenario,string,string][]=[
 ['rain','Clear vs rain','Does simulated weather affect indoor readings?'],
 ['busy','Typical vs busy','What changes when more people attend?'],
 ['holiday','Workday vs holiday','How do closed-day schedules affect sensors?'],
 ['ac_off','AC on vs off','Does simulated AC change room temperature?'],
 ['ventilation','Normal vs increased ventilation','How does ventilation affect CO₂?']
];
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuching',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const mean=(rows:Sample[])=>{const v=rows.map(x=>x.value).filter((x):x is number=>typeof x==='number');return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
export function ScenarioExperiment(){
 const [scenario,setScenario]=useState<Scenario>('rain');
 const [code,setCode]=useState('RH-L03-OPEN-01');
 const [date,setDate]=useState(today);
 const [hour,setHour]=useState('09:00');
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const metric=POINTS.find(p=>p.code===code);
 const run=async()=>{
  setBusy(true);setError('');setResult(null);
  try{
   const response=await fetch('/api/simulation/experiment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario,point_code:code,start_time:`${date}T${hour}:00+08:00`})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Comparison failed');
   setResult(data as Result);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 const all=result?[...result.baseline,...result.intervention].map(x=>x.value).filter((v):v is number=>v!==null&&Number.isFinite(v)):[];
 const lo=all.length?Math.min(...all):0,hi=all.length?Math.max(...all):1,pad=Math.max((hi-lo)*.22,.2);
 const ymin=lo-pad,ymax=hi+pad;
 const poly=(samples:Sample[])=>samples.filter(s=>s.value!==null).map(s=>`${45+s.minute/60*695},${212-(s.value!-ymin)/(ymax-ymin)*178}`).join(' ');
 const avgA=result?mean(result.baseline):null,avgB=result?mean(result.intervention):null;
 const diff=avgA!==null&&avgB!==null?avgB-avgA:null;
 return <section className="surface experiment-workspace" aria-label="Scenario experiment workspace">
  <div className="panel-heading"><div><span className="eyebrow">SCENARIO EXPERIMENT WORKSPACE</span><h2>Prove what changes</h2><p>Run two isolated, paired one-hour simulations with the same seed, clock and calibration profile. Only the selected intervention differs.</p></div></div>
  <div className="experiment-setup">
   <label>Experiment <select value={scenario} onChange={e=>{setScenario(e.target.value as Scenario);setResult(null);const next={rain:'RH-L03-OPEN-01',busy:'CO2-L03-OPEN-01',holiday:'PWR-L03-PWR-POINT-01',ac_off:'TEMP-L03-OPEN-01',ventilation:'CO2-L03-MEET-01'};setCode(next[e.target.value as Scenario])}}>{scenarios.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label>Sensor to compare <select value={code} onChange={e=>{setCode(e.target.value);setResult(null)}}>{POINTS.map(p=><option key={p.code} value={p.code}>{p.locationLabel} · {p.label}</option>)}</select></label>
   <label>Reference date <input type="date" value={date} min="2023-01-01" max="2030-12-31" onChange={e=>setDate(e.target.value)}/></label>
   <label>Start time (MYT) <input type="time" value={hour} onChange={e=>setHour(e.target.value)}/></label>
  </div>
  <p className="subtle">{scenarios.find(x=>x[0]===scenario)?.[2]} For comparisons, workday overrides are used where indicated by the experiment configuration.</p>
  <button className="dark-button" disabled={busy||!date||!hour} onClick={()=>void run()}>{busy?'Comparing scenarios…':'Run A/B comparison'}</button>
  {error&&<p role="alert" className="control-feedback">{error}</p>}
  {result&&<div className="experiment-results">
   <div className="experiment-result-cards">
    <div className="experiment-result-card"><span>BASELINE · {result.baseline_label}</span><strong>{avgA===null?'—':avgA.toFixed(2)} <small>{metric?.unit}</small></strong><small>One-hour mean</small></div>
    <div className="experiment-result-card"><span>INTERVENTION · {result.intervention_label}</span><strong>{avgB===null?'—':avgB.toFixed(2)} <small>{metric?.unit}</small></strong><small>One-hour mean</small></div>
    <div className="experiment-result-card"><span>DIFFERENCE · B − A</span><strong>{diff===null?'—':(diff>0?'+':'')+diff.toFixed(2)} <small>{metric?.unit}</small></strong><small>Paired synthetic result</small></div>
   </div>
   <div className="experiment-chart" role="img" aria-label="Simulated sensor values at 5-minute intervals, baseline versus intervention">
    <div className="experiment-legend"><strong>{metric?.locationLabel} · {metric?.label}</strong><span><i className="experiment-key-baseline"/> {result.baseline_label}</span><span><i className="experiment-key-intervention"/> {result.intervention_label}</span></div>
    <svg viewBox="0 0 770 248" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
     {[0,1,2,3,4].map(i=><g key={i}><line x1="45" y1={34+i*44.5} x2="740" y2={34+i*44.5} stroke="currentColor" opacity=".13"/><text x="40" y={38+i*44.5} textAnchor="end" fontSize="10" fill="currentColor" opacity=".6">{(ymax-i*(ymax-ymin)/4).toFixed(1)}</text></g>)}
     <polyline fill="none" stroke="#21c7cf" strokeWidth="3" points={poly(result.baseline)}/>
     <polyline fill="none" stroke="#ffbb60" strokeWidth="3" points={poly(result.intervention)}/>
     {[0,15,30,45,60].map(m=><text key={m} x={45+m/60*695} y="241" fontSize="11" fill="currentColor" opacity=".75" textAnchor="middle">{m} min</text>)}
    </svg>
   </div>
   <p className="subtle">Comparison uses simulated values, not physical measurements. Shared random seed {result.seed}, 5-minute steps, identical initial time. Stochastic dynamics can differ between scenarios; the difference is not a calibrated causal estimate. Experiment data do not enter live telemetry, alerts or stored history.</p>
  </div>}
 </section>;
}
