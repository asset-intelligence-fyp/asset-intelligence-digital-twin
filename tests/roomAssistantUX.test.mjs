import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/components/AssistantPlaceholder.tsx','utf8');
const css=readFileSync('src/room-assistant-modern.css','utf8');
const main=readFileSync('src/main.tsx','utf8');
test('current whole-building AI analysis is preserved and LLM-only longer projection is exposed',()=>{
 assert.match(ui,/\/api\/assistant\/ask/);assert.match(ui,/\/api\/assistant\/predict/);
 assert.match(ui,/>\+4 months</);assert.match(ui,/>\+1 year</);assert.match(ui,/>\+2 years</);
 assert.match(ui,/Speculative LLM trend projection/);assert.match(ui,/not a trained or validated forecasting model/);
});
test('chat history remains locally stored and per-room',()=>{
 for(const text of ['localStorage.getItem(HISTORY_KEY)','localStorage.setItem(HISTORY_KEY','roomId===t.selectedRoom','Conversation history','New chat','Delete conversation'])assert.ok(ui.includes(text));
});
test('chat panel still expands and resizes across devices',()=>{
 assert.match(ui,/onPointerDown=\{resizeStart\}/);assert.match(css,/twin-ai-expanded/);assert.match(css,/@media\(max-width:740px\)/);assert.match(main,/room-assistant-modern.css/);
});
test('projections only permitted for connected HTTP data and disclose evidence status',()=>{
 assert.match(ui,/source!==['"]http['"]/);
 assert.match(ui,/p.coverage\?\.historical_normal_days/);
 assert.match(ui,/Future numbers cannot be verified today/);
});
