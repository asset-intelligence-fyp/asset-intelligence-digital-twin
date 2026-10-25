import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { db, applyLiveReading } from "../src/data/dataStore.js";
import { chart, refreshLiveCharts, overviewDetails, monitoring } from "../src/redesignViews.js";

function reset() { for (const key of Object.keys(db)) db[key] = []; }

test("the zero-data SVG placeholder becomes a chart when MQTT readings arrive", () => {
 reset();
 const initial=chart(["SAT-501A"]);
 assert.match(initial,/data-chart-codes="SAT-501A"/);
 assert.match(initial,/No readings available/);
 const node={dataset:{chartCodes:"SAT-501A"},innerHTML:""};
 const root={querySelectorAll(selector) {
   return selector==="[data-chart-codes]"?[node]:[];
 }};
 applyLiveReading({point_code:"SAT-501A",timestamp:"2026-10-21T04:00:00Z",value:18.2,quality:"simulated"});
 applyLiveReading({point_code:"SAT-501A",timestamp:"2026-10-21T04:01:00Z",value:19.1,quality:"simulated"});
 refreshLiveCharts(root);
 assert.match(node.innerHTML,/class="ai-chart"/);
 assert.match(node.innerHTML,/<polyline/);
 const before=node.innerHTML;
 applyLiveReading({point_code:"SAT-501A",timestamp:"2026-10-21T04:02:00Z",value:22.3,quality:"simulated"});
 refreshLiveCharts(root);
 assert.notEqual(node.innerHTML,before);
 assert.equal(db.Historical_Sensor_Readings.length,3);
});

test("live source-specific values refresh with chart and avoid whole-page rebuild", () => {
 reset();
 db.Sensor_Points=[{point_code:"SAT-504",sensor_id:"SAT-504",measurement_type:"Supply Air Temperature",unit:"°C"}];
 db.Sensors=[{sensor_id:"SAT-504",asset_id:"HRU504"}];
 const current={dataset:{liveCurrentCode:"SAT-504"},textContent:"—"};
 const caption={dataset:{livePlotCaption:"SAT-504"},textContent:"—"};
 const root={querySelectorAll(selector) {
   if(selector==="[data-live-current-code]")return [current];
   if(selector==="[data-live-plot-caption]")return [caption];
   return [];
 }};
 applyLiveReading({point_code:"SAT-504",timestamp:"2026-10-21T04:03:00Z",value:20.6,quality:"simulated"});
 refreshLiveCharts(root);
 assert.equal(current.textContent,"20.6 °C");
 assert.equal(caption.textContent,"SAT-504 20.6");
 assert.match(monitoring(),/data-live-plot-caption/);
 assert.match(overviewDetails(),/data-chart-codes/);
});

test("SSE schedules chart updates after mutating the cache", () => {
 const main=fs.readFileSync("src/main.js","utf8");
 const start=main.indexOf('liveEventSource.addEventListener(\n    "sensor-reading"');
 assert.ok(start>=0);
 const end=main.indexOf("liveEventSource.onerror",start);
 const handler=main.slice(start,end);
 assert.ok(handler.indexOf("applyLiveReading(") < handler.indexOf("scheduleLiveChartRefresh()"));
 assert.match(main,/refreshLiveCharts\(document\)/);
 assert.match(main,/200\);/);
});
