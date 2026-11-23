/** Display-only bands for synthetic telemetry. These are not calibrated building alarms. */
export const METRICS={
 status:{label:'Overall condition',unit:'',legend:'Green = within demo limits · yellow = caution · red = threshold concern'},
 temperature:{label:'Temperature',unit:'°C',range:[18,32],band:[22,27],legend:'18–32 °C · demo range'},
 humidity:{label:'Humidity',unit:'%RH',range:[25,85],band:[40,65],legend:'25–85 %RH · demo range'},
 co2:{label:'CO₂',unit:'ppm',range:[400,1600],band:[400,1000],legend:'400–1,600 ppm · demo range'},
 occupancy:{label:'Occupancy',unit:'',legend:'Vacant / Occupied'},
 water_leakage:{label:'Water leakage',unit:'',legend:'Dry / Leak detected'},
 light:{label:'Light',unit:'lux',range:[0,800],legend:'0–800 lux · display range'},
 power:{label:'Virtual power',unit:'kW',range:[0,5],legend:'0–5 kW · illustrative aggregate'},
};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const stops=['#367fc5','#26a69b','#edb547','#d66348'];
export function metricColour(t){
 const x=Math.max(0,Math.min(1,t))*3,i=Math.min(2,Math.floor(x)),f=x-i,a=rgb(stops[i]),b=rgb(stops[i+1]);
 const colour=a.map((v,j)=>v+(b[j]-v)*f);return {rgb:colour,colour:'#'+colour.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')};
}
export function sensorDisplay(point,reading){
 const metric=METRICS[point.sensorType]||{label:point.label};
 if(!reading||!Number.isFinite(reading.value))return {value:'No reading',status:'No reading',colour:'#87979f',rgb:rgb('#87979f'),available:false};
 const value=reading.value;
 if(point.sensorType==='occupancy'){const colour=value>=.5?'#1d9b88':'#6b91b2';return {value:value>=.5?'Occupied':'Vacant',status:value>=.5?'Occupied':'Vacant',colour,rgb:rgb(colour),available:true}}
 if(point.sensorType==='water_leakage'){const colour=value>=.5?'#d65c49':'#289c91';return {value:value>=.5?'Leak detected':'Dry',status:value>=.5?'Leak detected':'Dry',colour,rgb:rgb(colour),available:true}}
 const range=metric.range||[0,100],t=(value-range[0])/(range[1]-range[0]);
 const status=metric.band?(value<metric.band[0]?'Below demo band':value>metric.band[1]?'Above demo band':'Within demo band'):'Reading intensity';
 return {value:`${value.toFixed(point.sensorType==='temperature'||point.sensorType==='power'?1:0)} ${metric.unit||point.unit}`,status,...metricColour(t),available:true};
}
export function roomTitle(point){return point.sensorType==='power'?'Virtual power':point.locationLabel==='Toilet'?'Washroom':point.locationLabel;}
export function sensorTitle(point){return `${roomTitle(point)} · ${METRICS[point.sensorType]?.label||point.label}`;}
export function roomRepresentatives(points,metric,selectedGuid){
 const rooms=[...new Set(points.map(p=>p.assetId))];
 return rooms.map(room=>{
  const members=points.filter(p=>p.assetId===room);
  return members.find(p=>p.guid===selectedGuid)||members.find(p=>p.sensorType===metric)||members[0];
 });
}
