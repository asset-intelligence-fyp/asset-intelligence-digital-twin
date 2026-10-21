import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {LEVEL5_SENSORS,LEVEL5_UNLOCATED_POINTS,LEVEL5_PROFILE_POINTS} from "../src/data/level5Sensors.js";

const migration=fs.readFileSync("database/seed_level5_nine_point_profile.sql","utf8");
const backend=fs.readFileSync("server/index.js","utf8");
const mini=fs.readFileSync("src/bimSensorUI.js","utf8");
const main=fs.readFileSync("src/main.js","utf8");

const expected=[
 "SAT-501A","MAT-501A","FS-501A",
 "SAT-504","DP-504","DPCMD-504",
 "SAT-507","CV-507","S-L5-008-TEMP"
];
const oldPoints=["AF-501A","AF-504","AF-507","S-L5-008-HUM","S-L5-008-CO2"];

test("the current nine point names and HRU associations match the supplied dataset",()=>{
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.pointCode),expected);
 assert.equal(new Set(expected).size,9);
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.assetId),[
  "HRU501A","HRU501A","HRU501A",
  "HRU504","HRU504","HRU504",
  "HRU507","HRU507","HRU507"
 ]);
 assert.deepEqual(LEVEL5_PROFILE_POINTS.map(p=>p.unit),[
  "°C","°C","ON/OFF","°C","%","%","°C","%","°C"
 ]);
});

test("all eight original physical BIM GlobalIds are preserved verbatim",()=>{
 assert.deepEqual(LEVEL5_SENSORS.map(s=>s.guid),[
  "2kuK4GGyjA5QV8NiAnXeXZ",
  "3gW6u2ne59c8oABDoS7b3j",
  "3gW6u2ne59c8oABDoS7bB3",
  "3iie255UfEvg3mun9qVzgx",
  "050uZGzlP8Yg9H1S$ofK0i",
  "050uZGzlP8Yg9H1S$ofKIe",
  "050uZGzlP8Yg9H1S$ofKRW",
  "1Rnvr0S6DA0x5eK1Aa66rR"
 ]);
 for(const id of ["S-L5-002","S-L5-004","S-L5-007"]){
   const s=LEVEL5_SENSORS.find(x=>x.sensorId===id);
   assert.deepEqual(s.pointCodes,[]);
 }
});

test("new non-BIM telemetry stays asset linked, never mislabeled as existing physical sensors",()=>{
 assert.deepEqual(LEVEL5_UNLOCATED_POINTS.map(x=>x.pointCode),[
  "MAT-501A","FS-501A","DPCMD-504","CV-507"
 ]);
 for(const p of LEVEL5_PROFILE_POINTS){
   const physical=LEVEL5_SENSORS.find(s=>s.pointCodes.includes(p.pointCode));
   const virtual=LEVEL5_UNLOCATED_POINTS.find(s=>s.pointCode===p.pointCode);
   assert.equal(Boolean(physical)+Boolean(virtual),1,"exactly one mapping for "+p.pointCode);
   assert.equal((physical||virtual).assetId,p.assetId);
   assert.equal((physical||virtual).sensorId,p.sensorId);
 }
});

test("migration is non-destructive and retires old channel names",()=>{
 assert.match(migration,/BEGIN;/);
 assert.match(migration,/COMMIT;/);
 assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|DELETE)\b\s+(?:FROM\s+|TABLE\s+)/i);
 assert.match(migration,/point_status='Inactive'/);
 for(const id of expected)assert.ok(migration.includes("'"+id+"'"),"new point "+id);
 for(const id of oldPoints)assert.ok(migration.includes("'"+id+"'"),"archived point "+id);
 assert.match(migration,/ON CONFLICT \(point_code\) DO UPDATE/);
 assert.match(migration,/VIRTUAL-MAT-501A/);
 assert.match(migration,/VIRTUAL-DPCMD-504/);
 assert.match(migration,/VIRTUAL-CV-507/);
});

test("backend only ingests and bootstraps Online points, while old history remains stored",()=>{
 assert.match(backend,/sp\.point_status = 'Online'/);
 assert.match(backend,/WHERE point_status = 'Online'/);
 assert.match(backend,/INSERT INTO sensor_readings/);
 assert.match(backend,/broadcastLiveEvent\(/);
 assert.match(mini,/8 physical BIM markers · 9 active channels/);
 assert.match(main,/Related HRU telemetry · no physical BIM marker/);
});
