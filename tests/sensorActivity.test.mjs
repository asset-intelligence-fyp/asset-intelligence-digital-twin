import test from 'node:test';
import assert from 'node:assert/strict';
import {sensorActivity,SENSOR_RECENT_MS} from '../src/viewer/sensorActivity.js';
const now=Date.parse('2026-11-06T00:00:00Z');
const reading={value:0,quality:'simulated',source:'http',timestamp:'2032-01-01T00:00:00Z',received_at_utc:new Date(now-5000).toISOString()};
test('Receipt age determines animation, independent of accelerated simulation time and zero values',()=>{
 assert.equal(sensorActivity(reading,{now}),'receiving');
 assert.equal(sensorActivity({...reading,timestamp:'2023-01-01T00:00:00Z'},{now}),'receiving');
 assert.equal(sensorActivity({...reading,value:900},{now}),'receiving');
});
test('Missing, historical and stored values never masquerade as receiving sensors',()=>{
 assert.equal(sensorActivity(null,{now}),'missing');
 assert.equal(sensorActivity({...reading,value:null},{now}),'missing');
 assert.equal(sensorActivity({...reading,quality:'missing'},{now}),'missing');
 assert.equal(sensorActivity(reading,{now,historical:true}),'historical');
 assert.equal(sensorActivity({...reading,source:'stored'},{now}),'stored');
 assert.equal(sensorActivity({...reading,source:'random'},{now}),'stored');
 assert.equal(sensorActivity({...reading,received_at_utc:undefined},{now}),'stored');
});
test('Pulses expire without further updates and reject future receipt clocks',()=>{
 assert.equal(sensorActivity(reading,{now:now+SENSOR_RECENT_MS}),'stale');
 assert.equal(sensorActivity({...reading,received_at_utc:new Date(now+1000).toISOString()},{now}),'stale');
 assert.equal(sensorActivity({...reading,received_at_utc:new Date(now-SENSOR_RECENT_MS).toISOString()},{now}),'stale');
});
