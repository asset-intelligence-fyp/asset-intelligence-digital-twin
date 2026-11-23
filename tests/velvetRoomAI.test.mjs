import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../src/components/RoomAIWorkspace.tsx',import.meta.url),'utf8');
const outer=readFileSync(new URL('../src/components/AssistantWorkspace.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/sensorServer.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../server/roomAssistant.js',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../llm_service/bridge.py',import.meta.url),'utf8');

test('New Agentic RAG is the default while the old building evidence view remains available for rollback',()=>{
 assert.match(outer,/Building evidence \(legacy\)/);
 assert.match(outer,/Agentic RAG \+ 1-month forecast/);
 assert.match(outer,/useState<'building'\|'room'>\('room'\)/);
 assert.match(outer,/RoomAIWorkspace/);
 assert.match(ui,/api\/assistant\/agentic/);
 assert.match(ui,/Agent retrieval trace/);
 assert.match(ui,/Evidence inspected/);
 assert.match(ui,/Forecast \+1 month/);
 assert.match(ui,/exploratory_scenario/);
 assert.match(ui,/api\/assistant\/health/);
 assert.match(routes,/agentic\/:task/);
 assert.match(bridge,/\/agentic-investigate/);
 assert.match(bridge,/\/agentic-forecast/);
 assert.match(server,/registerBuildingAssistant/);
 assert.match(server,/registerRoomAssistant/);
});
