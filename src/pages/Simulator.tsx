import {useEffect,useState} from 'react';import {Sun,CloudRain,CalendarDays,Users,Snowflake,Wind,FlaskConical,Play,Pause,RotateCcw,ArrowRight,Check,CheckCircle2,AlertCircle,LoaderCircle} from 'lucide-react';
import {WeatherStation,useSimulationSource} from '../components/WeatherStation';
import {SimulationClock} from '../components/SimulationClock';
import {ScenarioExperiment} from '../components/ScenarioExperiment';
import {presetPatch,scenarioActive,scenarioLabel,observedScenario} from '../services/simulationControlView.js';
import '../simulation-experiments.css';import {ASSETS,POINTS,useTwin} from '../services/twin';
type Controls={weather_mode:string;calendar_mode:string;attendance_factor:number;ac_mode:string;setpoint_c:number;ventilation:number;step_seconds:number;paused:boolean};
const defaults:Controls={weather_mode:'auto',calendar_mode:'auto',attendance_factor:1,ac_mode:'auto',setpoint_c:24,ventilation:1,step_seconds:5,paused:false};
const pickControls=(d:Partial<Controls>)=>Object.fromEntries(Object.keys(defaults).map(k=>[k,d[k as keyof Controls]??defaults[k as keyof Controls]])) as Controls;
const offsets:Record<string,number[]>={temperature:[1,3,6],humidity:[5,10,20],co2:[200,500,1000],light:[100,300,600],power:[.5,2,5]};
function Choices<T extends string|number>({label,value,items,onChange}:{label:string;value:T;items:{label:string;value:T}[];onChange:(v:T)=>void}){
 return <div className="choice-field"><span className="eyebrow">{label}</span><div className="choice-buttons" role="group" aria-label={label}>{items.map(item=><button type="button" key={item.value} aria-pressed={item.value===value} onClick={()=>onChange(item.value)}>{item.label}</button>)}</div></div>;
}
export function Simulator(){
 const source=useSimulationSource(),{addTestEvent}=useTwin(),[draft,setDraft]=useState(defaults),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 const [applied,setApplied]=useState<Controls|null>(null);
 const [feedback,setFeedback]=useState<'info'|'queued'|'confirmed'|'error'>('info');
 const [pendingPreset,setPendingPreset]=useState<{kind:'normal'|'rain'|'holiday'|'busy';sequence:number|null;replayId:string|null}|null>(null);
 const [faultCode,setFaultCode]=useState(POINTS[0].code),[faultKind,setFaultKind]=useState('drift'),[severity,setSeverity]=useState(1),[direction,setDirection]=useState(1),[duration,setDuration]=useState(15);
 const hybrid=source?.name==='calibrated_hybrid_v1',operation=source?.simulation?.operation,disabled=!hybrid||busy||!ready;
 useEffect(()=>{void fetch('/api/simulation/control').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{setDraft(pickControls(d));setApplied(pickControls(d));setReady(true)}).catch(()=>setMessage('Connect the API to use simulation controls.'))},[]);
 const change=<K extends keyof Controls>(key:K,value:Controls[K])=>setDraft(d=>({...d,[key]:value}));
 const send=async(body:unknown,success?:string)=>{
  setBusy(true);setPendingPreset(null);
  try{
   const r=await fetch('/api/simulation/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();
   if(!r.ok)throw Error(d.error||'Request failed');
   setApplied(pickControls(d));setFeedback(success?'queued':'confirmed');
   setMessage(success||d.status||'Simulator accepted the control update.');
   if(body&&typeof body==='object'&&'reset' in body)setDraft(pickControls(d));
   return true;
  }catch(e){setFeedback('error');setMessage('Simulation request failed: '+(e instanceof Error?e.message:String(e)));return false}
  finally{setBusy(false)}
 };
 const pause=async()=>{const value=!draft.paused;if(await send({paused:value}))change('paused',value)};
 const point=POINTS.find(p=>p.code===faultCode)!,faultTypes=point.sensorType==='water_leakage'?['leak','stuck','missing']:point.unit==='binary'?['stuck','missing']:['drift','spike','stuck','missing'];
 const chooseSensor=(code:string)=>{const p=POINTS.find(p=>p.code===code)!;setFaultCode(code);setFaultKind(p.sensorType==='water_leakage'?'leak':p.unit==='binary'?'stuck':'drift')};
 const magnitude=(offsets[point.sensorType]||[1,1,1])[severity]*direction;
 const preset=async(kind:'normal'|'rain'|'holiday'|'busy')=>{
  const patch=presetPatch(kind,draft,source?.dataset_timestamp||source?.simulation?.weather.timestamp),label=scenarioLabel[kind];
  const baseline={kind,sequence:source?.sequence??null,replayId:source?.replay_id??null};
  setFeedback('queued');setMessage('Sending '+label+' to the simulator…');
  const resetClock='start_clock' in patch&&typeof patch.start_clock==='string';
  const acceptedMessage=resetClock
   ?label+' selected — starting a new daytime simulation at 10:00 MYT so the occupancy schedule produces visible people. Checking the next generated batch…'
   :label+' selected — request accepted. Checking the next generated weather/sensor batch…';
  if(await send(patch,acceptedMessage)){
   setDraft(old=>pickControls({...old,...patch}));setPendingPreset(baseline);
  }
 };
 useEffect(()=>{
  if(!pendingPreset||!source?.simulation)return;
  const newBatch=source.replay_id!==pendingPreset.replayId||
   (typeof source.sequence==='number'&&(pendingPreset.sequence===null||source.sequence>pendingPreset.sequence));
  if(!newBatch||!observedScenario(pendingPreset.kind,source))return;
  const w=source.simulation.weather;
  const info=pendingPreset.kind==='rain'
   ?`Rain confirmed in live telemetry: ${w.rainfall_mm_per_h.toFixed(2)} mm/h at ${source.dataset_timestamp||w.timestamp}. Indoor humidity may respond over the next simulated minutes.`
   :scenarioLabel[pendingPreset.kind]+' confirmed in a new generated sensor batch ('+(source.dataset_timestamp||'current synthetic time')+').';
  setFeedback('confirmed');setMessage(info);setPendingPreset(null);
 },[pendingPreset,source]);
 useEffect(()=>{
  if(!pendingPreset)return;
  const id=window.setTimeout(()=>setMessage(scenarioLabel[pendingPreset.kind]+' request accepted, but no matching new sensor batch yet. Check that the generator is running and not paused.'),25000);
  return()=>window.clearTimeout(id);
 },[pendingPreset]);
 return <div className="simulation-page"><div className="page-heading"><div><div className="eyebrow">SANDBOX / GENERATED CONDITIONS</div><h1>Simulation lab</h1><p>Set the conditions. Watch the building respond.</p></div><div className="heading-actions"><span className="pill pill-teal">{hybrid?'Generator connected':'Waiting for generator'}</span><button className="small-outline" disabled={disabled} onClick={()=>void pause()}>{draft.paused?<Play size={13}/>:<Pause size={13}/>} {draft.paused?'Resume':'Pause'}</button><button className="small-outline" disabled={busy||!ready} onClick={()=>void send({reset:true})}><RotateCcw size={13}/> Reset</button></div></div>
 <div className="quick-scenarios"><span className="eyebrow">QUICK SCENARIOS</span>
 <button type="button" disabled={disabled} aria-pressed={scenarioActive('normal',applied)} onClick={()=>void preset('normal')}><Sun size={15}/> Normal day{scenarioActive('normal',applied)&&<Check size={13} aria-hidden="true"/>}</button>
 <button type="button" disabled={disabled} aria-pressed={scenarioActive('rain',applied)} onClick={()=>void preset('rain')}><CloudRain size={15}/> Rainy day{scenarioActive('rain',applied)&&<Check size={13} aria-hidden="true"/>}</button>
 <button type="button" disabled={disabled} aria-pressed={scenarioActive('holiday',applied)} onClick={()=>void preset('holiday')}><CalendarDays size={15}/> Public holiday{scenarioActive('holiday',applied)&&<Check size={13} aria-hidden="true"/>}</button>
 <button type="button" disabled={disabled} aria-pressed={scenarioActive('busy',applied)} onClick={()=>void preset('busy')}><Users size={15}/> Busy building{scenarioActive('busy',applied)&&<Check size={13} aria-hidden="true"/>}</button>
 </div>
 <p className="control-feedback simulator-feedback" data-feedback={feedback} role="status" aria-live="polite">
  {feedback==='queued'?<LoaderCircle size={15} className="feedback-spin" aria-hidden="true"/>:feedback==='confirmed'?<CheckCircle2 size={15} aria-hidden="true"/>:feedback==='error'?<AlertCircle size={15} aria-hidden="true"/>:<CloudRain size={15} aria-hidden="true"/>}
  <span>{message||(!hybrid?'Waiting for the hybrid generator — quick scenarios are temporarily unavailable.':'Select a quick scenario. Selected controls will be highlighted; confirmation follows when a new sensor batch arrives.')}</span>
 </p>
 <WeatherStation/>
 <SimulationClock onApplied={calendar=>change('calendar_mode',calendar)}/>
 <div className="lab-grid"><section className="surface lab-panel"><div className="panel-heading"><span className="panel-icon"><Snowflake size={17}/></span><div><h2>Building conditions</h2><p>Weather, attendance and room operation</p></div></div><fieldset disabled={disabled}>
 <Choices label="Weather" value={draft.weather_mode} items={[{label:'Auto',value:'auto'},{label:'Clear',value:'clear'},{label:'Cloudy',value:'cloudy'},{label:'Rain',value:'rain'}]} onChange={v=>change('weather_mode',v)}/>
 <Choices label="Calendar" value={draft.calendar_mode} items={[{label:'Actual date',value:'auto'},{label:'Workday',value:'workday'},{label:'Holiday',value:'holiday'}]} onChange={v=>change('calendar_mode',v)}/>
 <Choices label="Attendance" value={draft.attendance_factor} items={[{label:'Empty · 0×',value:0},{label:'Light · 0.5×',value:.5},{label:'Typical · 1×',value:1},{label:'Busy · 1.5×',value:1.5}]} onChange={v=>change('attendance_factor',v)}/>
 <Choices label="Air conditioning" value={draft.ac_mode} items={[{label:'Schedule',value:'auto'},{label:'On',value:'on'},{label:'Off',value:'off'}]} onChange={v=>change('ac_mode',v)}/>
 <div className="lab-inline"><div className="choice-field"><span className="eyebrow">AC SETPOINT</span><div className="button-stepper"><button aria-label="Decrease AC setpoint" onClick={()=>change('setpoint_c',Math.max(16,draft.setpoint_c-.5))}>−</button><output aria-live="polite">{draft.setpoint_c.toFixed(1)} °C</output><button aria-label="Increase AC setpoint" onClick={()=>change('setpoint_c',Math.min(30,draft.setpoint_c+.5))}>+</button></div></div><div className="choice-field"><span className="eyebrow">VENTILATION</span><div className="button-stepper"><button aria-label="Decrease ventilation" onClick={()=>change('ventilation',Math.max(.2,Math.round((draft.ventilation-.2)*10)/10))}>−</button><output aria-live="polite"><Wind size={13}/>{draft.ventilation.toFixed(1)}×</output><button aria-label="Increase ventilation" onClick={()=>change('ventilation',Math.min(2,Math.round((draft.ventilation+.2)*10)/10))}>+</button></div></div></div>
 <Choices label="Time advanced per batch" value={draft.step_seconds} items={[{label:'5 seconds',value:5},{label:'1 minute',value:60},{label:'5 minutes',value:300}]} onChange={v=>change('step_seconds',v)}/>
 <button className="dark-button apply-conditions" onClick={()=>void send(draft)}>Apply conditions <ArrowRight size={14}/></button></fieldset>
 <div className="applied-settings"><strong><Check size={12}/> Applied to generator</strong><p>{source?.simulation?.weather.mode||'—'} weather · {source?.simulation?.calendar.override||'—'} calendar · AC {operation?.ac_mode||'auto'} · {operation?.setpoint_c??24} °C · ventilation {operation?.ventilation??1}× · {source?.simulation?.simulation_step_seconds??'—'} s / batch</p></div></section>
 <section className="surface lab-panel"><div className="panel-heading"><span className="panel-icon warning"><FlaskConical size={17}/></span><div><h2>Abnormal sensor test</h2><p>One sensor. A controlled, timed fault.</p></div></div><fieldset disabled={disabled}>
 <Choices label="Location" value={point.assetId} items={ASSETS.map(a=>({label:POINTS.find(p=>p.assetId===a)!.locationLabel,value:a}))} onChange={a=>chooseSensor(POINTS.find(p=>p.assetId===a)!.code)}/>
 <Choices label="Sensor" value={faultCode} items={POINTS.filter(p=>p.assetId===point.assetId).map(p=>({label:p.label,value:p.code}))} onChange={chooseSensor}/>
 <Choices label="Fault type" value={faultKind} items={faultTypes.map(k=>({label:k.charAt(0).toUpperCase()+k.slice(1),value:k}))} onChange={setFaultKind}/>
 <Choices label="Simulated duration" value={duration} items={[5,15,30,60].map(n=>({label:n+' min',value:n}))} onChange={setDuration}/>
 {['drift','spike'].includes(faultKind)&&<><Choices label="Intensity" value={severity} items={[{label:'Low',value:0},{label:'Medium',value:1},{label:'High',value:2}]} onChange={setSeverity}/><Choices label="Direction" value={direction} items={[{label:'Raise',value:1},{label:'Lower',value:-1}]} onChange={setDirection}/><div className="fault-offset">Selected offset <strong>{magnitude>0?'+':''}{magnitude} {point.unit}</strong></div></>}
 <div className="heading-actions fault-actions"><button className="dark-button" onClick={()=>void send({fault:{kind:faultKind,sensor_id:faultCode,magnitude,duration_minutes:duration}})}><Play size={13}/> Start test</button><button className="small-outline" onClick={()=>void send({fault:{kind:'none'}})}>Stop fault</button></div></fieldset>
 <p className="lab-explanation">Faults affect reported measurements for the selected simulated duration. Normal room dynamics keep running; private fault labels stay outside the assistant.</p><button className="text-link" onClick={()=>addTestEvent(faultCode)}>Create an event record for this sensor <ArrowRight size={12}/></button><p className="subtle">Automatic rule alerts are created from incoming abnormal measurements. For a reliable demonstration, select a leakage sensor and Leak, or any sensor and Missing. Allow one delivery interval. The manual record above is separate.</p></section></div>
 <ScenarioExperiment/>
 <details className="surface response-guide"><summary>How these conditions connect to the building</summary><div className="response-grid"><p><strong>Rain / clouds</strong> Outdoor humidity, temperature, rainfall and sunlight drive the indoor response models. Changes take simulated minutes.</p><p><strong>Attendance</strong> Presence, CO₂, lighting and aggregate power follow generated occupancy.</p><p><strong>AC / ventilation</strong> Setpoint changes thermal targets; ventilation affects CO₂ dilution.</p><p><strong>Holidays</strong> Scheduled attendance and AC are off; explicit AC overrides still apply.</p></div><p>This is synthetic telemetry. Rain does not automatically indicate a leak. Delivery: one batch every {source?.release_interval_seconds??'—'} real seconds.</p></details>
 </div>;
}

