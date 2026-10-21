import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { db } from "../src/data/dataStore.js";
import { LEVEL5_SENSORS } from "../src/data/level5Sensors.js";
import { getSensorCardState } from "../src/data/level5SensorCards.js";
import { sensorMiniGridHtml, sensorMiniOverviewHtml } from "../src/bimSensorUI.js";

const now = Date.parse("2026-10-21T02:00:00Z");
const sample = LEVEL5_SENSORS[0];
const dataFor = (readings=[], anomalies=[]) => ({
 readings, anomalies, points:[{point_code:sample.pointCodes[0],unit:"°C",measurement_type:"Temperature"}]
});

test("eight original BIM cards remain while the new room sensor has one active channel", () => {
 for(const key of Object.keys(db))db[key]=[];
 const markup = sensorMiniOverviewHtml();
 assert.equal((markup.match(/data-sensor-mini=/g)||[]).length,8);
 for(const sensor of LEVEL5_SENSORS)assert.match(markup,new RegExp(sensor.sensorId));
 assert.ok(markup.includes("S-L5-008-TEMP"));
 assert.ok(!markup.includes('data-mini-point="S-L5-008-HUM"'));
 assert.ok(!markup.includes('data-mini-point="S-L5-008-CO2"'));
 assert.match(markup,/not verified equipment health/);
});
test("green indicates RECENT telemetry only, not confirmed healthy equipment", () => {
 const value = getSensorCardState(sample,dataFor([
  {point_code:sample.pointCodes[0],value:21.8,latest_update:"2026-10-21T01:59:00Z",quality:"simulated"}
 ]),now);
 assert.equal(value.status,"recent");
 assert.match(value.statusText,/Recent simulated/);
});
test("unavailable and old measurements are gray, without synthetic values", () => {
 assert.equal(getSensorCardState(sample,dataFor(),now).status,"offline");
 assert.equal(getSensorCardState(sample,dataFor([
  {point_code:sample.pointCodes[0],value:17.2,timestamp:"2026-10-20T02:00:00Z"}
 ]),now).status,"offline");
});
test("stored high severity anomaly gives red, unrelated anomaly does not", () => {
 const reading={point_code:sample.pointCodes[0],value:23,timestamp:"2026-10-21T01:59:00Z"};
 const alert={point_code:sample.pointCodes[0],severity:"High",anomaly_status:"New"};
 assert.equal(getSensorCardState(sample,dataFor([reading],[alert]),now).status,"critical");
 assert.equal(getSensorCardState(sample,dataFor([reading],[{...alert,point_code:"SAT-507"}]),now).status,"recent");
 assert.equal(getSensorCardState(sample,dataFor([reading],[{...alert,anomaly_status:"Closed"}]),now).status,"recent");
});
test("unchanged air-velocity BIM markers correctly show no new dataset point", () => {
 for (const id of ["S-L5-002","S-L5-004","S-L5-007"]) {
   const sensor=LEVEL5_SENSORS.find(s=>s.sensorId===id);
   assert.deepEqual(sensor.pointCodes,[]);
   assert.equal(getSensorCardState(sensor,{readings:[],points:[],anomalies:[]},now).status,"offline");
 }
 const html=sensorMiniGridHtml(null,now);
 assert.match(html,/No channel in new dataset/);
});

test("room temperature retains S-L5-008 GUID and the new room point", () => {
 const room=LEVEL5_SENSORS.find(s=>s.sensorId==="S-L5-008");
 assert.deepEqual(room.pointCodes,["S-L5-008-TEMP"]);
 for(const key of Object.keys(db))db[key]=[];
 db.Sensor_Points=[{point_code:"S-L5-008-TEMP",unit:"°C"}];
 db.Sensor_Readings=[{point_code:"S-L5-008-TEMP",value:22.1,timestamp:"2026-10-21T01:59:00Z"}];
 const markup=sensorMiniGridHtml(room.guid,now);
 assert.match(markup,/22.1/);
 assert.match(markup,/aria-pressed="true"/);
 assert.equal(getSensorCardState(room,{
   points:db.Sensor_Points, readings:db.Sensor_Readings, anomalies:[]
 },now).status,"recent");
});

test("actual xeokit selection, and live incremental UI updates remain wired", () => {
 const main=fs.readFileSync("src/main.js","utf8");
 const css=fs.readFileSync("src/ui-redesign.css","utf8");
 assert.match(main,/activeBimController\.selectSensor\(sensor\.guid\)/);
 assert.match(main,/refreshMiniOverview\(selection\.entityId\)/);
 assert.match(main,/refreshMiniOverview\(state\.selectedBimElement\?\.entityId\)/);
 assert.match(main,/data-bim-sensor-tree/);
 assert.match(main,/initViewer\("mainViewer"\)/);
 assert.match(css,/bim-workspace\.bim-three-column/);
 assert.match(css,/top-status-group/);
 assert.match(css,/top-icon-group/);
 assert.match(css,/user-copy/);
});
