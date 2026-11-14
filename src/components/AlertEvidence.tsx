import {displayTime,type EventRecord,type Reading} from '../services/twin';
import {TelemetryChart} from './TelemetryChart';
export function AlertEvidence({event}:{event:EventRecord}){
 const rows=event.evidence||[];
 if(!rows.length)return <p>No retained reading window is attached to this event.</p>;
 return <section className="alert-evidence"><h3>Readings leading to the alert</h3><p>Up to five preceding readings and the trigger reading. This evidence stays fixed as new data arrives.</p>
 <TelemetryChart codes={[event.point_code!]} title="Retained incident window" evidence={rows.map(r=>({...r,source:'stored' as const})) as Reading[]}/>
 <div className="evidence-table"><table><thead><tr><th>Observation time</th><th>Value</th><th>Quality</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.timestamp} className={i===rows.length-1?'trigger-reading':''}><td>{displayTime(r.timestamp)}{i===rows.length-1?' · trigger':''}</td><td>{r.value??'Unavailable'}</td><td>{r.quality}</td></tr>)}</tbody></table></div></section>;
}
