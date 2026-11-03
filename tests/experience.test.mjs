import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {demoHistory,readingsAt,scenarioReadings,comfort,PRESETS} from '../src/services/experienceMath.js';
const points=JSON.parse(fs.readFileSync(new URL('../shared/sensorRegistry.json',import.meta.url)));
const end=Date.parse('2026-11-02T12:00:00Z');
test('guided history spans 24 hours and overlapping windows retain identical readings',()=>{
 const a=demoHistory(points,end),b=demoHistory(points,end+900000);
 assert.equal(a.length,97*18);
 assert.equal(Date.parse(a.at(-1).timestamp)-Date.parse(a[0].timestamp),86400000);
 const shared=new Map(a.map(r=>[r.point_code+r.timestamp,r.value]));
 for(const row of b)if(shared.has(row.point_code+row.timestamp))assert.equal(row.value,shared.get(row.point_code+row.timestamp));
 const co2=a.filter(r=>r.point_code==='CO2-L03-MEET-01').map(r=>r.value);
 assert.ok(Math.max(...co2)-Math.min(...co2)>600);
});
test('replay only shows readings known at the selected time',()=>{
 const rows=demoHistory(points,end),time=end-3600000,readings=readingsAt(rows,time);
 assert.equal(Object.keys(readings).length,18);
 for(const row of Object.values(readings))assert.ok(Date.parse(row.timestamp)<=time);
 assert.deepEqual(readingsAt(rows,end-90000000),{});
});
test('scenario changes selected-room environmental readings without mutating baseline',()=>{
 const base=readingsAt(demoHistory(points,end),end),copy=structuredClone(base);
 const after=scenarioReadings(base,points,'L03-MEET',PRESETS.meeting,1);
 const roomCO2=points.find(p=>p.assetId==='L03-MEET'&&p.sensorType==='co2');
 assert.ok(after[roomCO2.code].value>base[roomCO2.code].value);
 for(const p of points.filter(p=>p.assetId!=='L03-MEET'&&p.sensorType!=='power'))assert.deepEqual(after[p.code],base[p.code]);
 assert.deepEqual(base,copy);
});
test('comfort remains unavailable without environmental sensors',()=>{
 const readings=readingsAt(demoHistory(points,end),end);
 assert.equal(comfort(points,readings,'L05-ELEC').score,null);
 assert.equal(comfort(points,{},'L02-OPEN').score,null);
 assert.ok(comfort(points,readings,'L02-OPEN').score>=0);
});
