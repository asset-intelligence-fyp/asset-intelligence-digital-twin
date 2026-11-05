import {useEffect,useState} from 'react';
export type SimulationSource={name?:string;dataset?:string;dataset_timestamp?:string;release_interval_seconds?:number;simulation?:{
 profile_id:string;seed:number;simulation_step_seconds:number;fit_period:string;
 weather:{source:string;mode:string;scene:string;timestamp:string;outdoor_temp_c:number;outdoor_humidity_pct:number;solar_radiation_w_m2:number;rainfall_mm_per_h:number};
 calendar:{date:string;day_type:string;holiday_name:string|null;is_workday:boolean;override:string;calendar_complete:boolean;attendance_factor:number}
}|null};
export function useSimulationSource(){
 const [source,setSource]=useState<SimulationSource|null>(null);
 useEffect(()=>{let active=true;const refresh=async()=>{try{const r=await fetch('/api/live-status',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(active)setSource(d.producer)}catch{if(active)setSource(null)}};void refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[]);
 return source;
}
export function WeatherStation({controls=false}:{controls?:boolean}){
 const source=useSimulationSource(),s=source?.simulation,w=s?.weather,c=s?.calendar;
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [requested,setRequested]=useState<{weather_mode?:string;calendar_mode?:string}>({});
 const change=async(key:'weather_mode'|'calendar_mode',value:string)=>{
  setBusy(true);try{const r=await fetch('/api/simulation/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[key]:value})});if(!r.ok)throw Error('Unable to change simulation');setRequested(old=>({...old,[key]:value}));setMessage('Requested. Applies to the next generated batch.')}catch(e){setMessage(String(e))}finally{setBusy(false)}
 };
 return <section className="surface weather-station" aria-label="Virtual weather station"><div className="chart-heading"><h3>Virtual weather station</h3><span>Simulated · no weather website or physical hardware</span></div>
 {!w||!c?<p>Waiting for the hybrid generator. Dataset replay does not create virtual weather sensors.</p>:<>
 <div className="weather-station-values"><div><small>Outdoor temperature</small><strong>{w.outdoor_temp_c.toFixed(1)} °C</strong></div><div><small>Outdoor humidity</small><strong>{w.outdoor_humidity_pct.toFixed(1)} %RH</strong></div><div><small>Solar irradiance</small><strong>{w.solar_radiation_w_m2.toFixed(1)} W/m²</strong></div><div><small>Rainfall rate</small><strong>{w.rainfall_mm_per_h.toFixed(2)} mm/h</strong></div></div>
 <p><strong>{c.date} · {c.day_type}</strong>{c.holiday_name?' · '+c.holiday_name:''} · Malaysia time{c.override!=='auto'?' · demonstration override':''}. {c.is_workday?'Working-day attendance pattern.':'Scheduled office attendance and AC are off; environmental readings continue.'}</p>
 {!c.calendar_complete&&<p role="status">This year’s public-holiday calendar is not covered. Only weekends and any custom dates are known; add a reviewed calendar before using this year.</p>}
 {controls&&<><div className="weather-station-controls"><label>Weather input<select aria-label="Simulator weather input" value={requested.weather_mode??w.mode} disabled={busy} onChange={e=>void change('weather_mode',e.target.value)}><option value="auto">Automatic generated weather</option><option value="clear">Clear scenario</option><option value="cloudy">Cloudy scenario</option><option value="rain">Rain scenario</option></select></label><label>Attendance calendar<select aria-label="Simulator attendance calendar" value={requested.calendar_mode??c.override} disabled={busy} onChange={e=>void change('calendar_mode',e.target.value)}><option value="auto">Actual date and Sarawak holidays</option><option value="workday">Working-day demonstration</option><option value="holiday">Holiday demonstration</option></select></label></div><p role="status">{message}</p><p>Weather interventions affect the generated indoor readings gradually. Rain does not automatically create a leak. Manual calendar settings override the date for demonstration only.</p></>}
 </>}
 </section>;
}
