/**
 * Viewer-only sensor status derived from the same demo thresholds used by the
 * automatic alert service. This is not an LLM fault diagnosis.
 *
 * Acknowledged alerts remain abnormal until recovered; human acknowledgement
 * does not change the underlying sensor condition. Manual test-only events do
 * not colour the BIM as a detected physical anomaly.
 */
export function sensorHealth(point,reading,events,definitions,activity='receiving'){
 const unresolved=events.some(e=>e.point_code===point.code&&!e.resolved_at&&(e.automatic||e.synthetic===false));
 if(unresolved)return 'abnormal';
 if(!reading||!Number.isFinite(reading.value)||reading.quality==='missing'||activity==='missing'||activity==='stale')return 'unavailable';
 const value=reading.value;
 const limits=definitions[point.sensorType]||{};
 if(point.sensorType==='water_leakage'&&value===1)return 'abnormal';
 if(Number.isFinite(limits.high)&&value>limits.high)return 'abnormal';
 if(Number.isFinite(limits.low)&&value<limits.low)return 'abnormal';
 return 'normal';
}
