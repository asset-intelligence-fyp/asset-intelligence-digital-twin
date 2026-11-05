import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/components/AssistantPlaceholder.tsx','utf8');
const styles=readFileSync('src/room-assistant-modern.css','utf8');
const entry=readFileSync('src/main.tsx','utf8');
test('current whole-building room assistant exposes distinct analysis and prediction endpoints',()=>{
 assert.match(ui,/\/api\/assistant\/ask/);
 assert.match(ui,/\/api\/assistant\/predict/);
 assert.match(ui,/\+24 hours/);
 assert.match(ui,/Only|historical baseline estimate/i);
});
test('chat messages persist locally per room and can be opened or deleted',()=>{
 assert.match(ui,/localStorage\.getItem\(HISTORY_KEY\)/);
 assert.match(ui,/localStorage\.setItem\(HISTORY_KEY/);
 assert.match(ui,/roomId===t\.selectedRoom/);
 assert.match(ui,/Conversation history/);
 assert.match(ui,/Delete conversation/);
 assert.match(ui,/New chat/);
});
test('panel offers expand and pointer resize controls with responsive styles',()=>{
 assert.match(ui,/onPointerDown=\{resizeStart\}/);
 assert.match(ui,/setExpanded/);
 assert.match(styles,/twin-ai-expanded/);
 assert.match(styles,/@media\(max-width:740px\)/);
 assert.match(entry,/room-assistant-modern\.css/);
});
test('assessment displays summary, current verified facts, check suggestions and optional technical audit',()=>{
 for(const x of ['Summary','Recommended checks','Measurements and historical evidence','Technical validation and trace','Download evidence'])
  assert.ok(ui.includes(x),`missing UI segment: ${x}`);
});
