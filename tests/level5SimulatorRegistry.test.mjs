import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LIVE_POINT_ASSETS } from "../server/liveMqttContract.js";

const root=process.cwd();
const pythonContract=fs.readFileSync(root+"/tools/independent_3hru_live/scripts/mqtt_contract.py","utf8");
const seed=fs.readFileSync(root+"/database/seed_level5_nine_point_profile.sql","utf8");
const backend=fs.readFileSync(root+"/server/index.js","utf8");

test("only one supported live publisher implementation remains", () => {
 assert.equal(fs.existsSync(root+"/tools/hru_digital_twin_simulator_v2"),false);
 assert.equal(fs.existsSync(root+"/tools/level5_digital_twin_simulator_final"),false);
 assert.equal(fs.existsSync(root+"/tools/independent_3hru_live/scripts/simulate_live.py"),true);
});

test("Python MQTT topics and database mapping agree for all nine points", () => {
 const python=[...pythonContract.matchAll(/\("([^"]+)", "([^"]+)", "[^"]+", "[^"]+"\)/g)]
   .map(match=>[match[1],match[2]]);
 assert.equal(python.length,9);
 assert.deepEqual(Object.fromEntries(python),LIVE_POINT_ASSETS);
 for(const [code,asset] of python) {
   assert.ok(seed.includes("'"+code+"'"),"SQL registry missing "+code);
   assert.ok(seed.includes("'"+asset+"'"),"SQL asset missing "+asset);
 }
});

test("backend validates replacement stream before database insertion and emits SSE",()=>{
 assert.match(backend,/validateLiveMqttMessage\(topic, message\)/);
 assert.match(backend,/INSERT INTO sensor_readings/);
 assert.match(backend,/broadcastLiveEvent\(\s*"sensor-reading"/);
 assert.match(backend,/\/api\/live-status/);
});

