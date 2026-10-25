import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component=readFileSync('src/components/AssistantPlaceholder.tsx','utf8');
const shell=readFileSync('src/components/Shell.tsx','utf8');
const css=readFileSync('src/styles.css','utf8');

test('AI Assistant placeholder is accessible on every page through the shared shell',()=>{
 assert.match(shell,/import \{ AssistantPlaceholder \} from '\.\/AssistantPlaceholder';/);
 assert.match(shell,/<AssistantPlaceholder\s*\/>/);
 assert.match(component,/className="ask-floating"/);
 assert.match(component,/className="assistant-panel twinlabs-assistant"/);
 assert.match(component,/aria-expanded=\{open\}/);
 assert.match(component,/role="dialog"/);
 assert.match(component,/aria-labelledby="twinlabs-assistant-title"/);
 assert.match(component,/id="twinlabs-ai-assistant"/);
 assert.match(css,/\.ask-floating\{position:fixed;right:23px;bottom:46px/);
 assert.match(css,/\.twinlabs-assistant \{/);
});

test('preview opens and closes by click or Escape without sending prompts',()=>{
 assert.match(component,/onClick=\{\(\) => open \? close\(\) : setOpen\(true\)\}/);
 assert.match(component,/event\.key === 'Escape'/);
 assert.match(component,/launcherRef\.current\?\.focus\(\)/);
 assert.match(component,/closeRef\.current\?\.focus\(\)/);
 assert.match(component,/Coming soon/);
 assert.match(component,/AI chat is not connected yet/);
 assert.match(component,/<input aria-label="Assistant message" type="text" disabled/);
 assert.match(component,/<button type="button" aria-label="Send message unavailable" disabled/);
 assert.doesNotMatch(component,/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendMessage\(/);
});
