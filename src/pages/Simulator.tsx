import { Activity, AlertTriangle } from 'lucide-react';
import { POINTS, readingLabel, displayTime, useTwin } from '../services/twin';
import { Eyebrow } from '../components/UI';
import {BenchmarkPanel} from '../components/BenchmarkPanel';
import { TelemetryChart } from '../components/TelemetryChart';
export function Simulator(){
 const {readings,addTestEvent}=useTwin();
 return <div className="analytics-page"><div className="page-heading"><div><Eyebrow>SIMULATION CONTROLS</Eyebrow><h1>Sensor simulator</h1><p>Simulated telemetry · 18 IFC-linked channels</p></div><div className="heading-actions"><span className="pill pill-teal"><span className="status-dot"/>Synthetic Python HTTP stream</span></div></div>
 <BenchmarkPanel/>
 <div className="twin-sim-grid"><section className="surface twin-sim-control"><Eyebrow>SIMULATED SOURCE</Eyebrow>
 <p>The dashboard receives the bundled 18-point Python simulator over HTTP. Your teammate’s intended simulator/dataset has not been supplied or verified yet. There is no physical sensor feed.</p>
 <p>Simulation time advances one minute per batch; delivery defaults to one batch every five real seconds. These are different clocks. Normal mode injects no faults. Scene weather does not change readings.</p>
 <p>Source delivery is controlled by the Python process. Stop it in Terminal to pause; no browser-random fallback is offered here.</p>
 <p>IFC locations remain demonstration room-type aliases. Virtual power is an illustrative aggregate.</p>
 <Eyebrow>EVENT TESTING</Eyebrow><button className="small-outline twin-alert-button" onClick={addTestEvent}><AlertTriangle size={15}/> Generate test alert</button><p>Test alerts can be acknowledged in Event log. They are not AI predictions.</p></section>
 <section className="surface twin-sim-readings"><Eyebrow><Activity size={14}/> ACTIVE CHANNELS</Eyebrow>{POINTS.map(p=><div className="twin-sim-reading" key={p.code}><div><strong>{p.code}</strong><small>{p.assetId} · {p.label}</small></div><div><code>{readingLabel(p.code,readings[p.code])}</code><small>{readings[p.code]?new Date(readings[p.code].timestamp).toLocaleTimeString():'—'}</small></div></div>)}<p className="twin-small">Updated {displayTime(Object.values(readings).map(r=>r.timestamp).sort().at(-1))}</p></section></div>
 <section className="surface chart-panel twin-sim-chart"><div className="chart-heading"><h3>Simulated room temperatures</h3><span>°C · auto-refresh</span></div><TelemetryChart codes={['TEMP-L03-OPEN-01','TEMP-L03-MEET-01']}/></section></div>;
}

