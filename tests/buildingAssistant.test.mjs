import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {buildingFacts,rankFacts,registerBuildingAssistant} from '../server/buildingAssistant.js';import {registry} from '../server/sensorContract.js';
const history=registry.map((p,i)=>({point_code:p.code,timestamp:'2026-11-05T01:00:00Z',value:p.unit==='binary'?0:20+i,quality:'synthetic'}));
test('Whole-building facts cover all locations and preserve missing values, units and available history',()=>{
 const rows=[...history,{...history[0],timestamp:'2026-11-05T01:05:00Z',value:null,quality:'missing'}];const out=buildingFacts(rows,null);assert.equal(out.facts.filter(f=>f.category==='location').length,5);
 assert.equal(out.facts.find(f=>f.id==='latest:'+registry[0].code).missing,true);assert.match(out.facts.find(f=>f.id==='coverage').text,/17 of 18/);
 const ranked=rankFacts(out.facts,'Compare office and meeting CO2');assert.ok(ranked.slice(0,7).filter(f=>f.category==='co2').length>=2);
 const scoped=buildingFacts(rows,null,{scope:registry[0].code});assert.equal(scoped.facts.filter(f=>f.id.startsWith('latest:')).length,1);
});
async function run(fetchImpl,fn){const app=express();app.use(express.json());registerBuildingAssistant(app,{getHistory:async()=>history,getSource:()=>null,fetchImpl});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn('http://127.0.0.1:'+server.address().port)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}}
const ask=(base,body,headers={})=>fetch(base+'/api/assistant/building',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('Unavailable or invalid local model yields explicit evidence lookup, never fabricated prose',async()=>{
 await run(async()=>{throw Error('offline')},async base=>{const r=await ask(base,{question:'Summarise the whole building'}),d=await r.json();assert.equal(r.status,200);assert.equal(d.model_used,false);assert.equal(d.facts.filter(f=>f.category==='location').length,5);assert.match(d.model_note,/lookup/);
 assert.equal((await ask(base,{question:'test',scope:'fake'})).status,400);assert.equal((await ask(base,{question:'test'},{Origin:'https://unexpected.example'})).status,403)});
 await run(async()=>({ok:true,json:async()=>({response:JSON.stringify({fact_ids:['fabricated']})})}),async base=>{assert.equal((await(await ask(base,{question:'What is the CO2?'})).json()).model_used,false)});
});
test('Qwen can select only existing evidence IDs; displayed measurements remain backend facts',async()=>{
 await run(async()=>({ok:true,json:async()=>({response:JSON.stringify({fact_ids:['latest:CO2-L03-OPEN-01','latest:CO2-L03-MEET-01']})})}),async base=>{const d=await(await ask(base,{question:'Compare CO2'})).json();assert.equal(d.model_used,true);assert.equal(d.facts.length,2);assert.match(d.facts[0].text,/ppm/);assert.ok(d.facts.every(f=>f.category==='co2'))});
});
