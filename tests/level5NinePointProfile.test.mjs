import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {LEVEL5_SENSORS,LEVEL5_UNLOCATED_POINTS,LEVEL5_PROFILE_POINTS} from "../src/data/level5Sensors.js";

const sql=fs.readFileSync("database/seed_level5_nine_point_profile.sql","utf8");
const backend=fs.readFileSync("server/index.js","utf8");
const main=fs.readFileSync("src/main.js","utf8");

const codes=["SAT-501A","MAT-501A","FS-501A","SAT-504","DP-504",
  "DPCMD-504","SAT-507","CV-507","S-L5-008-TEMP"];

const oldGuids=[
 "2kuK4GGyjA5QV8NiAnXeXZ",
 "3gW6u2ne59c8oABDoS7b3j",
 "3gW6u2ne59c8oABDoS7bB3",
 "3iie255UfEvg3mun9qVzgx",
 "050uZGzlP8Yg9H1S$ofK0i",
 "050uZGzlP8Yg9H1S$ofKIe",
 "050uZGzlP8Yg9H1S$ofKRW",
 "1Rnvr0S6DA0x5eK1Aa66rR"
];

test("nine updated sensor identifiers match the new CSV, preserving assets and units",()=>{
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.pointCode),codes);
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.sensorId),codes);
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.assetId),
 ["HRU501A","HRU501A","HRU501A","HRU504","HRU504","HRU504","HRU507","HRU507","HRU507"]);
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.unit),
 ["°C","°C","ON/OFF","°C","%","%","°C","%","°C"]);
});

test("eight renamed sensor IDs retain the exact original row-by-row physical IFC GlobalIds",()=>{
 assert.deepEqual(LEVEL5_SENSORS.map(x=>x.guid),oldGuids);
 assert.deepEqual(LEVEL5_SENSORS.map(x=>x.sensorId),
  ["SAT-501A","MAT-501A","SAT-504","DPCMD-504","DP-504","SAT-507","CV-507","S-L5-008-TEMP"]);
 assert.deepEqual(LEVEL5_SENSORS.map(x=>x.mark),
  ["S-L5-001","S-L5-002","S-L5-003","S-L5-004","S-L5-005","S-L5-006","S-L5-007","S-L5-008"]);
 for(const sensor of LEVEL5_SENSORS)assert.deepEqual(sensor.pointCodes,[sensor.sensorId]);
});

test("fan status is the only point without an original IFC GlobalId",()=>{
 assert.deepEqual(LEVEL5_UNLOCATED_POINTS.map(x=>x.pointCode),["FS-501A"]);
 assert.equal(LEVEL5_UNLOCATED_POINTS[0].assetId,"HRU501A");
 for(const p of LEVEL5_PROFILE_POINTS){
   const physical=LEVEL5_SENSORS.find(s=>s.pointCodes.includes(p.pointCode));
   const unlocated=LEVEL5_UNLOCATED_POINTS.find(s=>s.pointCode===p.pointCode);
   assert.equal(Number(Boolean(physical))+Number(Boolean(unlocated)),1,"Exactly one mapping for "+p.pointCode);
 }
});

test("database migration reassigns existing physical GUIDs without touching historical readings",()=>{
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
 assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+sensor_readings\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
 for(const guid of oldGuids)assert.ok(sql.includes("'"+guid+"'"),guid);
 for(const code of codes)assert.match(sql,new RegExp("\\('"+code+"','"+code+"'"));
 assert.match(sql,/point_status='Inactive'/);
 assert.match(sql,/VIRTUAL-FS-501A/);
 assert.doesNotMatch(sql,/VIRTUAL-MAT-501A|VIRTUAL-DPCMD-504|VIRTUAL-CV-507/);
});

test("backend loads active sensor IDs, preventing archived duplicate GUID mapping in inspector",()=>{
 assert.match(backend,/EXISTS\s*\(\s*SELECT 1 FROM sensor_points sp/);
 assert.match(backend,/sp\.point_status='Online'|sp\.point_status = 'Online'/);
 assert.match(backend,/INSERT INTO sensor_readings/);
 assert.match(backend,/broadcastLiveEvent/);
 assert.match(main,/selectedVirtualSensorId/);
 assert.match(main,/getSensorById/);
});

