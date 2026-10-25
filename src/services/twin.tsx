import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Original eight IFC GlobalIds from the existing Digital Twin project. The
// fan-state channel has no IFC marker, and is intentionally not assigned one.
export const POINTS = [
  { code: 'SAT-501A', assetId:'HRU501A', label:'Supply air temperature', unit:'°C', guid:'2kuK4GGyjA5QV8NiAnXeXZ' },
  { code: 'MAT-501A', assetId:'HRU501A', label:'Mixed air temperature', unit:'°C', guid:'3gW6u2ne59c8oABDoS7b3j' },
  { code: 'FS-501A', assetId:'HRU501A', label:'Supply fan status', unit:'ON/OFF', guid:null },
  { code: 'SAT-504', assetId:'HRU504', label:'Supply air temperature', unit:'°C', guid:'3gW6u2ne59c8oABDoS7bB3' },
  { code: 'DP-504', assetId:'HRU504', label:'Damper position', unit:'%', guid:'050uZGzlP8Yg9H1S$ofK0i' },
  { code: 'DPCMD-504', assetId:'HRU504', label:'Damper command', unit:'%', guid:'3iie255UfEvg3mun9qVzgx' },
  { code: 'SAT-507', assetId:'HRU507', label:'Supply air temperature', unit:'°C', guid:'050uZGzlP8Yg9H1S$ofKIe' },
  { code: 'CV-507', assetId:'HRU507', label:'Cooling valve position', unit:'%', guid:'050uZGzlP8Yg9H1S$ofKRW' },
  { code: 'S-L5-008-TEMP', assetId:'HRU507', label:'Room temperature', unit:'°C', guid:'1Rnvr0S6DA0x5eK1Aa66rR' }
] as const;
export type PointCode = typeof POINTS[number]['code'];
export type AssetId = 'HRU501A'|'HRU504'|'HRU507';
export const ASSETS: AssetId[] = ['HRU501A','HRU504','HRU507'];
export interface Reading { point_code:string; value:number; timestamp:string; quality:string; source:'random'|'mqtt'|'stored' }
export interface EventRecord { id:number; title:string; level:'Critical'|'Warning'|'Info'; description:string; source:string; zone:string; time:string; acknowledged:boolean; synthetic:boolean }
interface Bootstrap {data?:{
  Assets?: Array<{asset_id:string;asset_name:string;asset_type:string;status:string;ifc_global_id?:string;manufacturer?:string;model?:string}>;
  Maintenance_Events?: Array<{maintenance_id:number;asset_id:string;event_date:string;event_type:string;maintenance_status:string;description:string}>;
  Sensor_Readings?: Array<{point_code:string;value:number;latest_update:string;quality:string}>;
  Historical_Sensor_Readings?: Array<{point_code:string;value:number;timestamp:string;quality:string}>;
  Anomaly_Results?: Array<{anomaly_id:number;asset_id:string;point_code:string;timestamp:string;description?:string;severity?:string;anomaly_status?:string;anomaly_score?:number}>;
}};
type Mode = 'random'|'mqtt';
type TwinContext = {
 mode:Mode;setMode:(v:Mode)=>void;running:boolean;setRunning:(v:boolean)=>void;intervalMs:number;setIntervalMs:(v:number)=>void;
 readings:Record<string,Reading>;history:Reading[];events:EventRecord[];acknowledge:(id:number)=>Promise<void>;addTestEvent:()=>void;
 assets:NonNullable<NonNullable<Bootstrap['data']>['Assets']>;maintenance:NonNullable<NonNullable<Bootstrap['data']>['Maintenance_Events']>;
 backendConnected:boolean; mqttCoverage:number; resetSimulator:()=>void;
};
const TwinContext=createContext<TwinContext|null>(null);
const nowIso=()=>new Date().toISOString();
const clamp=(x:number,min:number,max:number)=>Math.min(max,Math.max(min,x));
const round=(v:number)=>Math.round(v*100)/100;
export function readingLabel(code:string, reading?:Reading){
 if(!reading)return '—';
 if(code==='FS-501A')return reading.value===1?'ON':'OFF';
 return `${reading.value.toFixed(2)} ${POINTS.find(p=>p.code===code)?.unit||''}`.trim();
}
export function displayTime(date?:string){if(!date)return '—';const d=new Date(date);return Number.isNaN(+d)?date:d.toLocaleString();}
const initial:Record<string,number>={
 'SAT-501A':18.4,'MAT-501A':23.1,'FS-501A':1,'SAT-504':18.7,'DP-504':14,'DPCMD-504':13.5,
 'SAT-507':19.2,'CV-507':55,'S-L5-008-TEMP':23.7
};
function nextValues(previous:Record<string,number>){
 const next={...previous};
 for(const point of POINTS){
  const code=point.code, old=previous[code]??initial[code];
  if(code==='FS-501A')next[code]=Math.random()<.015?1-old:old;
  else if(code==='DPCMD-504')next[code]=round(clamp(old+(Math.random()-.5)*1.5,5,85));
  else if(code==='DP-504')next[code]=round(clamp(old+(next['DPCMD-504']-old)*.3+(Math.random()-.5)*.8,0,100));
  else if(code==='CV-507')next[code]=round(clamp(old+(Math.random()-.5)*4,0,100));
  else {const center=initial[code];next[code]=round(clamp(old+(center-old)*.025+(Math.random()-.5)*.3,12,35));}
 }
 return next;
}
function storeEvents(events:EventRecord[]){try{localStorage.setItem('twinlabs_test_events_v1',JSON.stringify(events.filter(e=>e.synthetic).slice(0,100)))}catch{}}
function restoreEvents():EventRecord[]{try{const x=JSON.parse(localStorage.getItem('twinlabs_test_events_v1')||'[]');return Array.isArray(x)?x:[]}catch{return []}}
function fromDb(data:Bootstrap['data']){
 const readings:Reading[]=(data?.Sensor_Readings||[]).map(r=>({point_code:r.point_code,value:Number(r.value),timestamp:r.latest_update,quality:r.quality||'simulated',source:'stored'}));
 const history:Reading[]=(data?.Historical_Sensor_Readings||[]).slice(-1800).map(r=>({point_code:r.point_code,value:Number(r.value),timestamp:r.timestamp,quality:r.quality||'simulated',source:'stored'}));
 return {readings,history};
}
export function TwinProvider({children}:{children:ReactNode}){
 const [mode,setModeState]=useState<Mode>('random');
 const [running,setRunning]=useState(true);
 const [intervalMs,setIntervalMs]=useState(3000);
 const [readings,setReadings]=useState<Record<string,Reading>>({});
 const [history,setHistory]=useState<Reading[]>([]);
 const [assets,setAssets]=useState<TwinContext['assets']>([]);
 const [maintenance,setMaintenance]=useState<TwinContext['maintenance']>([]);
 const [events,setEvents]=useState<EventRecord[]>(restoreEvents);
 const [backendConnected,setBackendConnected]=useState(false);
 const [mqttCoverage,setMqttCoverage]=useState(0);
 const generator=useRef({...initial});
 const randomEventId=useRef(-1);
 const setMode=useCallback((value:Mode)=>{setModeState(value);setReadings({});setHistory([]);generator.current={...initial};},[]);
 const ingest=useCallback((batch:Reading[])=>{
  const accepted=batch.filter(x=>POINTS.some(p=>p.code===x.point_code)&&Number.isFinite(x.value)&&Boolean(x.timestamp));
  if(!accepted.length)return;
  setReadings(prev=>{const next={...prev};for(const row of accepted)next[row.point_code]=row;return next;});
  setHistory(prev=>[...prev,...accepted].slice(-2500));
 },[]);
 useEffect(()=>{
  let active=true;
  const fetchData=async()=>{
   try{const response=await fetch('/api/bootstrap',{cache:'no-store'});if(!response.ok)throw new Error('API unavailable');
    const payload:Bootstrap=await response.json();if(!active)return;
    const data=payload.data;
    setBackendConnected(true);setAssets(data?.Assets||[]);setMaintenance(data?.Maintenance_Events||[]);
    const dbState=fromDb(data);
    if(mode==='mqtt'){
      ingest(dbState.readings);
      setHistory(dbState.history.slice(-2500));
    }
    const incoming:EventRecord[]=(data?.Anomaly_Results||[]).map(item=>({
      id:item.anomaly_id,title:item.point_code+' · recorded anomaly',level:/critical|high/i.test(item.severity||'')?'Critical':/medium|warning/i.test(item.severity||'')?'Warning':'Info',
      description:item.description||'Recorded anomaly',source:item.asset_id,zone:'Level 5',time:item.timestamp,
      acknowledged:/acknowledged|closed/i.test(item.anomaly_status||''),synthetic:false
    }));
    setEvents(old=>[...incoming,...old.filter(e=>e.synthetic)]);
   }catch{if(active)setBackendConnected(false)}
  };
  void fetchData();return()=>{active=false};
 },[ingest,mode]);
 useEffect(()=>{
  let cancelled=false;
  const check=async()=>{try{const response=await fetch('/api/live-status',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!cancelled)setMqttCoverage(Number(data.received_points)||0)}catch{if(!cancelled)setMqttCoverage(0)}};
  void check();const timer=setInterval(check,5000);return()=>{cancelled=true;clearInterval(timer)};
 },[]);
 useEffect(()=>{
  if(mode!=='mqtt')return;
  const source=new EventSource('/api/events');
  source.addEventListener('sensor-reading',(event)=>{
   try{const data=JSON.parse((event as MessageEvent).data);
    ingest([{point_code:String(data.point_code),value:Number(data.value),timestamp:String(data.timestamp||data.latest_update||nowIso()),quality:String(data.quality||'simulated'),source:'mqtt'}]);
   }catch{/* ignore malformed message, not the stream */}
  });
  return()=>source.close();
 },[mode,ingest]);
 useEffect(()=>{
  if(mode!=='random'||!running)return;
  const step=()=>{
   generator.current=nextValues(generator.current);
   const timestamp=nowIso();
   const points=POINTS.map(point=>({point_code:point.code,value:generator.current[point.code],timestamp,quality:'simulated',source:'random' as const}));
   ingest(points);
  };
  step();const timer=setInterval(step,intervalMs);return()=>clearInterval(timer);
 },[mode,running,intervalMs,ingest]);
 useEffect(()=>{storeEvents(events)},[events]);
 const acknowledge=useCallback(async(id:number)=>{
  const item=events.find(e=>e.id===id);if(!item)return;
  if(!item.synthetic){
   const response=await fetch(`/api/anomalies/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:item.acknowledged?'Review':'Acknowledged'})});
   if(!response.ok)throw new Error(`Unable to update anomaly (${response.status})`);
  }
  setEvents(prev=>prev.map(e=>e.id===id?{...e,acknowledged:!e.acknowledged}:e));
 },[events]);
 const addTestEvent=useCallback(()=>{
  const point=POINTS[Math.floor(Math.random()*POINTS.length)];
  setEvents(prev=>[{id:randomEventId.current--,title:`${point.code} · simulated threshold alert`,level:'Warning',description:`Synthetic test alert for ${point.label}. No fault diagnosis is implied.`,source:point.assetId,zone:'Level 5',time:nowIso(),acknowledged:false,synthetic:true},...prev].slice(0,100));
 },[]);
 const resetSimulator=useCallback(()=>{generator.current={...initial};setReadings({});setHistory([]);setEvents(prev=>prev.filter(e=>!e.synthetic));},[]);
 const value=useMemo(()=>({mode,setMode,running,setRunning,intervalMs,setIntervalMs,readings,history,events,acknowledge,addTestEvent,assets,maintenance,backendConnected,mqttCoverage,resetSimulator}),
  [mode,running,intervalMs,readings,history,events,acknowledge,addTestEvent,assets,maintenance,backendConnected,mqttCoverage,resetSimulator]);
 return <TwinContext.Provider value={value}>{children}</TwinContext.Provider>;
}
export function useTwin(){const context=useContext(TwinContext);if(!context)throw Error('TwinProvider is missing');return context;}
export function historyFor(history:Reading[],codes:string[],limit=80){return history.filter(r=>codes.includes(r.point_code)).slice(-limit);}
