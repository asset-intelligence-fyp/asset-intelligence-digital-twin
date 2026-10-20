import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registry = JSON.parse(
  fs.readFileSync(path.join(root, "tools/level5_digital_twin_simulator_final/config/level5_points.json"), "utf8")
);
const seed = fs.readFileSync(path.join(root, "database/seed_level5_sensor_registry.sql"), "utf8");
const backend = fs.readFileSync(path.join(root, "server/index.js"), "utf8");

const expected = new Set([
  "SAT-501A", "AF-501A", "FS-501A",
  "SAT-504", "AF-504", "DP-504",
  "SAT-507", "AF-507",
  "S-L5-008-TEMP", "S-L5-008-HUM", "S-L5-008-CO2"
]);

test("Level 5 simulator publishes exactly the 11 registered measurement points", () => {
  const all = registry.points.map(p => p.point_code);
  assert.equal(all.length, 11);
  assert.equal(new Set(all).size, 11);
  assert.deepEqual(new Set(all), expected);
});

test("simulator topics and physical sensor links match the PostgreSQL seed", () => {
  const entries = [...seed.matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)','Online'\)/g)];
  const pointToSensor = new Map(entries.map(match => [
    match[1], {sensor: match[2], measurement: match[3], unit: match[4]}
  ]));
  for (const point of registry.points) {
    assert.equal(point.topic, "dt/" + point.asset_id + "/" + point.point_code);
    const mapped = pointToSensor.get(point.point_code);
    assert.ok(mapped, "Missing PostgreSQL point: " + point.point_code);
    assert.equal(point.sensor_id, mapped.sensor, "Physical device mismatch: " + point.point_code);
    assert.equal(point.measurement_type, mapped.measurement);
    assert.equal(point.unit, mapped.unit);
  }
});

test("backend subscribes to all points and exposes sensor-reading SSE", () => {
  assert.match(backend, /"dt\/\+\/\+"/);
  assert.match(backend, /broadcastLiveEvent\(\s*"sensor-reading"/);
  assert.match(backend, /INSERT INTO sensor_readings/);
});
