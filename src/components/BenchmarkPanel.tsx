import {useEffect,useState} from 'react';
type Report={run_id:string;assessment:string;total_batches:number;completed_batches:number;pending_batches:number;invalid_clock_batches:number;uninstrumented_batches:number;evicted_batches:number;median_ms:number|null;p95_ms:number|null;max_ms:number|null;within_5s:number;storage:string;measurement:string;clock_assumption:string};
export function BenchmarkPanel(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
 const refresh=async()=>{try{const r=await fetch('/api/benchmarks/latency',{cache:'no-store'});if(!r.ok)throw Error('Benchmark API unavailable');setReport(await r.json());setError('')}catch(e){setError(String(e))}};
 useEffect(()=>{void refresh();const id=setInterval(refresh,2000);return()=>clearInterval(id)},[]);
 const ms=(v:number|null|undefined)=>v==null?'Not measured':`${v.toFixed(1)} ms`;
 const download=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`latency-${report.run_id}.json`;a.click();URL.revokeObjectURL(url)};
 return <section className="surface benchmark-panel"><div className="chart-heading"><h3>Source-to-screen latency</h3><span>Target ≤ 5,000 ms</span></div>
 <p>Measured from dataset batch release to a browser update and paint opportunity, including the acknowledgement back to the API. This is a conservative upper bound, not AI response time or GPU rendering completion.</p>
 {error&&<p role="alert">{error}</p>}
 <div className="kpi-grid"><div><strong>{ms(report?.median_ms)}</strong><p>Median</p></div><div><strong>{ms(report?.p95_ms)}</strong><p>95th percentile</p></div><div><strong>{ms(report?.max_ms)}</strong><p>Maximum</p></div><div><strong>{report?.completed_batches??0} / {report?.total_batches??0}</strong><p>Completed batches</p></div></div>
 <p role="status">{report?.assessment.replaceAll('_',' ')||'Waiting for instrumented simulator readings'}. At least 30 batches and complete coverage are required for a run assessment. Result uses the first reporting browser; close duplicate tabs.</p>
 <p>Pending: {report?.pending_batches??0} · Invalid clocks: {report?.invalid_clock_batches??0} · Missing timing metadata: {report?.uninstrumented_batches??0} · Evicted: {report?.evicted_batches??0} · Storage: {report?.storage??'unknown'}.</p>
 <p>Run simulator, API and browser on the same computer. Keep this tab visible. This run measures the current hardware and storage mode only.</p>
 <div className="heading-actions"><button className="small-outline" onClick={async()=>{const r=await fetch('/api/benchmarks/reset',{method:'POST'});if(r.ok)await refresh();else setError('Unable to start a measurement run')}}>Start new measurement run</button><button className="small-outline" disabled={!report} onClick={download}>Download latency results</button></div>
 <hr/><h3>AI accuracy</h3><p>Not evaluated. A working chatbot or a passed unit test is not evidence of ≥85% anomaly accuracy. Use the labelled, held-out evaluation procedure in docs/performance-evaluation.md. Synthetic results must be reported separately from the brief’s maintenance-event criterion.</p>
 </section>;
}
