/**
 * Pure helpers for the simulation controls and derived display mode.
 * Command acceptance is not evidence that a new telemetry batch has arrived.
 */
export const QUICK_SCENARIOS=['normal','rain','holiday','busy'];
export const scenarioLabel={normal:'Normal day',rain:'Rainy day',holiday:'Public holiday',busy:'Busy building'};
export function presetPatch(kind,current={}){
 switch(kind){
  case 'normal':return {weather_mode:'auto',calendar_mode:'auto',attendance_factor:1,ac_mode:'auto',setpoint_c:24,ventilation:1,step_seconds:current.step_seconds??5,paused:false,fault:{kind:'none'}};
  case 'rain':return {weather_mode:'rain',paused:false,fault:{kind:'none'}};
  case 'holiday':return {calendar_mode:'holiday',paused:false,fault:{kind:'none'}};
  case 'busy':return {calendar_mode:'workday',attendance_factor:1.5,paused:false,fault:{kind:'none'}};
  default:throw Error('Unsupported quick scenario');
 }
}
export function scenarioActive(kind,c){
 if(!c)return false;
 if(kind==='rain')return c.weather_mode==='rain';
 if(kind==='holiday')return c.calendar_mode==='holiday';
 if(kind==='busy')return c.calendar_mode==='workday'&&c.attendance_factor===1.5;
 if(kind==='normal')return c.weather_mode==='auto'&&c.calendar_mode==='auto'&&c.attendance_factor===1&&c.ac_mode==='auto';
 return false;
}
export function observedScenario(kind,source){
 const s=source?.simulation;if(!s)return false;
 const w=s.weather,o=s.operation,c=s.calendar;
 if(kind==='rain')return w?.mode==='rain'&&Number(w.rainfall_mm_per_h)>=.2;
 if(kind==='holiday')return c?.override==='holiday'&&!c?.is_workday;
 if(kind==='busy')return c?.override==='workday'&&o?.attendance_factor===1.5;
 if(kind==='normal')return w?.mode==='auto'&&c?.override==='auto'&&o?.attendance_factor===1;
 return false;
}
export function effectiveWeatherScene(w){
 if(!w)return 'clear';
 // Rain is still rain after sunset. Keep the synthetic scene "night"
 // for daylight description, but render/show precipitation separately.
 if(Number(w.rainfall_mm_per_h)>=.2)return 'rain';
 return ['clear','cloudy','rain','night'].includes(w.scene)?w.scene:'clear';
}
export function weatherSceneLabel(w){
 if(!w)return 'Waiting for source';
 if(Number(w.rainfall_mm_per_h)>=.2)return w.scene==='night'?'Rainy night':'Rainy';
 return w.scene?String(w.scene).replace(/^./,s=>s.toUpperCase()):'Unknown weather';
}
