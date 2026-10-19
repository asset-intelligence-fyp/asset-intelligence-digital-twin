// Level 5 asset registry transcribed from L5_Physical BIM Asset_List.csv.
// BIM GUIDs identify physical devices, not individual measurement channels.
// Current readings always come from PostgreSQL (via /api/bootstrap + /api/events).
export const LEVEL5_SENSORS = Object.freeze([
  { sensorId: "S-L5-001", assetId: "HRU501A", guid: "2kuK4GGyjA5QV8NiAnXeXZ", label: "Supply air temperature", pointCodes: ["SAT-501A"] },
  { sensorId: "S-L5-002", assetId: "HRU501A", guid: "3gW6u2ne59c8oABDoS7b3j", label: "Air velocity", pointCodes: ["AF-501A"] },
  { sensorId: "S-L5-003", assetId: "HRU504", guid: "3gW6u2ne59c8oABDoS7bB3", label: "Supply air temperature", pointCodes: ["SAT-504"] },
  { sensorId: "S-L5-004", assetId: "HRU504", guid: "3iie255UfEvg3mun9qVzgx", label: "Air velocity", pointCodes: ["AF-504"] },
  { sensorId: "S-L5-005", assetId: "HRU504", guid: "050uZGzlP8Yg9H1S$ofK0i", label: "Damper position", pointCodes: ["DP-504"] },
  { sensorId: "S-L5-006", assetId: "HRU507", guid: "050uZGzlP8Yg9H1S$ofKIe", label: "Supply air temperature", pointCodes: ["SAT-507"] },
  { sensorId: "S-L5-007", assetId: "HRU507", guid: "050uZGzlP8Yg9H1S$ofKRW", label: "Air velocity", pointCodes: ["AF-507"] },
  { sensorId: "S-L5-008", assetId: "HRU507", guid: "1Rnvr0S6DA0x5eK1Aa66rR", label: "ABB Fusion room sensor", pointCodes: ["S-L5-008-TEMP", "S-L5-008-HUM", "S-L5-008-CO2"] }
]);

export const LEVEL5_UNLOCATED_POINTS = Object.freeze([
  { pointCode: "FS-501A", assetId: "HRU501A", label: "Fan status", reason: "No physical IFC GlobalId in the supplied asset CSV" }
]);

export const LEVEL5_BY_GUID = new Map(LEVEL5_SENSORS.map((s) => [s.guid, s]));
export const LEVEL5_BY_SENSOR_ID = new Map(LEVEL5_SENSORS.map((s) => [s.sensorId, s]));
