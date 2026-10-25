import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {db} from "../src/data/dataStore.js";
import {LEVEL5_SENSORS, LEVEL5_UNLOCATED_POINTS} from "../src/data/level5Sensors.js";
import {getSensorCardState} from "../src/data/level5SensorCards.js";
import {sensorMiniGridHtml,sensorMiniOverviewHtml} from "../src/bimSensorUI.js";

const now=Date.parse("2026-10-21T02:00:00Z");
const first=LEVEL5_SENSORS[0];
const dataFor=(readings=[],anomalies=[])=>({readings,anomalies,points:[]});

test("all NINE sensor cards show; eight refer to real IFC markers and FS is virtual",()=>{
 for(const key of Object.keys(db))db[key]=[];
 const html=sensorMiniOverviewHtml();
 assert.equal((html.match(/data-sensor-mini=/g)||[]).length,9);
 for(const sensor of LEVEL5_SENSORS)assert.ok(html.includes('data-sensor-mini="'+sensor.sensorId+'"'));
 assert.match(html,/data-sensor-mini="FS-501A"/);
 assert.match(html,/No BIM marker/);
 assert.match(html,/8 selectable BIM markers/);
});

test("recent simulated data = green, missing or stale = gray",()=>{
 const fresh={point_code:first.pointCodes[0],value:21.8,latest_update:"2026-10-21T01:59:00Z",quality:"simulated"};
 assert.equal(getSensorCardState(first,dataFor([fresh]),now).status,"recent");
 assert.equal(getSensorCardState(first,dataFor([]),now).status,"offline");
 assert.equal(getSensorCardState(first,dataFor([{...fresh,latest_update:"2026-10-20T01:59:00Z"}]),now).status,"offline");
});

test("stored point-specific high anomaly is red; unrelated or resolved anomaly does not spill",()=>{
 const reading={point_code:first.pointCodes[0],value:23,timestamp:"2026-10-21T01:59:00Z"};
 const alert={point_code:first.pointCodes[0],severity:"High",anomaly_status:"New"};
 assert.equal(getSensorCardState(first,dataFor([reading],[alert]),now).status,"critical");
 assert.equal(getSensorCardState(first,dataFor([reading],[{...alert,point_code:"CV-507"}]),now).status,"recent");
 assert.equal(getSensorCardState(first,dataFor([reading],[{...alert,anomaly_status:"Closed"}]),now).status,"recent");
});

test("MAT, DPCMD, CV, and room temperature all use original BIM mapping with one updated point",()=>{
 for(const id of ["MAT-501A","DPCMD-504","CV-507","S-L5-008-TEMP"]){
  const sensor=LEVEL5_SENSORS.find(s=>s.sensorId===id);
  assert.ok(sensor);
  assert.deepEqual(sensor.pointCodes,[sensor.sensorId]);
 }
 for(const key of Object.keys(db))db[key]=[];
 const room=LEVEL5_SENSORS.find(s=>s.sensorId==="S-L5-008-TEMP");
 db.Sensor_Points=[{point_code:room.sensorId,unit:"°C"}];
 db.Sensor_Readings=[{point_code:room.sensorId,value:22.1,timestamp:"2026-10-21T01:59:00Z"}];
 const html=sensorMiniGridHtml(room.guid,now);
 assert.match(html,/22.1/);
 assert.match(html,/aria-pressed="true"/);
});

test("virtual fan status is shown as ON/OFF but never assigned a fake IFC marker",()=>{
 assert.deepEqual(LEVEL5_UNLOCATED_POINTS.map(x=>x.pointCode),["FS-501A"]);
 for(const key of Object.keys(db))db[key]=[];
 db.Sensor_Points=[{point_code:"FS-501A",unit:"ON/OFF"}];
 db.Sensor_Readings=[{point_code:"FS-501A",value:1,timestamp:"2026-10-21T01:59:00Z"}];
 const html=sensorMiniGridHtml(null,now,"FS-501A");
 assert.match(html,/data-sensor-mini="FS-501A"/);
 assert.match(html,/>ON <small>/);
 assert.match(html,/data-unlocated="true"/);
 assert.match(html,/aria-pressed="true"/);
});

test("BIM cards select existing GUID; FS-501A opens a virtual inspector",()=>{
 const main=fs.readFileSync("src/main.js","utf8");
 const css=fs.readFileSync("src/ui-redesign.css","utf8");
 assert.match(main,/activeBimController\.selectSensor\(sensor\.guid\)/);
 assert.match(main,/refreshMiniOverview\(selection\.entityId\)/);
 assert.match(main,/state\.selectedVirtualSensorId = virtual\.sensorId/);
 assert.match(main,/getSensorById/);
 assert.match(main,/aria-label="Level 5 live sensor list"/);
 assert.match(main,/data-sensor-list-filter/);
 assert.match(css,/bim-tree-column/);
 assert.match(css,/bim-workspace\.bim-three-column/);
});

test("BIM viewer uses nine vertical status rows on left; center contains BIM only",()=>{
 const main=fs.readFileSync("src/main.js","utf8");
 const css=fs.readFileSync("src/ui-redesign.css","utf8");
 const page=main.slice(main.indexOf("function renderBimViewer()"),main.indexOf("function assetsTableRows()"));
 const left=page.indexOf('<aside class="bim-tree-column panel"');
 const rows=page.indexOf('sensorMiniOverviewHtml(');
 const middle=page.indexOf('<div class="bim-center-column">');
 const viewer=page.indexOf('viewerPanelHtml({stageId:"mainViewer"');
 const inspector=page.indexOf('assetInspectorHtml({detailed:true})');
 assert.ok(left>=0 && rows>left && middle>rows && viewer>middle && inspector>viewer);
 assert.equal(page.split('sensorMiniOverviewHtml(').length-1,1);
 assert.ok(main.includes('if (stageId === "mainViewer") {'));
 assert.ok(!page.includes("data-bim-sensor-tree"));
 assert.ok(css.includes(".bim-tree-column .bim-mini-grid {\n  display:flex;flex:1;flex-direction:column"));
 assert.ok(css.includes(".bim-center-column>.viewer-panel {display:flex;flex:1"));
});

test("left-side live sensor list retains search, selection, and in-place updates",()=>{
 for(const key of Object.keys(db))db[key]=[];
 const html=sensorMiniOverviewHtml();
 assert.ok(html.includes("data-sensor-list-filter"));
 assert.equal((html.match(/data-sensor-mini=/g)||[]).length,9);
 assert.ok(html.includes("data-mapping-count"));
 assert.ok(html.includes("data-sensor-feedback"));
 const main=fs.readFileSync("src/main.js","utf8");
 const css=fs.readFileSync("src/ui-redesign.css","utf8");
 assert.ok(main.includes('region.querySelectorAll("[data-sensor-mini]")'));
 assert.ok(main.includes("activeBimController.selectSensor(sensor.guid)"));
 assert.ok(main.includes("state.selectedVirtualSensorId = virtual.sensorId"));
 assert.ok(main.includes("refreshMiniOverview(state.selectedBimElement?.entityId"));
 assert.ok(css.includes(".bim-tree-column .bim-mini-card[hidden]"));
});
