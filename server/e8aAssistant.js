import {registry} from './sensorContract.js';
const byCode=new Map(registry.map(p=>[p.code,p]));
const POSITIVE=new Set(['verified_anomaly','verified_suspect','screening_needs_review']);
const active=(r)=>r && r.workflow==='E8-A'&&typeof r.point_code==='string';

export function scopedE8A(state,{scope='building',asOf=null,replayId=undefined}={}){
 const until=asOf===null?Infinity:Date.parse(asOf);
 if(!state||!Array.isArray(state.results))return [];
 return state.results.filter(active).filter(r=>{
  const p=byCode.get(r.point_code);
  if(!p||!(scope==='building'||scope===p.assetId||scope===p.code))return false;
  if(replayId!==undefined&&r.replay_id!==replayId)return false;
  const observed=Date.parse(r.as_of);
  return Number.isFinite(observed)&&observed<=until;
 }).sort((a,b)=>{
  const delta=Number(POSITIVE.has(b.assessment))-Number(POSITIVE.has(a.assessment));
  return delta||Date.parse(b.as_of)-Date.parse(a.as_of);
 });
}
export function e8aEvidenceFacts(results){
 return results.slice(0,8).map(r=>{
  const p=byCode.get(r.point_code);
  const grounded=r.evidence_status==='grounded';
  const review=grounded?r.verified_status:'unknown';
  // Numeric verification does not imply diagnosis accuracy.
  const explanation=grounded&&typeof r.verification?.explanation==='string'
   ?r.verification.explanation.slice(0,260):'Independent review did not establish a grounded classification.';
  const text=`${p.locationLabel} — ${p.label} (${r.point_code}): E8-A screening ${r.screening_status}; independently reviewed ${review}, evidence ${r.evidence_status}, at ${r.as_of}. ${explanation} Synthetic readings; grounding checks do not confirm a physical fault.`;
  return {id:'e8a:'+p.code,point_code:p.code,category:p.sensorType,e8a:true,
   text,history:true,review:POSITIVE.has(r.assessment)};
 });
}
export function e8aNarrative(state,results){
 if(!state?.connected)return 'E8-A agentic monitoring is unavailable. Existing rule alerts and sensor evidence still operate; no E8-A diagnosis is claimed.';
 if(!results.length)return 'E8-A has not yet completed an assessment for this scope and observation time. This does not mean no anomalies exist.';
 const records=results.slice(0,5).map(r=>{
  const p=byCode.get(r.point_code);
  const verified=r.evidence_status==='grounded'?r.verified_status:'unknown (review required)';
  return `- ${p.locationLabel} · ${p.label}: screening **${r.screening_status}**, verified **${verified}**; evidence ${r.evidence_status}. Evaluated observation: ${r.as_of}. [e8a:${r.point_code}]`;
 });
 return records.join('\n')+'\n\nE8-A uses causal synthetic observations. Its verified channel checks citations and numeric comparisons, not whether a real fault exists. Results are separate from rule-based alerts.';
}
