import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(file,'utf8');
const data=read('src/services/twin.tsx');
const contract=read('server/liveMqttContract.js');
const py=read('tools/twinlabs_random_mqtt.py');
test('same nine active sensor points in React, Node and random publisher',()=>{
 const codes=['SAT-501A','MAT-501A','FS-501A','SAT-504','DP-504','DPCMD-504','SAT-507','CV-507','S-L5-008-TEMP'];
 for(const c of codes){assert.match(data,new RegExp(c));assert.match(contract,new RegExp(c));assert.ok(py.includes(c));}
 assert.equal((data.match(/guid:'[0-9A-Za-z$]{22}'/g)||[]).length,8);
 assert.match(data,/FS-501A.*guid:null/);
});
test('random test publisher does not falsely claim calibrated simulator provenance',()=>{
 assert.match(py,/SYNTHETIC_RANDOM_WALK_NINE_POINT/);
 assert.match(py,/random_walk_simulation/);
 assert.match(contract,/SYNTHETIC_RANDOM_WALK_NINE_POINT/);
 assert.match(contract,/STATEFUL_SYNTHETIC_TRAIN_CALIBRATED_THREE_HRU/);
});
test('functional backend integration and live chart wiring exist',()=>{
 assert.match(data,/fetch\('\/api\/bootstrap'/);
 assert.match(data,/EventSource\('\/api\/events'\)/);
 assert.match(data,/fetch\(`\/api\/anomalies/);
 assert.match(read('src/components/TelemetryChart.tsx'),/history\.filter/);
 assert.match(read('src/components/DemoBuilding.tsx'),/XeokitViewer/);
 assert.match(read('src/viewer/XeokitViewer.tsx'),/initXeokitViewer/);
 assert.match(read('install-into-repo.sh'),/Snowdon_Level5_Model\+HVAC\.xkt/);
 assert.doesNotMatch(read('src/main.tsx'),/Assistant/);
});
