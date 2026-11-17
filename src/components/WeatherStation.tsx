import {useEffect,useRef,useState} from 'react';import {CloudSun,Droplets,Sun,CloudRain} from 'lucide-react';
export type SimulationSource={name?:string;dataset?:string;dataset_timestamp?:string;release_interval_seconds?:number;simulation?:{
 operation?:{attendance_factor:number;ac_mode:string;setpoint_c:number;ventilation:number};
 profile_id:string;seed:number;simulation_step_seconds:number;fit_period:string;
 weather:{source:string;mode:string;scene:string;timestamp:string;outdoor_temp_c:number;outdoor_humidity_pct:number;solar_radiation_w_m2:number;rainfall_mm_per_h:number};
 simulated_headcounts?:Record<string,number>;
 calendar:{date:string;day_type:string;holiday_name:string|null;is_workday:boolean;override:string;calendar_complete:boolean;attendance_factor:number}
}|null};
export function useSimulationSource(){
 const [source,setSource]=useState<SimulationSource|null>(null);
 useEffect(()=>{let active=true;const refresh=async()=>{try{const r=await fetch('/api/live-status',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(active)setSource(d.producer)}catch{if(active)setSource(null)}};void refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[]);
 return source;
}
function MiniTrend({values}:{values:number[]}){
 if(values.length<2)return <span className="weather-wave"/>;
 const lo=Math.min(...values),span=Math.max(.01,Math.max(...values)-lo);
 return <svg className="weather-wave" viewBox="0 0 75 23" aria-hidden="true"><polyline points={values.map((v,i)=>`${i/(values.length-1)*75},${21-(v-lo)/span*18}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.3"/></svg>;
}
export function WeatherStation(){
 const source=useSimulationSource(),s=source?.simulation,w=s?.weather,c=s?.calendar;
 const samples=useRef<{stamp:string;rh:number;solar:number;rain:number}[]>([]);
 if(w&&samples.current.at(-1)?.stamp!==w.timestamp)samples.current=[...samples.current,{stamp:w.timestamp,rh:w.outdoor_humidity_pct,solar:w.solar_radiation_w_m2,rain:w.rainfall_mm_per_h}].slice(-40);
 return <section className="surface weather-station weather-strip" aria-label="Virtual weather station">
 <div className="weather-primary"><div className="weather-icon"><CloudSun size={23}/></div><div><span className="eyebrow">WEATHER STATION <small>VIRTUAL</small></span><div className="weather-temperature">{w?w.outdoor_temp_c.toFixed(1):'—'}<small>°C outdoors</small></div><p>{w?w.scene.replace(/^./,x=>x.toUpperCase()):'Waiting for source'}{c?' · '+c.day_type:''}{c?.override!=='auto'&&c?' · override':''}</p></div></div>
 <div className="weather-cell"><span className="eyebrow"><Droplets size={12}/>OUTDOOR RH</span><MiniTrend values={samples.current.map(x=>x.rh)}/><strong>{w?w.outdoor_humidity_pct.toFixed(1):'—'}<small>%RH</small></strong></div>
 <div className="weather-cell"><span className="eyebrow"><Sun size={12}/>SOLAR IRRADIANCE</span><MiniTrend values={samples.current.map(x=>x.solar)}/><strong>{w?w.solar_radiation_w_m2.toFixed(0):'—'}<small>W/m²</small></strong></div>
 <div className="weather-cell"><span className="eyebrow"><CloudRain size={12}/>RAINFALL RATE</span><MiniTrend values={samples.current.map(x=>x.rain)}/><strong>{w?w.rainfall_mm_per_h.toFixed(2):'—'}<small>mm/h</small></strong></div>
 {c?.holiday_name&&<div className="weather-calendar">{c.holiday_name}</div>}
 {c&&!c.calendar_complete&&<p className="weather-calendar" role="status">Public-holiday coverage is incomplete for this year.</p>}
 </section>;
}
