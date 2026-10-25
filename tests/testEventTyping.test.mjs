import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('newly created synthetic alert is explicitly typed as EventRecord', () => {
 const src=readFileSync('src/services/twin.tsx','utf8');
 assert.match(src,/const event: EventRecord = \{/);
 assert.match(src,/level: 'Warning'/);
 assert.match(src,/setEvents\(prev => \[event, \.\.\.prev\]\.slice\(0, 100\)\)/);
});
