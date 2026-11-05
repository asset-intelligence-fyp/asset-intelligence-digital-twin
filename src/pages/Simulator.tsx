import {WeatherStation,useSimulationSource} from '../components/WeatherStation';
import { Activity, AlertTriangle } from 'lucide-react';
import { POINTS, readingLabel, displayTime, useTwin } from '../services/twin';
import { Eyebrow } from '../components/UI';
import {BenchmarkPanel} from '../components/BenchmarkPanel';
import { TelemetryChart } from '../components/TelemetryChart';
export function Simulator(){
 const {readings,addTestEvent}=useTwin();
 const producer=useSimulationSource();
 const hybrid=producer?.name==='calibrated_hybrid_v1';
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>SIMULATION CONTROLS</Eyebrow><h1>Sensor simulator</h1><p>Simulated telemetry · 18 IFC-linked channels</p></div><div className="heading-actions"><span className="pill pill-teal"><span className="status-dot"/>Synthetic Python HTTP stream</span></div></div>
 <WeatherStation controls/>
 <BenchmarkPanel/>
 <div className="twin-sim-grid"><section className="surface twin-sim-control"><Eyebrow>SIMULATED SOURCE</Eyebrow>
 <p>{hybrid?'New synthetic readings from a calibrated hybrid generator.':producer?.name==='people_driven_v3.0_dataset_replay'?'Dataset replay testing mode: original values and timestamps.':'Waiting for the Python simulator.'} No physical sensor feed is used.</p>
 <p><strong>Source:</strong> {hybrid?'Hybrid model calibrated on normal 2023–2024 data':producer?.dataset||'Not connected'}<br/><strong>Simulation time:</strong> {displayTime(producer?.dataset_timestamp)}</p>
 {hybrid?<><p>New occupancy, weather and sensor variation are generated each run. Room dynamics connect attendance, outdoor weather and AC to the 18 indoor readings. Holidays reduce scheduled attendance and AC; environmental values continue changing.</p><p>Time advances {producer?.simulation?.simulation_step_seconds??5} simulated seconds per batch; delivery interval is {producer?.release_interval_seconds??5} real seconds. Profile: {producer?.simulation?.profile_id} · Seed: {producer?.simulation?.seed}.</p><p>Calibration learns aggregate behaviour from synthetic data, not a validated physical building model. No dataset rows are replayed. Fault injection labels stay in private local logs, outside the chatbot input.</p></>:<p>Replay preserves the original five-minute samples. Hybrid mode is the default generator; select replay explicitly for reproducible dataset tests.</p>}
 <p>Stop the Python process to pause. IFC locations remain demonstration room-type aliases. The four virtual outdoor channels are separate from the 18 IFC-linked indoor channels.</p>
 <Eyebrow>EVENT TESTING</Eyebrow><button className="small-outline twin-alert-button" onClick={addTestEvent}><AlertTriangle size={15}/> Generate test alert</button><p>Test alerts can be acknowledged in Event log. They are not AI predictions.</p></section>
 <section className="surface twin-sim-readings"><Eyebrow><Activity size={14}/> ACTIVE CHANNELS</Eyebrow>{POINTS.map(p=><div className="twin-sim-reading" key={p.code}><div><strong>{p.code}</strong><small>{p.assetId} · {p.label}</small></div><div><code>{readingLabel(p.code,readings[p.code])}</code><small>{readings[p.code]?new Date(readings[p.code].timestamp).toLocaleTimeString():'—'}</small></div></div>)}<p className="twin-small">Updated {displayTime(Object.values(readings).map(r=>r.timestamp).sort().at(-1))}</p></section></div>
 <section className="surface chart-panel twin-sim-chart"><div className="chart-heading"><h3>Simulated room temperatures</h3><span>°C · auto-refresh</span></div><TelemetryChart codes={['TEMP-L03-OPEN-01','TEMP-L03-MEET-01']}/></section></div>;
}

