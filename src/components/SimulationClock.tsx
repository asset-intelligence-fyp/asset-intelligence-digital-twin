import {useState} from 'react';
import {useSimulationSource} from './WeatherStation';

const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuching',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
/** Changes the synthetic observation clock by requesting a new isolated simulator run. */
export function SimulationClock({onApplied}:{onApplied?:(calendar:'auto'|'workday'|'holiday')=>void}){
 const source=useSimulationSource();
 const [date,setDate]=useState(today);
 const [time,setTime]=useState('09:00');
 const [calendar,setCalendar]=useState<'auto'|'workday'|'holiday'>('workday');
 const [working,setWorking]=useState(false);
 const [message,setMessage]=useState('');
 const start=async()=>{
  setWorking(true);setMessage('');
  try{
   const start_clock=`${date}T${time}:00+08:00`;
   const r=await fetch('/api/simulation/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start_clock,calendar_mode:calendar})});
   const body=await r.json();
   if(!r.ok)throw new Error(body.error||'Unable to set the simulation clock');
   onApplied?.(calendar);
   setMessage('New simulation requested. The next generated batch will start at '+date+' '+time+' MYT.');
  }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  finally{setWorking(false)}
 };
 return <section className="surface simulation-clock" aria-label="Simulation clock">
  <div><span className="eyebrow">SIMULATION CLOCK</span><h2>Choose when the building operates</h2><p>Start a fresh synthetic run at a specific Malaysia date and hour. Use a weekday morning to demonstrate occupancy instead of midnight.</p></div>
  <div className="simulation-clock-fields">
   <label>Date <input type="date" value={date} min="2023-01-01" max="2030-12-31" onChange={e=>setDate(e.target.value)}/></label>
   <label>Time (MYT) <input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>
   <label>Day schedule <select value={calendar} onChange={e=>setCalendar(e.target.value as typeof calendar)}><option value="auto">Follow actual date</option><option value="workday">Force working day</option><option value="holiday">Force holiday / closed</option></select></label>
   <button className="dark-button" disabled={working||!date||!time} onClick={()=>void start()}>{working?'Setting…':'Start new run'}</button>
  </div>
  <p className="subtle">Current synthetic clock: <strong>{source?.dataset_timestamp||'Waiting for generator'}</strong>. Starting a new run separates the new readings from the previous session; it does not change real system time.</p>
  {message&&<p className="control-feedback" role="status">{message}</p>}
 </section>;
}
