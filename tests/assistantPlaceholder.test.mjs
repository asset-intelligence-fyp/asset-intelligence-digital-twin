import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const assistant=readFileSync('src/components/AssistantPlaceholder.tsx','utf8');
const shell=readFileSync('src/components/Shell.tsx','utf8');
const main=readFileSync('src/main.tsx','utf8');

test('current whole-building assistant is preserved rather than replaced by nine-point panel',()=>{
 assert.match(shell,/import \{ AssistantPlaceholder \} from '\.\/AssistantPlaceholder';/);
 assert.match(shell,/<AssistantPlaceholder\s*\/>/);
 assert.match(assistant,/\/api\/assistant\/health/);
 assert.match(assistant,/\/api\/assistant\/ask/);
 assert.match(assistant,/selectedRoom/);
 assert.match(assistant,/snapshot/);
 assert.doesNotMatch(shell,/AssistantPanel/);
});

test('whole-building navigation and search are not replaced by Level 5 HRU UI',()=>{
 assert.match(shell,/18 sensor points/);
 assert.match(main,/CommandPalette/);
 assert.match(main,/TEMP-L03-OPEN-01/);
});
