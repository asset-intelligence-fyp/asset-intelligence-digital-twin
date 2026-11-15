import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {buildingFacts,rankFacts,registerBuildingAssistant,validateExplanation,evidenceTime} from '../server/buildingAssistant.js';
import {registry} from '../server/sensorContract.js';
const leak=registry.find(p=>p.sensorType==='water_leakage');
const history=registry.map((p,i)=>({point_code:p.code,timestamp:'2026-11-15T05:00:00Z',value:p.unit==='binary'?0:20+i,quality:'synthetic'}));
const row=(value,minute)=>({point_code:leak.code,timestamp:`2026-11-15T05:${String(minute).padStart(2,'0')}:00Z`,value,quality:value===null?'missing':'synthetic'});
const incident={id:7,point_code:leak.code,time:row(1,1).timestamp,resolved_at:row(0,2).timestamp,level:'Critical',acknowledged:true,replay_id:'current',reading_snapshot:row(1,1),evidence:[row(0,0),row(1,1)]};
const explanation={interpretation:[{text:'A dry observation now does not erase the earlier leak incident.',evidence_ids:['latest:'+leak.code,'incident:7']}],possible_explanations:['Residual moisture or an intermittent leak could explain a temporary leak indication; neither is established by these simulated readings.'],recommended_checks:['Review the retained trigger readings and inspect the linked sensor before deciding whether further investigation is needed.']};
async function run(fetchImpl,fn,opts={}){const app=express();app.use(express.json());registerBuildingAssistant(app,{getHistory:async()=>history,getSource:()=>null,fetchImpl,...opts});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn('http://127.0.0.1:'+server.address().port)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}}
const ask=(base,body,headers={})=>fetch(base+'/api/assistant/building',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('Whole-building facts preserve location coverage, missing values, units, scope and MYT timestamps',()=>{
 const rows=[...history,{...history[0],timestamp:'2026-11-15T05:05:00Z',value:null,quality:'missing'}],out=buildingFacts(rows,null);
 assert.equal(out.facts.filter(f=>f.category==='location').length,5);assert.equal(out.facts.find(f=>f.id==='latest:'+registry[0].code).missing,true);assert.match(out.facts.find(f=>f.id==='coverage').text,/17 of 18/);
 const ranked=rankFacts(out.facts,'Compare office and meeting CO2');assert.ok(ranked.slice(0,7).filter(f=>f.category==='co2').length>=2);
 assert.equal(buildingFacts(rows,null,{scope:registry[0].code}).facts.filter(f=>f.id.startsWith('latest:')).length,1);
 assert.equal(evidenceTime('2026-11-15T05:18:00Z'),'15 Nov 2026, 1:18 PM MYT');assert.doesNotMatch(out.facts.map(f=>f.text).join(' '),/GMT\+|Sun Nov/);
});
test('Binary history connects leak to dry and retains incident trigger separately from latest state',()=>{
 const out=buildingFacts([row(0,0),row(1,1),row(0,2)],{replay_id:'current'},{scope:leak.code,alerts:[incident]});
 assert.match(out.facts.find(f=>f.id==='latest:'+leak.code).text,/\*\*dry\*\*/);
 const trend=out.facts.find(f=>f.id==='history:'+leak.code);assert.equal(trend.transitions,2);assert.match(trend.text,/leak detected → dry/);
 const event=out.facts.find(f=>f.id==='incident:7');assert.equal(event.event_id,7);assert.equal(event.same_run,true);assert.match(event.text,/trigger leak detected/);assert.match(event.text,/acknowledged/);
 const gap=buildingFacts([row(0,0),row(null,1),row(1,2)],null,{scope:leak.code}).facts.find(f=>f.id==='history:'+leak.code);assert.equal(gap.transitions,0);assert.match(gap.text,/1 missing/);
});
test('Previous simulation incidents are labelled; unrelated sensors are excluded and windows are bounded',()=>{
 const out=buildingFacts([row(1,0),row(0,20)],{replay_id:'new'},{scope:leak.code,window_minutes:15,alerts:[incident,{...incident,id:8,point_code:registry[0].code}]});
 assert.equal(out.facts.filter(f=>f.incident).length,1);assert.match(out.facts.find(f=>f.incident).text,/Different or unverified simulation run/);assert.match(out.facts.find(f=>f.id==='history:'+leak.code).text,/0 leak and 1 dry/);
});
test('Offline or invalid models fall back explicitly; local-only access and request validation stay enforced',async()=>{
 await run(async()=>{throw Error('offline')},async base=>{const r=await ask(base,{question:'Summarise the whole building'}),d=await r.json();assert.equal(r.status,200);assert.equal(d.model_used,false);assert.ok(d.facts.some(f=>f.id.startsWith('latest:')));assert.match(d.model_note,/stored-evidence summary/);assert.match(d.answer,/Current condition/);
 assert.equal((await ask(base,{question:'test',scope:'fake'})).status,400);assert.equal((await ask(base,{question:'test',window_minutes:900})).status,400);assert.equal((await ask(base,{question:'test'},{Origin:'https://unexpected.example'})).status,403)});
 await run(async()=>({ok:true,json:async()=>({response:JSON.stringify({fact_ids:['fabricated']})})}),async base=>{assert.equal((await(await ask(base,{question:'What is the CO2?'})).json()).model_used,false)});
});
test('Qwen explains retrieved incidents and current evidence; its references and prose are checked',async()=>{
 let payload;
 await run(async(_url,args)=>{payload=JSON.parse(args.body);return {ok:true,json:async()=>({response:JSON.stringify(explanation)})}},async base=>{
  const d=await(await ask(base,{question:'Why is it dry after the earlier leak?',scope:leak.code,conversation:[{scope:leak.code,question:'Review the leak sensor'},{scope:'other',question:'Other context'}]})).json();
  assert.equal(d.model_used,true);assert.match(d.answer,/Qwen interpretation/);assert.match(d.answer,/Previous incidents/);assert.match(d.answer,/Possible explanations · unverified/);assert.match(d.answer,/\*\*dry\*\*/);assert.ok(d.facts.some(f=>f.event_id===7));
  const supplied=JSON.parse(payload.prompt);assert.deepEqual(supplied.prior_questions,['Review the leak sensor']);assert.ok(supplied.evidence.some(f=>f.id==='incident:7'));assert.equal(payload.think,false);
 },{getHistory:async()=>[row(0,0),row(1,1),row(0,2)],getSource:()=>({replay_id:'current'}),getAlerts:async()=>[incident]});
});
test('Invented evidence, new measurements, HTML and asserted repairs reject model explanations',()=>{
 const facts=buildingFacts([row(0,2)],null,{scope:leak.code,alerts:[incident]}).facts;
 assert.equal(validateExplanation(explanation,facts),true);
 for(const text of ['The temperature is 99 degrees.','<img src=x>','The repair was complete.','It was definitely caused by the pipe.'])assert.equal(validateExplanation({...explanation,recommended_checks:[text]},facts),false);
 assert.equal(validateExplanation({...explanation,interpretation:[{text:'A possible pattern.',evidence_ids:['invented']}]},facts),false);
});
test('Failed incident storage is not described as an absence of incidents',async()=>{
 await run(async()=>{throw Error('offline')},async base=>{const d=await(await ask(base,{question:'Review earlier incidents',scope:leak.code})).json();assert.equal(d.incident_lookup_available,false);assert.match(d.answer,/Alert retrieval is unavailable/);assert.doesNotMatch(d.answer,/No matching alert/);assert.match(d.limitations[0],/retrieval failed/)},{getAlerts:async()=>{throw Error('database unavailable')}});
});
