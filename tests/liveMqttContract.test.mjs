import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_POINT_ASSETS, LIVE_PROVENANCE, validateLiveMqttMessage } from "../server/liveMqttContract.js";
const payload = (point_code,asset_id) => ({
 timestamp:"2026-10-21T04:00:00+00:00",source_timestamp:"2026-07-01 10:45:00",
 point_code,sensor_id:point_code,asset_id,
 reading_type:"simulated",unit:"°C",quality:"simulated",value:point_code==="FS-501A"?1:23.3,
 sequence:1, generation_mode:"independent_simulation",provenance:LIVE_PROVENANCE
});
test("all nine replacement ZIP readings match active database identities", () => {
 assert.equal(Object.keys(LIVE_POINT_ASSETS).length,9);
 for(const [code,asset] of Object.entries(LIVE_POINT_ASSETS)) {
   const check=validateLiveMqttMessage(`dt/${asset}/${code}`,payload(code,asset));
   assert.equal(check.ok,true,`${code} ${check.reason}`);
 }
});
test("old hru-simulator-v2 and eleven-point publisher are rejected", () => {
 const msg=payload("SAT-507","HRU507");
 delete msg.provenance;
 assert.match(validateLiveMqttMessage("dt/HRU507/SAT-507",msg).reason,/publisher/);
 assert.equal(validateLiveMqttMessage("dt/HRU507/S-L5-008-HUM",payload("S-L5-008-HUM","HRU507")).ok,false);
 assert.equal(validateLiveMqttMessage("dt/HRU507/S-L5-008-CO2",payload("S-L5-008-CO2","HRU507")).ok,false);
});
test("reject wrong topic, wrong asset and invalid values", () => {
 const msg=payload("SAT-504","HRU504");
 assert.equal(validateLiveMqttMessage("dt/HRU501A/SAT-504",msg).ok,false);
 assert.equal(validateLiveMqttMessage("dt/HRU504/SAT-504",{...msg,asset_id:"HRU507"}).ok,false);
 assert.equal(validateLiveMqttMessage("dt/HRU504/SAT-504",{...msg,value:NaN}).ok,false);
 const fan=payload("FS-501A","HRU501A");
 assert.equal(validateLiveMqttMessage("dt/HRU501A/FS-501A",{...fan,value:2}).ok,false);
 const valve=payload("CV-507","HRU507");
 assert.equal(validateLiveMqttMessage("dt/HRU507/CV-507",{...valve,value:101}).ok,false);
});

