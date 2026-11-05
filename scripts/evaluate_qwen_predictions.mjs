import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildingFacts} from '../server/buildingAssistant.js';
import {predictWithQwen} from '../server/qwenPrediction.js';

export function scorePredictions(results,key){
 const byId=new Map();for(const r of results){if(byId.has(r.case_id))throw Error('Duplicate result ID');byId.set(r.case_id,r)}
 const ids=new Set(),counts={TP:0,TN:0,FP:0,FN:0,abstained:0},groups=new Map();let total=0;
 for(const k of key){
  if(typeof k.case_id!=='string'||ids.has(k.case_id))throw Error('Invalid or duplicate answer-key ID');ids.add(k.case_id);
  const r=byId.get(k.case_id),p=r?.prediction;
  if(k.needs_investigation!==undefined){
   if(typeof k.needs_investigation!=='boolean')throw Error('Classification key must be boolean');total++;
   const predicted=p?.model_used===true?p.needs_investigation:null;
   if(typeof predicted!=='boolean')counts.abstained++;else counts[predicted?(k.needs_investigation?'TP':'FP'):(k.needs_investigation?'FN':'TN')]++;
  }
  if(k.future_value!==undefined){
   if(typeof k.future_value!=='number'||!Number.isFinite(k.future_value)||typeof k.point_code!=='string'||![5,15,30].includes(k.horizon_minutes)||!Number.isFinite(Date.parse(k.target_time)))throw Error('Forecast key needs point, horizon, target time and finite future value');
   const id=k.point_code+'|'+k.horizon_minutes;let g=groups.get(id);if(!g){g={point_code:k.point_code,horizon_minutes:k.horizon_minutes,total:0,completed:0,absolute_error:0,squared_error:0,baseline_absolute_error:0};groups.set(id,g)}g.total++;
   const f=p?.model_used===true?p.forecast:null;
   if(f&&p.point_code===k.point_code&&f.horizon_minutes===k.horizon_minutes&&Date.parse(f.target_time)===Date.parse(k.target_time)&&typeof f.value==='number'&&Number.isFinite(f.value)&&typeof f.baseline_persistence==='number'&&Number.isFinite(f.baseline_persistence)){
    const err=f.value-k.future_value;g.completed++;g.absolute_error+=Math.abs(err);g.squared_error+=err*err;g.baseline_absolute_error+=Math.abs(f.baseline_persistence-k.future_value);
   }
  }
 }
 for(const id of byId.keys())if(!ids.has(id))throw Error('Results include an ID absent from the answer key');
 const {TP:tp,TN:tn,FP:fp,FN:fn}=counts,n=tp+tn+fp+fn,ratio=(a,b)=>b?a/b:null;
 return {classification:{counts,total,coverage:ratio(n,total),accuracy_all_cases:ratio(tp+tn,total),accuracy_answered_only:ratio(tp+tn,n),precision:ratio(tp,tp+fp),recall_answered_only:ratio(tp,tp+fn),f1_answered_only:ratio(2*tp,2*tp+fp+fn)},forecasts:[...groups.values()].map(g=>({point_code:g.point_code,horizon_minutes:g.horizon_minutes,total:g.total,completed:g.completed,coverage:ratio(g.completed,g.total),mae:ratio(g.absolute_error,g.completed),rmse:g.completed?Math.sqrt(g.squared_error/g.completed):null,persistence_mae:ratio(g.baseline_absolute_error,g.completed),mae_improvement: g.baseline_absolute_error?1-g.absolute_error/g.baseline_absolute_error:null})),limitations:'Synthetic held-out cases only. All-case classification accuracy treats missing/abstained predictions as unsuccessful. Forecast error uses completed predictions only; report coverage. Do not average raw errors across incompatible sensors/units. No measurements were produced by the scoring code.'};
}
async function readLines(path){return (await fs.readFile(path,'utf8')).split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l))}
async function main(){
 const [command,...args]=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('Expected --name value arguments');opts[args[i].slice(2)]=args[i+1]}
 if(command==='run'){
  if(!opts.cases||!opts.out||opts.key)throw Error('run requires --cases and --out only; do not give it a private answer key');
  const cases=await readLines(opts.cases),ids=new Set();await fs.writeFile(opts.out,'');
  for(const c of cases){
   if(!c.case_id||ids.has(c.case_id)||!['anomaly','forecast','combined'].includes(c.task)||!Array.isArray(c.rows)||!Number.isFinite(Date.parse(c.as_of))||typeof c.question!=='string')throw Error('Invalid or duplicate public case');ids.add(c.case_id);
   // Whitelist row fields; strip test labels and every post-cutoff observation before retrieval.
   const rows=c.rows.filter(r=>Date.parse(r.timestamp)<=Date.parse(c.as_of)).map(r=>({point_code:r.point_code,timestamp:r.timestamp,value:r.value,quality:r.quality}));
   const snapshot=buildingFacts(rows,null,{scope:c.point_code,window_minutes:60});
   const prediction=await predictWithQwen({rows,facts:snapshot.facts,scope:c.point_code,as_of:c.as_of,task:c.task,point_code:c.point_code,horizon_minutes:c.horizon_minutes||15,window_minutes:60,question:c.question});
   await fs.appendFile(opts.out,JSON.stringify({case_id:c.case_id,prediction})+'\n');console.log(c.case_id,prediction.status);
  }
 }else if(command==='score'){
  if(!opts.results||!opts.key||!opts.out)throw Error('score requires --results, --key and --out');
  const report=scorePredictions(await readLines(opts.results),await readLines(opts.key));await fs.writeFile(opts.out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }else throw Error('Use run --cases public.jsonl --out predictions.jsonl OR score --results predictions.jsonl --key private.jsonl --out report.json');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
