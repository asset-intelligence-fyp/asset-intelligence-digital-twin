// Visual telemetry status for the eight physical BIM sensors.
// A green dot means a recent simulated reading without an OPEN, MATCHING
// database anomaly record; it does not certify physical equipment health.
export const SENSOR_FRESHNESS_MS = 5 * 60 * 1000;

function readingTime(reading) {
  const stamp = reading?.latest_update ?? reading?.timestamp ?? reading?.reading_timestamp;
  if (!stamp) return null;
  const parsed = Date.parse(String(stamp));
  return Number.isFinite(parsed) ? parsed : null;
}
export function getSensorCardState(sensor, data, now = Date.now(), freshnessMs = SENSOR_FRESHNESS_MS) {
  const points = sensor.pointCodes || [];
  const matches = points.map(code => ({
    pointCode: code,
    point: (data.points || []).find(p => String(p.point_code) === code),
    reading: (data.readings || []).find(r => String(r.point_code ?? r.sensor_id) === code)
  }));
  const active = (data.anomalies || []).filter(row => {
    const status = String(row.anomaly_status ?? row.status ?? "").toLowerCase();
    if (["closed", "resolved", "dismissed"].includes(status)) return false;
    const ref = String(row.point_code ?? "");
    const sid = String(row.sensor_id ?? row.sensor_code ?? "");
    return points.includes(ref) || points.includes(sid) || sid === sensor.sensorId;
  });
  const severities = active.map(r => String(r.severity ?? r.severity_name ?? "").toLowerCase());
  const hasCritical = severities.some(s => ["critical", "high"].includes(s));
  const hasAnomaly = active.length > 0;
  const latest = matches.map(entry => readingTime(entry.reading)).filter(t => t != null);
  // A multi-channel device (the ABB sensor) is only green when ALL of its
  // channels are recent; one healthy CO2 value cannot hide missing humidity.
  const recent = matches.length > 0 && matches.every(entry => {
    const t = readingTime(entry.reading);
    return t != null && t <= now + 60_000 && now - t >= -60_000 && now - t <= freshnessMs;
  });
  const invalid = matches.some(entry => entry.reading &&
    ["bad", "invalid", "error", "fault"].includes(String(entry.reading.quality || "").toLowerCase()));
  const status = hasAnomaly ? (hasCritical ? "critical" : "warning") :
    invalid ? "warning" : recent ? "recent" : "offline";
  const statusText = points.length === 0 ? "No channel in current dataset" :
    hasAnomaly ? "Stored demo anomaly" :
    invalid ? "Invalid quality" : recent ? "Recent simulated data" : "No recent data";
  return { status, statusText, matches, latestTime:latest.length ? Math.max(...latest) : null };
}

