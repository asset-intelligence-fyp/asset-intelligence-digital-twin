import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('AI merge does not accidentally claim nine-point Level 5 as whole-building backend',()=>{
 const readme=readFileSync('README.md','utf8');
 const packageJson=JSON.parse(readFileSync('package.json','utf8'));
 const scripts=JSON.stringify(packageJson.scripts||{});
 assert.match(readme,/whole-building 18-sensor app/);
 assert.match(scripts,/sensorServer\.js/);
 assert.ok(existsSync('server/sensorServer.js'));
 assert.ok(existsSync('server/aiRoutes.js'));
});
