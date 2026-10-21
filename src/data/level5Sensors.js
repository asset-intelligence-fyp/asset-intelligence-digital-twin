// Snowdon Towers Level 5 physical sensor registry, preserving all eight original
// IFC GlobalIds. Point mapping follows the NINE-point dataset supplied in Oct 2026.
// Unlocated measurements belong to an HRU asset but are NOT physical BIM sensors.
export const LEVEL5_SENSORS = Object.freeze([
  { sensorId:"S-L5-001", assetId:"HRU501A", guid:"2kuK4GGyjA5QV8NiAnXeXZ",
    label:"Supply-air temperature", pointCodes:["SAT-501A"] },
  { sensorId:"S-L5-002", assetId:"HRU501A", guid:"3gW6u2ne59c8oABDoS7b3j",
    label:"Air velocity (BIM marker; no current dataset channel)", pointCodes:[] },
  { sensorId:"S-L5-003", assetId:"HRU504", guid:"3gW6u2ne59c8oABDoS7bB3",
    label:"Supply-air temperature", pointCodes:["SAT-504"] },
  { sensorId:"S-L5-004", assetId:"HRU504", guid:"3iie255UfEvg3mun9qVzgx",
    label:"Air velocity (BIM marker; no current dataset channel)", pointCodes:[] },
  { sensorId:"S-L5-005", assetId:"HRU504", guid:"050uZGzlP8Yg9H1S$ofK0i",
    label:"Outdoor-air damper position", pointCodes:["DP-504"] },
  { sensorId:"S-L5-006", assetId:"HRU507", guid:"050uZGzlP8Yg9H1S$ofKIe",
    label:"Supply-air temperature", pointCodes:["SAT-507"] },
  { sensorId:"S-L5-007", assetId:"HRU507", guid:"050uZGzlP8Yg9H1S$ofKRW",
    label:"Air velocity (BIM marker; no current dataset channel)", pointCodes:[] },
  { sensorId:"S-L5-008", assetId:"HRU507", guid:"1Rnvr0S6DA0x5eK1Aa66rR",
    label:"Unit 507 room temperature", pointCodes:["S-L5-008-TEMP"] }
]);

// No real IFC GlobalId for any of these points in the supplied BIM sensor list.
// They are virtual/asset-level telemetry, not aliases of velocity or damper devices.
export const LEVEL5_UNLOCATED_POINTS = Object.freeze([
  {pointCode:"MAT-501A", sensorId:"MAT-501A", assetId:"HRU501A",
    label:"Mixed-air temperature", unit:"°C", reason:"No verified physical BIM marker"},
  {pointCode:"FS-501A", sensorId:"FS-501A", assetId:"HRU501A",
    label:"Supply-fan ON/OFF", unit:"ON/OFF", reason:"Virtual fan-status point"},
  {pointCode:"DPCMD-504", sensorId:"DPCMD-504", assetId:"HRU504",
    label:"Outdoor-air damper command", unit:"%", reason:"No verified IFC command actuator marker"},
  {pointCode:"CV-507", sensorId:"CV-507", assetId:"HRU507",
    label:"Cooling-valve position", unit:"%", reason:"No verified physical BIM marker"}
]);

export const LEVEL5_PROFILE_POINTS = Object.freeze([
  {pointCode:"SAT-501A", sensorId:"S-L5-001", assetId:"HRU501A", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"MAT-501A", sensorId:"MAT-501A", assetId:"HRU501A", label:"Mixed-air temperature", unit:"°C"},
  {pointCode:"FS-501A", sensorId:"FS-501A", assetId:"HRU501A", label:"Supply-fan status", unit:"ON/OFF"},
  {pointCode:"SAT-504", sensorId:"S-L5-003", assetId:"HRU504", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"DP-504", sensorId:"S-L5-005", assetId:"HRU504", label:"Outdoor-air damper position", unit:"%"},
  {pointCode:"DPCMD-504", sensorId:"DPCMD-504", assetId:"HRU504", label:"Outdoor-air damper command", unit:"%"},
  {pointCode:"SAT-507", sensorId:"S-L5-006", assetId:"HRU507", label:"Supply-air temperature", unit:"°C"},
  {pointCode:"CV-507", sensorId:"CV-507", assetId:"HRU507", label:"Cooling-valve position", unit:"%"},
  {pointCode:"S-L5-008-TEMP", sensorId:"S-L5-008", assetId:"HRU507", label:"Room temperature", unit:"°C"}
]);

export const LEVEL5_BY_GUID = new Map(LEVEL5_SENSORS.map(s => [s.guid,s]));
export const LEVEL5_BY_SENSOR_ID = new Map(LEVEL5_SENSORS.map(s => [s.sensorId,s]));
