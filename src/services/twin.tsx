import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {demoHistory,readingsAt,scenarioReadings,DEFAULT_SCENARIO} from './experienceMath.js';
import sensorRegistry from '../../shared/sensorRegistry.json';
export const POINTS = sensorRegistry;
export type PointCode = string;
export type AssetId = string;
export const ASSETS: AssetId[] = [...new Set(POINTS.map(p=>p.assetId))];
export interface Reading { point_code:string; value:number; timestamp:string; quality:string; source:'random'|'http'|'stored'; trace?:{trace_id:string;batch_size:number} }
export interface EventRecord { id:number; title:string; level:'Critical'|'Warning'|'Info'; description:string; source:string; zone:string; time:string; acknowledged:boolean; synthetic:boolean }
interface Bootstrap {storage?:string;data?:{
  Assets?: Array<{asset_id:string;asset_name:string;asset_type:string;status:string;ifc_global_id?:string;manufacturer?:string;model?:string}>;
  Maintenance_Events?: Array<{maintenance_id:number;asset_id:string;event_date:string;event_type:string;maintenance_status:string;description:string}>;
  Sensor_Readings?: Array<{point_code:string;value:number;latest_update:string;quality:string}>;
  Historical_Sensor_Readings?: Array<{point_code:string;value:number;timestamp:string;quality:string}>;
  Anomaly_Results?: Array<{anomaly_id:number;asset_id:string;point_code:string;timestamp:string;description?:string;severity?:string;anomaly_status?:string;anomaly_score?:number}>;
}};
export type Weather = 'clear'|'cloudy'|'rain'|'night';
type Mode = 'random'|'mqtt';
type TwinContext = {
 weather:Weather;setWeather:(v:Weather)=>void;weatherMotion:boolean;setWeatherMotion:(v:boolean)=>void;
 mode:Mode;setMode:(v:Mode)=>void;running:boolean;setRunning:(v:boolean)=>void;intervalMs:number;setIntervalMs:(v:number)=>void;
 readings:Record<string,Reading>;history:Reading[];events:EventRecord[];acknowledge:(id:number)=>Promise<void>;addTestEvent:()=>void;
 assets:NonNullable<NonNullable<Bootstrap['data']>['Assets']>;maintenance:NonNullable<NonNullable<Bootstrap['data']>['Maintenance_Events']>;
 liveHistory:Reading[];liveReadings:Record<string,Reading>;replayTime:number|null;setReplayTime:(time:number|null)=>void;demo:boolean;setDemo:(value:boolean)=>void;scenario:boolean;setScenario:(value:boolean)=>void;scenarioConfig:typeof DEFAULT_SCENARIO;setScenarioConfig:(value:typeof DEFAULT_SCENARIO)=>void;horizon:number;setHorizon:(value:number)=>void;selectedRoom:string;setSelectedRoom:(value:string)=>void;assistantOpen:boolean;setAssistantOpen:(value:boolean)=>void;
 backendConnected:boolean; storage:string; mqttCoverage:number; resetSimulator:()=>void;
};
const TwinContext=createContext<TwinContext|null>(null);
const nowIso=()=>new Date().toISOString();
const round=(v:number)=>Math.round(v*100)/100;
export function readingLabel(code:string, reading?:Reading){
 if(!reading)return '—';
 const point=POINTS.find(p=>p.code===code);
 if(point?.sensorType==='occupancy')return reading.value===1?'Occupied':'Vacant';
 if(point?.sensorType==='water_leakage')return reading.value===1?'Leak detected':'Dry';
 return `${reading.value.toFixed(2)} ${POINTS.find(p=>p.code===code)?.unit||''}`.trim();
}
export function displayTime(date?:string){if(!date)return '—';const d=new Date(date);return Number.isNaN(+d)?date:d.toLocaleString();}
const centers:Record<string,number>={temperature:24,humidity:55,co2:650,occupancy:0,light:350,power:2.1,water_leakage:0};
const initial:Record<string,number>=Object.fromEntries(POINTS.map(p=>[p.code,centers[p.sensorType]??0]));
function nextValues(previous:Record<string,number>){
 return Object.fromEntries(POINTS.map(p=>{
  const old=previous[p.code]??initial[p.code],center=initial[p.code];
  const value=p.unit==='binary'?(p.sensorType==='water_leakage'?0:(Math.random()<.04?1-old:old)):round(Math.max(0,old+(center-old)*.08+(Math.random()-.5)*(p.sensorType==='co2'?30:p.sensorType==='light'?25:p.sensorType==='power'?.15:.5)));
  return [p.code,value];
 }));
}
function storeEvents(events:EventRecord[]){try{localStorage.setItem('twinlabs_test_events_v1',JSON.stringify(events.filter(e=>e.synthetic).slice(0,100)))}catch{}}
function restoreEvents():EventRecord[]{try{const x=JSON.parse(localStorage.getItem('twinlabs_test_events_v1')||'[]');return Array.isArray(x)?x:[]}catch{return []}}
function fromDb(data:Bootstrap['data']){
 const readings:Reading[]=(data?.Sensor_Readings||[]).map(r=>({point_code:r.point_code,value:Number(r.value),timestamp:r.latest_update,quality:r.quality||'simulated',source:'stored'}));
 const history:Reading[]=(data?.Historical_Sensor_Readings||[]).slice(-18000).map(r=>({point_code:r.point_code,value:Number(r.value),timestamp:r.timestamp,quality:r.quality||'simulated',source:'stored'}));
 return {readings,history};
}
export function TwinProvider({children}:{children:ReactNode}){
 const [demo,setDemo]=useState(false),[demoStep,setDemoStep]=useState(0),[replayTime,setReplayTime]=useState<number|null>(null),[scenario,setScenario]=useState(false),[scenarioConfig,setScenarioConfig]=useState(DEFAULT_SCENARIO),[horizon,setHorizon]=useState(1),[selectedRoom,setSelectedRoom]=useState('L02-OPEN'),[assistantOpen,setAssistantOpen]=useState(false);
 const demoOrigin=useRef(Math.floor(Date.now()/900000)*900000);
 const [weather,setWeather]=useState<Weather>('clear');
 const [weatherMotion,setWeatherMotion]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [mode,setModeState]=useState<Mode>('mqtt');
 const [running,setRunning]=useState(true);
 useEffect(()=>{if(!demo||!running)return;const timer=setInterval(()=>setDemoStep(s=>s+1),3000);return()=>clearInterval(timer)},[demo,running]);
 const [intervalMs,setIntervalMs]=useState(3000);
 const [readings,setReadings]=useState<Record<string,Reading>>({});
 const [history,setHistory]=useState<Reading[]>([]);
 const [assets,setAssets]=useState<TwinContext['assets']>([]);
 const [maintenance,setMaintenance]=useState<TwinContext['maintenance']>([]);
 const [demoAcknowledged,setDemoAcknowledged]=useState<number[]>([]);
 const [events,setEvents]=useState<EventRecord[]>(restoreEvents);
 const [backendConnected,setBackendConnected]=useState(false);
 const [storage,setStorage]=useState('unknown');
 const [mqttCoverage,setMqttCoverage]=useState(0);
 const generator=useRef({...initial});
 const pendingTraces=useRef(new Map<string,{codes:Set<string>;size:number}>());
 const browserId=useRef(crypto.randomUUID());
 useEffect(()=>{
  if(mode!=='mqtt'||document.visibilityState!=='visible')return;
  const ready=[...pendingTraces.current].filter(([id,v])=>v.codes.size===v.size&&[...v.codes].every(code=>readings[code]?.trace?.trace_id===id)).map(([id])=>id);
  if(!ready.length)return;
  let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   if(document.visibilityState!=='visible')return;
   for(const id of ready){pendingTraces.current.delete(id);void fetch('/api/benchmarks/rendered',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trace_id:id,client_id:browserId.current})}).catch(()=>{});}
  });});
  return()=>{cancelAnimationFrame(first);if(second)cancelAnimationFrame(second)};
 },[readings,mode]);
 const randomEventId=useRef(-1);
 const setMode=useCallback((value:Mode)=>{setModeState(value);setDemo(false);setReplayTime(null);setReadings({});setHistory([]);generator.current={...initial};},[]);
 const ingest=useCallback((batch:Reading[])=>{
  const accepted=batch.filter(x=>POINTS.some(p=>p.code===x.point_code)&&Number.isFinite(x.value)&&Boolean(x.timestamp));
  if(!accepted.length)return;
  setReadings(prev=>{const next={...prev};for(const row of accepted)next[row.point_code]=row;return next;});
  setHistory(prev=>[...prev,...accepted].slice(-30000));
 },[]);
 useEffect(()=>{
  let active=true;
  const fetchData=async()=>{
   try{const response=await fetch('/api/bootstrap',{cache:'no-store'});if(!response.ok)throw new Error('API unavailable');
    const payload:Bootstrap=await response.json();if(!active)return;
    const data=payload.data;
    setBackendConnected(true);setStorage(payload.storage||'unknown');setAssets(data?.Assets||[]);setMaintenance(data?.Maintenance_Events||[]);
    const dbState=fromDb(data);
    if(mode==='mqtt'){
      ingest(dbState.readings);
      setHistory(dbState.history.slice(-30000));
    }
    const incoming:EventRecord[]=(data?.Anomaly_Results||[]).map(item=>({
      id:item.anomaly_id,title:item.point_code+' · recorded anomaly',level:/critical|high/i.test(item.severity||'')?'Critical':/medium|warning/i.test(item.severity||'')?'Warning':'Info',
      description:item.description||'Recorded anomaly',source:item.asset_id,zone:'Whole building',time:item.timestamp,
      acknowledged:/acknowledged|closed/i.test(item.anomaly_status||''),synthetic:false
    }));
    setEvents(old=>[...incoming,...old.filter(e=>e.synthetic)]);
   }catch{if(active)setBackendConnected(false)}
  };
  void fetchData();const timer=setInterval(fetchData,15000);return()=>{active=false;clearInterval(timer)};
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
    if(data.trace?.trace_id){const trace=pendingTraces.current.get(data.trace.trace_id)||{codes:new Set<string>(),size:Number(data.trace.batch_size)};trace.codes.add(String(data.point_code));pendingTraces.current.set(data.trace.trace_id,trace);if(pendingTraces.current.size>2000)pendingTraces.current.delete(pendingTraces.current.keys().next().value!);}
    ingest([{point_code:String(data.point_code),value:Number(data.value),timestamp:String(data.timestamp||data.latest_update||nowIso()),quality:String(data.quality||'simulated'),source:'http',trace:data.trace}]);
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
  if(demo&&[-10001,-10002].includes(id)){setDemoAcknowledged(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);return;}
  const item=events.find(e=>e.id===id);if(!item)return;
  if(!item.synthetic){
   const response=await fetch(`/api/anomalies/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:item.acknowledged?'Review':'Acknowledged'})});
   if(!response.ok)throw new Error(`Unable to update anomaly (${response.status})`);
  }
  setEvents(prev=>prev.map(e=>e.id===id?{...e,acknowledged:!e.acknowledged}:e));
 },[events,demo]);
 const addTestEvent=useCallback(()=>{
  const point=POINTS[Math.floor(Math.random()*POINTS.length)];
  const event: EventRecord = {
    id: randomEventId.current--,
    title: `${point.code} · simulated threshold alert`,
    level: 'Warning',
    description: `Synthetic test alert for ${point.label}. No fault diagnosis is implied.`,
    source: point.assetId,
    zone: point.floor,
    time: nowIso(),
    acknowledged: false,
    synthetic: true
  };
  setEvents(prev => [event, ...prev].slice(0, 100));
 },[]);
 const resetSimulator=useCallback(()=>{generator.current={...initial};const timestamp=nowIso();const batch=POINTS.map(p=>({point_code:p.code,value:initial[p.code],timestamp,quality:'simulated',source:'random' as const}));setReadings(Object.fromEntries(batch.map(row=>[row.point_code,row])));setHistory(batch);setEvents(prev=>prev.filter(e=>!e.synthetic));},[]);
 const liveHistory:Reading[]=useMemo(()=>demo?demoHistory(POINTS,demoOrigin.current+demoStep*900000) as Reading[]:history,[demo,demoStep,history]);
 const liveReadings=useMemo(()=>demo?readingsAt(liveHistory,Infinity) as Record<string,Reading>:readings,[demo,liveHistory,readings]);
 const baseReadings=useMemo(()=>replayTime===null?liveReadings:readingsAt(liveHistory,replayTime) as Record<string,Reading>,[liveReadings,liveHistory,replayTime]);
 const shownReadings=useMemo(()=>scenario?scenarioReadings(baseReadings,POINTS,selectedRoom,scenarioConfig,horizon) as Record<string,Reading>:baseReadings,[baseReadings,scenario,selectedRoom,scenarioConfig,horizon]);
 const shownHistory=useMemo(()=>replayTime===null?liveHistory:liveHistory.filter(r=>Date.parse(r.timestamp)<=replayTime),[liveHistory,replayTime]);
 const demoEnd=demoOrigin.current;
 const displayEvents:EventRecord[]=demo?[-10001,-10002].map((id,i)=>({id,title:i?'Cooling schedule review · demo':'Review meeting CO₂ · demo',level:i?'Info':'Warning',description:i?'Illustrative review event for demonstration.':'Synthetic review marker; inspect timeline readings. No verified maintenance fault.',source:i?'L02-OPEN':'L03-MEET',zone:i?'Level_02':'Level_03',time:new Date(demoEnd-(i?8:4)*3600000).toISOString(),acknowledged:demoAcknowledged.includes(id),synthetic:true})):events;
 const displayMaintenance=demo?[{maintenance_id:-1,asset_id:'L03-MEET',event_date:new Date(demoEnd-86400000).toISOString(),event_type:'Demo record',maintenance_status:'Illustration',description:'Synthetic ventilation review for the guided demonstration; no physical work recorded.'}]:maintenance;
 const value=useMemo(()=>({weather,setWeather,weatherMotion,setWeatherMotion,mode,setMode,running,setRunning,intervalMs,setIntervalMs,readings:shownReadings,history:shownHistory,liveHistory,liveReadings,replayTime,setReplayTime,demo,setDemo,scenario,setScenario,scenarioConfig,setScenarioConfig,horizon,setHorizon,selectedRoom,setSelectedRoom,assistantOpen,setAssistantOpen,events:displayEvents,acknowledge,addTestEvent,assets,maintenance:displayMaintenance,backendConnected,storage,mqttCoverage,resetSimulator}),
  [weather,weatherMotion,mode,running,intervalMs,shownReadings,shownHistory,liveHistory,liveReadings,replayTime,demo,scenario,scenarioConfig,horizon,selectedRoom,assistantOpen,displayEvents,displayMaintenance,events,acknowledge,addTestEvent,assets,maintenance,backendConnected,storage,mqttCoverage,resetSimulator]);
 return <TwinContext.Provider value={value}>{children}</TwinContext.Provider>;
}
export function useTwin(){const context=useContext(TwinContext);if(!context)throw Error('TwinProvider is missing');return context;}
export function historyFor(history:Reading[],codes:string[],limit=80){return history.filter(r=>codes.includes(r.point_code)).slice(-limit);}

