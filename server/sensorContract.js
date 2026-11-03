import fs from 'node:fs';
export const registry = JSON.parse(fs.readFileSync(new URL('../shared/sensorRegistry.json', import.meta.url),'utf8'));
const byCode = new Map(registry.map(p=>[p.code,p]));
export function normalizeReadings(body) {
 const batch = Array.isArray(body?.readings) ? body.readings : [body];
 if (!batch.length || batch.length > 18) throw new Error('Expected 1–18 readings');
 const keys = new Set();
 return batch.map(r=>{
  const point = byCode.get(r?.sensor_id);
  if (!point || r.room_id !== point.simulatorRoomId) throw new Error('Unknown sensor/location');
  if (typeof r.value !== 'number' || !Number.isFinite(r.value) || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) throw new Error('Invalid value or timestamp');
  if ((r.unit !== undefined && r.unit !== point.unit) || (r.sensor_type !== undefined && r.sensor_type !== point.sensorType)) throw new Error('Sensor type/unit mismatch');
  if (keys.has(point.code)) throw new Error('Duplicate sensor in batch');
  keys.add(point.code);
  return {point_code:point.code,value:r.value,timestamp:new Date(r.timestamp).toISOString(),quality:'synthetic',source:'http',location_code:point.assetId,simulator_room_id:point.simulatorRoomId,ifc_global_id:point.guid};
 });
}
