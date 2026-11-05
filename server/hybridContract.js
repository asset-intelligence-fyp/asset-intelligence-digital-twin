const finite=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
export function normalizeSimulation(s){
 if(!s||s.kind!=='hybrid'||!/^[a-f0-9]{16}$/.test(s.profile_id)||!Number.isSafeInteger(s.seed)||!finite(s.simulation_step_seconds,1,900))throw Error('Invalid hybrid model provenance');
 const w=s.weather,c=s.calendar;
 if(!w||w.source!=='virtual_weather_station'||w.synthetic!==true||!['auto','clear','cloudy','rain'].includes(w.mode)||!['clear','cloudy','rain','night'].includes(w.scene)||!Number.isFinite(Date.parse(w.timestamp))||!finite(w.outdoor_temp_c,15,45)||!finite(w.outdoor_humidity_pct,0,100)||!finite(w.solar_radiation_w_m2,0,1400)||!finite(w.rainfall_mm_per_h,0,100))throw Error('Invalid virtual weather station');
 if(!c||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!['workday','weekend','holiday'].includes(c.day_type)||!['auto','workday','holiday'].includes(c.override)||typeof c.is_workday!=='boolean'||typeof c.calendar_complete!=='boolean'||!finite(c.attendance_factor,0,1.5)||(c.holiday_name!=null&&(typeof c.holiday_name!=='string'||c.holiday_name.length>120)))throw Error('Invalid simulation calendar');
 return {kind:'hybrid',synthetic:true,profile_id:s.profile_id,fit_period:'2023-01-01/2024-12-31',seed:s.seed,simulation_step_seconds:s.simulation_step_seconds,weather:{source:'virtual_weather_station',synthetic:true,station_id:'VIRTUAL-OUTDOOR-01',ifc_linked:false,mode:w.mode,scene:w.scene,timestamp:w.timestamp,outdoor_temp_c:w.outdoor_temp_c,outdoor_humidity_pct:w.outdoor_humidity_pct,solar_radiation_w_m2:w.solar_radiation_w_m2,rainfall_mm_per_h:w.rainfall_mm_per_h},calendar:{date:c.date,timezone:'Asia/Kuching',day_type:c.day_type,is_workday:c.is_workday,is_public_holiday:c.is_public_holiday===true,holiday_name:c.holiday_name||null,attendance_factor:c.attendance_factor,override:c.override,calendar_complete:c.calendar_complete,school_holiday:null}};
}
export function registerSimulationControls(app){
 let controls={weather_mode:'auto',calendar_mode:'auto'};
 app.get('/api/simulation/control',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(controls)});
 app.post('/api/simulation/control',(req,res)=>{
  const origin=req.headers.origin;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||origin&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return res.sendStatus(403);
  const b=req.body;
  if(!b||Object.keys(b).some(k=>!['weather_mode','calendar_mode'].includes(k))||b.weather_mode!==undefined&&!['auto','clear','cloudy','rain'].includes(b.weather_mode)||b.calendar_mode!==undefined&&!['auto','workday','holiday'].includes(b.calendar_mode))return res.status(400).json({error:'Unknown weather/calendar control'});
  controls={...controls,...b};res.json({...controls,status:'Applies on next generated hybrid batch; replay ignores controls.'});
 });
}
