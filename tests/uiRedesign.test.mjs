import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { db } from "../src/data/dataStore.js";
import {
  heading, banner, metrics, chart, overviewDetails,
  monitoring, forecasting, historical, simulator, settings
} from "../src/redesignViews.js";
import { getSavedTheme, THEME_KEY } from "../src/theme.js";

test("light/dark/system theme preference supports browser storage", () => {
  const storage = {getItem:key=>key===THEME_KEY?"dark":null};
  assert.equal(getSavedTheme(storage), "dark");
  assert.equal(getSavedTheme({getItem:()=> "incorrect"}), "system");
  assert.equal(getSavedTheme({getItem(){throw Error("denied")}}), "system");
});

test("all redesigned views show honest empty-state messaging without backend data", () => {
  for (const key of Object.keys(db)) db[key] = [];
  assert.match(heading("Overview","Test"), /Overview/);
  assert.match(banner("Local simulation","No physical feed"), /Local simulation/);
  assert.match(metrics([["HRU assets",3],["Sensors",8],["Channels",9]]), /9/);
  assert.match(chart(["SAT-507"]), /No historical readings/);
  assert.match(monitoring(), /Sensor Monitoring/);
  assert.match(monitoring(), /No data/);
  assert.match(forecasting(15,"SAT-507"), /No trained forecasting model connected/);
  assert.match(forecasting(15,"SAT-507"), /No model predictions available/);
  assert.match(historical(), /No historical records loaded/);
  assert.match(simulator(), /no physical equipment is controlled/i);
  assert.match(settings("light",{status:"connected"}), /data-appearance-option="dark"/);
  assert.match(overviewDetails(), /AI forecasting/);
});

test("monitoring view renders actual mapped values and all nine point codes", () => {
  const codes = ["SAT-501A","MAT-501A","FS-501A","SAT-504","DP-504",
    "DPCMD-504","SAT-507","CV-507","S-L5-008-TEMP"];
  db.Sensor_Points = codes.map((point_code,i)=>({
    point_code,sensor_id:"S"+i,measurement_type:"Test measurement",unit:"°C"
  }));
  db.Sensors = codes.map((point_code,i)=>({
    sensor_id:"S"+i,asset_id:i<3?"HRU501A":i<6?"HRU504":"HRU507"
  }));
  db.Sensor_Readings = [{point_code:"SAT-501A",value:22.3,quality:"simulated",timestamp:"2026-10-21T00:00:00Z"}];
  const markup = monitoring();
  for(const code of codes)assert.ok(markup.includes(code), "Missing channel "+code);
  assert.match(markup,/22\.3/);
  assert.match(markup,/simulated/);
});

test("redesigned navigation and CSS are included without replacing xeokit or SSE", () => {
  const index=fs.readFileSync("index.html","utf8");
  const main=fs.readFileSync("src/main.js","utf8");
  const css=fs.readFileSync("src/ui-redesign.css","utf8");
  assert.match(index,/ui-redesign\.css/);
  for(const route of ["/bim-viewer","/sensor-data","/historical-data","/simulator","/model-results","/settings"]) {
    assert.ok(main.includes(route));
  }
  assert.match(main,/initViewer\("mainViewer"\)/);
  assert.match(main,/new EventSource/);
  assert.match(css,/data-theme="dark"/);
  assert.match(css,/data-theme="light"/);
});
