// The new nine-point PoC dataset assigns eight data-point identities to
// eight ORIGINAL Level 5 BIM IFC GlobalIds. The physical BIM geometry/GUIDs
// are unchanged; the reassignments below are requested logical associations,
// NOT independent verification that the installed device measures this quantity.
// Mark retains the original S-L5-00x row ID for provenance.
export const LEVEL5_SENSORS = Object.freeze([
  { sensorId:"SAT-501A", pointCodes:["SAT-501A"], mark:"S-L5-001",
    assetId:"HRU501A", guid:"2kuK4GGyjA5QV8NiAnXeXZ", label:"Supply-air temperature" },
  { sensorId:"MAT-501A", pointCodes:["MAT-501A"], mark:"S-L5-002",
    assetId:"HRU501A", guid:"3gW6u2ne59c8oABDoS7b3j", label:"Mixed-air temperature" },
  { sensorId:"SAT-504", pointCodes:["SAT-504"], mark:"S-L5-003",
    assetId:"HRU504", guid:"3gW6u2ne59c8oABDoS7bB3", label:"Supply-air temperature" },
  { sensorId:"DPCMD-504", pointCodes:["DPCMD-504"], mark:"S-L5-004",
    assetId:"HRU504", guid:"3iie255UfEvg3mun9qVzgx", label:"Outdoor-air damper command" },
  { sensorId:"DP-504", pointCodes:["DP-504"], mark:"S-L5-005",
    assetId:"HRU504", guid:"050uZGzlP8Yg9H1S$ofK0i", label:"Outdoor-air damper position" },
  { sensorId:"SAT-507", pointCodes:["SAT-507"], mark:"S-L5-006",
    assetId:"HRU507", guid:"050uZGzlP8Yg9H1S$ofKIe", label:"Supply-air temperature" },
  { sensorId:"CV-507", pointCodes:["CV-507"], mark:"S-L5-007",
    assetId:"HRU507", guid:"050uZGzlP8Yg9H1S$ofKRW", label:"Cooling-valve position" },
  { sensorId:"S-L5-008-TEMP", pointCodes:["S-L5-008-TEMP"], mark:"S-L5-008",
    assetId:"HRU507", guid:"1Rnvr0S6DA0x5eK1Aa66rR", label:"Unit 507 room temperature" }
]);

// The original asset list explicitly has no IFC GlobalId for FS-501A.
// It is still one of the NINE asset-linked points, but cannot be selected
// through real xeokit geometry. Do not fabricate a physical ninth marker.
export const LEVEL5_UNLOCATED_POINTS = Object.freeze([
  {pointCode:"FS-501A", sensorId:"FS-501A", assetId:"HRU501A",
    label:"Supply-fan status", unit:"ON/OFF", reason:"No IFC GlobalId in asset list"}
]);

export const LEVEL5_PROFILE_POINTS = Object.freeze([
  {pointCode:"SAT-501A", sensorId:"SAT-501A", assetId:"HRU501A", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"MAT-501A", sensorId:"MAT-501A", assetId:"HRU501A", label:"Mixed-air temperature", unit:"°C"},
  {pointCode:"FS-501A", sensorId:"FS-501A", assetId:"HRU501A", label:"Supply-fan status", unit:"ON/OFF"},
  {pointCode:"SAT-504", sensorId:"SAT-504", assetId:"HRU504", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"DP-504", sensorId:"DP-504", assetId:"HRU504", label:"Outdoor-air damper position", unit:"%"},
  {pointCode:"DPCMD-504", sensorId:"DPCMD-504", assetId:"HRU504", label:"Outdoor-air damper command", unit:"%"},
  {pointCode:"SAT-507", sensorId:"SAT-507", assetId:"HRU507", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"CV-507", sensorId:"CV-507", assetId:"HRU507", label:"Cooling-valve position", unit:"%"},
  {pointCode:"S-L5-008-TEMP", sensorId:"S-L5-008-TEMP", assetId:"HRU507", label:"Room temperature", unit:"°C"}
]);

export const LEVEL5_BY_GUID = new Map(LEVEL5_SENSORS.map(s=>[s.guid,s]));
export const LEVEL5_BY_SENSOR_ID = new Map(LEVEL5_SENSORS.map(s=>[s.sensorId,s]));
