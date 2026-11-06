import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../src/components/RoomAIWorkspace.tsx',import.meta.url),'utf8');
const outer=readFileSync(new URL('../src/components/AssistantWorkspace.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/sensorServer.js',import.meta.url),'utf8');
test('Velvet preserves building evidence and exposes validated room AI and one-month forecast',()=>{
 assert.match(outer,/Building evidence/);
 assert.match(outer,/Qwen room AI \+ 1-month forecast/);
 assert.match(outer,/RoomAIWorkspace/);
 assert.match(ui,/\/api\/assistant\/ask/);
 assert.match(ui,/\/api\/assistant\/predict/);
 assert.match(ui,/\/api\/assistant\/health/);
 assert.match(ui,/\/api\/assistant\/evaluation/);
 assert.match(ui,/horizon_months:1/);
 assert.match(ui,/llm_projection/);
 assert.match(server,/registerBuildingAssistant/);
 assert.match(server,/registerRoomAssistant/);
});
