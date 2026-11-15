import {sensorDisplay} from '../viewer/sensorPresentation.js';
export const DEFAULT_SCENARIO={people:12,setpoint:24,ventilation:1,outdoor:30};
export const PRESETS={heatwave:{people:12,setpoint:24,ventilation:1,outdoor:38},meeting:{people:36,setpoint:24,ventilation:.7,outdoor:30},failure:{people:12,setpoint:30,ventilation:.35,outdoor:32}};
export function demoHistory(points,end){
 const rows=[];
 for(let i=0;i<=96;i++){
  const time=end-(96-i)*900000,hour=((time/3600000+8)%24+24)%24,work=hour>=8&&hour<18,meeting=Math.exp(-(((hour-14.5)/1.15)**2)),day=Math.sin((hour-8)/24*Math.PI*2);
  for(const p of points){const meet=p.assetId.includes('MEET'),office=p.assetId.includes('OPEN'),wave=Math.sin(Math.floor(time/900000)*.73+p.code.length)*.12;
   const values={temperature:23.3+(meet?meeting*4.2:office?1.4*day:0)+wave,humidity:52+7*day+(meet?meeting*8:0)+wave,co2:work?490+(meet?meeting*850:office?180+130*day:60):430,
    occupancy:work&&(meet?meeting>.25:true)?1:0,water_leakage:0,light:work?office?480:meet?380:160:12,power:work?2.1+.8*day+meeting*.9:.65};
   rows.push({point_code:p.code,value:Math.max(0,Number(values[p.sensorType]?.toFixed(2)||0)),timestamp:new Date(time).toISOString(),quality:'guided_demo',source:'random'});
  }
 }
 return rows;
}
export function readingsAt(history,time){const latest={};for(const row of history){const t=Date.parse(row.timestamp);if(t<=time&&(!latest[row.point_code]||t>=Date.parse(latest[row.point_code].timestamp)))latest[row.point_code]=row}return latest;}
export function scenarioReadings(base,points,room,config,hours){
 const factor=1-Math.exp(-Math.max(.25,hours)/1.4),out={...base};
 for(const p of points){const row=base[p.code];if(!row||(p.assetId!==room&&p.sensorType!=='power'))continue;let delta=0;
  if(p.sensorType==='temperature')delta=(config.setpoint-24)*.7+(config.outdoor-30)*.18+(config.people-12)*.025;
  if(p.sensorType==='co2')delta=(config.people-12)*20+(1/config.ventilation-1)*220;
  if(p.sensorType==='humidity')delta=(config.outdoor-30)*.6+(config.people-12)*.15;
  if(p.sensorType==='power')delta=(config.outdoor-30)*.06+(config.people-12)*.025-(config.setpoint-24)*.09;
  out[p.code]={...row,value:Math.max(0,row.value+delta*factor),quality:'illustrative_what_if'};
 }
 return out;
}
export function comfort(points,readings,room){
 const channels=points.filter(p=>p.assetId===room&&['temperature','humidity','co2'].includes(p.sensorType));
 const values=channels.filter(p=>Number.isFinite(readings[p.code]?.value));if(!values.length)return {score:null,coverage:0,total:channels.length,reason:'No comfort sensors configured'};
 const penalty=values.reduce((sum,p)=>{const value=readings[p.code].value;return sum+(p.sensorType==='temperature'?Math.max(0,Math.abs(value-24.5)-2.5)*14:p.sensorType==='humidity'?Math.max(0,Math.abs(value-52.5)-12.5)*2:Math.max(0,value-900)/12)},0);
 return {score:Math.round(Math.max(0,100-penalty/values.length)),coverage:values.length,total:channels.length,reason:'Demo temperature / humidity / CO₂ bands'};
}
export function roomEvidence(points,readings,room){return points.filter(p=>p.assetId===room).map(p=>({point:p,reading:readings[p.code],display:sensorDisplay(p,readings[p.code])}));}
