import test from 'node:test';
import assert from 'node:assert/strict';
import {presetPatch,scenarioActive,observedScenario,effectiveWeatherScene,weatherSceneLabel} from '../src/services/simulationControlView.js';
test('rain preset changes only weather and leaves schedule, step, ventilation and AC settings alone',()=>{
 const draft={weather_mode:'clear',calendar_mode:'workday',step_seconds:300,attendance_factor:1.5,ac_mode:'on',setpoint_c:23,ventilation:1.6};
 const request=presetPatch('rain',draft);
 const applied={...draft,...request};
 assert.deepEqual(Object.keys(request).sort(),['fault','paused','weather_mode']);
 assert.equal(applied.weather_mode,'rain');
 assert.equal(applied.step_seconds,300);
 assert.equal(applied.calendar_mode,'workday');
 assert.equal(applied.attendance_factor,1.5);
 assert.equal(applied.ventilation,1.6);
 assert.equal(applied.ac_mode,'on');
 assert.equal(scenarioActive('rain',applied),true);
 assert.equal(scenarioActive('busy',applied),true);
});
test('normal resets the reference operating controls but preserves accelerated clock speed',()=>{
 const d=presetPatch('normal',{step_seconds:300});
 assert.equal(d.weather_mode,'auto');assert.equal(d.calendar_mode,'auto');
 assert.equal(d.step_seconds,300);assert.equal(d.attendance_factor,1);
});
test('accepted control and new observed telemetry are different statuses',()=>{
 const before={sequence:10,simulation:{weather:{mode:'auto',scene:'night',rainfall_mm_per_h:0}}};
 const newData={sequence:11,simulation:{weather:{mode:'rain',scene:'night',rainfall_mm_per_h:4.2}}};
 assert.equal(observedScenario('rain',before),false);
 assert.equal(observedScenario('rain',newData),true);
 assert.equal(effectiveWeatherScene(newData.simulation.weather),'rain');
 assert.equal(weatherSceneLabel(newData.simulation.weather),'Rainy night');
 assert.equal(effectiveWeatherScene(before.simulation.weather),'night');
});
