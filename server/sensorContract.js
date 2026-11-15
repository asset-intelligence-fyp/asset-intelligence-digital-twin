import fs from 'node:fs';
export const registry = JSON.parse(fs.readFileSync(new URL('../shared/sensorRegistry.json', import.meta.url),'utf8'));
const definitions=JSON.parse(fs.readFileSync(new URL('../shared/sensorDefinitions.json',import.meta.url),'utf8'));
const byCode = new Map(registry.map(p=>[p.code,p]));
export function normalizeReadings(body) {
 const batch = Array.isArray(body?.readings) ? body.readings : [body];
 if (!batch.length || batch.length > 18) throw new Error('Expected 1–18 readings');
 const keys = new Set();
 return batch.map(r=>{
  const point = byCode.get(r?.sensor_id);
  if (!point || r.room_id !== point.simulatorRoomId) throw new Error('Unknown sensor/location');
  const missing=r.value===null&&r.quality_flag==='missing';
  if ((!missing&&(typeof r.value !== 'number' || !Number.isFinite(r.value))) || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) throw new Error('Invalid value or timestamp');
  if ((r.unit !== undefined && r.unit !== point.unit) || (r.sensor_type !== undefined && r.sensor_type !== point.sensorType)) throw new Error('Sensor type/unit mismatch');
  if (r.quality_flag==='missing'&&!missing) throw new Error('Missing quality requires NULL value');
  if (r.quality_flag!==undefined&&!['ok','missing'].includes(r.quality_flag)) throw new Error('Invalid source quality flag');
  if (!missing&&point.unit==='binary'&&r.value!==0&&r.value!==1) throw new Error('Invalid binary reading');
  const range=definitions[point.sensorType].range;
  if(!missing&&(r.value<range[0]||r.value>range[1]))throw new Error('Reading outside supported measurement range');
  if (keys.has(point.code)) throw new Error('Duplicate sensor in batch');
  keys.add(point.code);
  return {point_code:point.code,value:r.value,timestamp:new Date(r.timestamp).toISOString(),quality:missing?'missing':'synthetic',source:'http',location_code:point.assetId,simulator_room_id:point.simulatorRoomId,ifc_global_id:point.guid};
 });
}

