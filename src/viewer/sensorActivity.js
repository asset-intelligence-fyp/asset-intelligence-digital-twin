/** Wall-clock receipt age, never accelerated simulation time or the measurement value. */
export const SENSOR_RECENT_MS=90000;
export function sensorActivity(reading,{now=Date.now(),historical=false}={}){
 if(!reading||!Number.isFinite(reading.value)||reading.quality==='missing')return 'missing';
 if(historical)return 'historical';
 if(reading.source!=='http')return 'stored';
 const received=Date.parse(reading.received_at_utc);
 if(!Number.isFinite(received))return 'stored';
 const age=now-received;
 return age>=0&&age<SENSOR_RECENT_MS?'receiving':'stale';
}
export const ACTIVITY_LABELS={receiving:'Recent synthetic reading; pulse indicates data receipt, not asset health',stale:'Stale reading; no recent data receipt',missing:'No valid reading',stored:'Stored reading; waiting for a new update',historical:'Historical or browser-demo reading; not a current data feed'};
