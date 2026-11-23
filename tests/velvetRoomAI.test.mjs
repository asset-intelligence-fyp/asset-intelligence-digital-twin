import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../src/components/RoomAIWorkspace.tsx',import.meta.url),'utf8');
const outer=readFileSync(new URL('../src/components/AssistantWorkspace.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/room-ai-velvet.css',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/sensorServer.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../server/roomAssistant.js',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../llm_service/bridge.py',import.meta.url),'utf8');

test('Building Intelligence lands on the live, evidence-led report rather than a question form',()=>{
 assert.match(outer,/useState<'building'\|'room'>\('room'\)/);
 assert.match(outer,/Building intelligence/);
 assert.match(ui,/useState<Mode>\('report'\)/);
 assert.match(ui,/Building condition report/);
 assert.match(ui,/Sensor readings available/);
 assert.match(ui,/Monitoring areas/);
 assert.match(ui,/Latest reading/);
 assert.match(ui,/No reading/);
 assert.match(ui,/active\(twin\.readings/);
 assert.match(ui,/Current conditions|Understand building conditions/);
 assert.match(ui,/Recorded events|Recent activity/);
});

test('Report, forecast, investigate and archive are independently accessible without dropping functionality',()=>{
 assert.match(ui,/id:'report',label:'Report'/);
 assert.match(ui,/id:'forecast',label:'Forecast'/);
 assert.match(ui,/id:'investigate',label:'Investigate'/);
 assert.match(ui,/onEvidenceArchive/);
 assert.match(outer,/Back to Building intelligence/);
 assert.match(outer,/Building evidence archive/);
 assert.match(ui,/api\/assistant\/agentic/);
 assert.match(ui,/Agentic retrieval trace/);
 assert.match(ui,/Evidence inspected/);
 assert.match(ui,/Model assumptions/);
 assert.match(ui,/One-month forecast/);
 assert.match(ui,/exploratory_scenario/);
 assert.match(ui,/api\/assistant\/health/);
 assert.match(ui,/qwen3:4b/);
 assert.match(ui,/qwen3:1\.7b/);
});

test('Results remain grounded and do not silently turn synthetic AI outputs into fault diagnoses or daily forecasts',()=>{
 assert.match(ui,/not a fault diagnosis/);
 assert.match(ui,/not a confirmed fault/i);
 assert.match(ui,/not calibrated confidence intervals/);
 assert.match(ui,/does not represent intermediate predictions/);
 assert.match(ui,/forecast_model/);
 assert.match(ui,/Source|source/);
 assert.match(ui,/Historical replay/);
 assert.match(ui,/readings\.filter|twin\.history\.filter/);
 assert.match(ui,/selectedRoom/);
 assert.match(css,/\.bi-split/);
 assert.match(css,/@media\(max-width:540px\)/);
 assert.match(routes,/agentic\/:task/);
 assert.match(bridge,/\/agentic-investigate/);
 assert.match(bridge,/\/agentic-forecast/);
 assert.match(server,/registerBuildingAssistant/);
 assert.match(server,/registerRoomAssistant/);
});
