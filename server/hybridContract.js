import {randomUUID} from 'node:crypto';
import {registry} from './sensorContract.js';
const finite=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
export function normalizeSimulation(s){
 if(!s||s.kind!=='hybrid'||!/^[a-f0-9]{16}$/.test(s.profile_id)||!Number.isSafeInteger(s.seed)||!finite(s.simulation_step_seconds,1,900))throw Error('Invalid hybrid model provenance');
 const w=s.weather,c=s.calendar;
 if(!w||w.source!=='virtual_weather_station'||w.synthetic!==true||!['auto','clear','cloudy','rain'].includes(w.mode)||!['clear','cloudy','rain','night'].includes(w.scene)||!Number.isFinite(Date.parse(w.timestamp))||!finite(w.outdoor_temp_c,15,45)||!finite(w.outdoor_humidity_pct,0,100)||!finite(w.solar_radiation_w_m2,0,1400)||!finite(w.rainfall_mm_per_h,0,100))throw Error('Invalid virtual weather station');
 if(!c||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!['workday','weekend','holiday'].includes(c.day_type)||!['auto','workday','holiday'].includes(c.override)||typeof c.is_workday!=='boolean'||typeof c.calendar_complete!=='boolean'||!finite(c.attendance_factor,0,1.5)||(c.holiday_name!=null&&(typeof c.holiday_name!=='string'||c.holiday_name.length>120)))throw Error('Invalid simulation calendar');
 const o=s.operation||{};
 return {operation:{attendance_factor:finite(o.attendance_factor,0,1.5)?o.attendance_factor:1,ac_mode:['auto','on','off'].includes(o.ac_mode)?o.ac_mode:'auto',setpoint_c:finite(o.setpoint_c,16,30)?o.setpoint_c:24,ventilation:finite(o.ventilation,.2,2)?o.ventilation:1},kind:'hybrid',synthetic:true,profile_id:s.profile_id,fit_period:'2023-01-01/2024-12-31',seed:s.seed,simulation_step_seconds:s.simulation_step_seconds,weather:{source:'virtual_weather_station',synthetic:true,station_id:'VIRTUAL-OUTDOOR-01',ifc_linked:false,mode:w.mode,scene:w.scene,timestamp:w.timestamp,outdoor_temp_c:w.outdoor_temp_c,outdoor_humidity_pct:w.outdoor_humidity_pct,solar_radiation_w_m2:w.solar_radiation_w_m2,rainfall_mm_per_h:w.rainfall_mm_per_h},calendar:{date:c.date,timezone:'Asia/Kuching',day_type:c.day_type,is_workday:c.is_workday,is_public_holiday:c.is_public_holiday===true,holiday_name:c.holiday_name||null,attendance_factor:c.attendance_factor,override:c.override,calendar_complete:c.calendar_complete,school_holiday:null}};
}
export function registerSimulationControls(app){
 let controls={weather_mode:'auto',calendar_mode:'auto',attendance_factor:1,ac_mode:'auto',setpoint_c:24,ventilation:1,paused:false};
 app.get('/api/simulation/control',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(controls)});
 app.post('/api/simulation/control',(req,res)=>{
  const origin=req.headers.origin;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||origin&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return res.sendStatus(403);
  const b=req.body;
  if(!b||Object.keys(b).some(k=>!['weather_mode','calendar_mode','attendance_factor','ac_mode','setpoint_c','ventilation','step_seconds','paused','fault','reset'].includes(k))||b.weather_mode!==undefined&&!['auto','clear','cloudy','rain'].includes(b.weather_mode)||b.calendar_mode!==undefined&&!['auto','workday','holiday'].includes(b.calendar_mode))return res.status(400).json({error:'Unknown weather/calendar control'});
  if(b.reset!==undefined&&typeof b.reset!=='boolean')return res.status(400).json({error:'Invalid reset flag'});
  if(b.attendance_factor!==undefined&&!finite(b.attendance_factor,0,1.5)||b.ac_mode!==undefined&&!['auto','on','off'].includes(b.ac_mode)||b.setpoint_c!==undefined&&!finite(b.setpoint_c,16,30)||b.ventilation!==undefined&&!finite(b.ventilation,.2,2)||b.step_seconds!==undefined&&![5,60,300].includes(b.step_seconds)||b.paused!==undefined&&typeof b.paused!=='boolean')return res.status(400).json({error:'Operating control outside supported range'});
  let fault=controls.fault;
  if(b.fault!==undefined){
   const f=b.fault,p=registry.find(p=>p.code===f?.sensor_id);
   if(!f||!['none','drift','spike','stuck','missing','leak'].includes(f.kind)||f.kind!=='none'&&(!p||!finite(f.duration_minutes,1,120)||!finite(f.magnitude,-2000,2000)||f.kind==='leak'&&p.sensorType!=='water_leakage'||['spike','drift'].includes(f.kind)&&p.unit==='binary'))return res.status(400).json({error:'Choose a supported fault, sensor, magnitude and duration'});
   fault=f.kind==='none'?null:{id:randomUUID(),kind:f.kind,sensor_id:p.code,duration_minutes:f.duration_minutes,magnitude:f.magnitude};
  }
  if(b.reset){controls={weather_mode:'auto',calendar_mode:'auto',attendance_factor:1,ac_mode:'auto',setpoint_c:24,ventilation:1,paused:false,step_seconds:5,fault:null};return res.json({...controls,status:'Reset requested; existing history retained.'})}
  const {fault:unusedFault,reset:unusedReset,...rest}=b;
  controls={...controls,...rest,...(fault!==undefined?{fault}:{})};res.json({...controls,status:'Applies on next generated hybrid batch; replay ignores controls.'});
 });
}
