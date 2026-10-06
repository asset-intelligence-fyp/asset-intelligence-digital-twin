// PostgreSQL-backed client-side data cache.
// The dashboard loads these arrays from GET /api/bootstrap at startup.

export const db = {
  BIM_Models: [],
  Buildings: [],
  Building_Floors: [],
  Spaces: [],
  Assets: [],
  Maintenance_Events: [],
  Sensors: [],
  Sensor_Points: [],
  Sensor_Readings: [],
  Historical_Sensor_Readings: [],
  Anomaly_Results: [],
  Alerts_Status: [],
  Alerts_Severity: [],
  Alerts: []
};

export const connectionState = {
  status: "connecting",
  source: "PostgreSQL",
  database: "digital_twin",
  loadedAt: null,
  error: null
};

export async function loadDatabaseFromApi() {
  connectionState.status = "connecting";
  connectionState.error = null;

  const response = await fetch("/api/bootstrap", {
    headers: { Accept: "application/json" }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail || payload.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  for (const key of Object.keys(db)) {
    db[key] = Array.isArray(payload.data?.[key]) ? payload.data[key] : [];
  }

  connectionState.status = "connected";
  connectionState.source = payload.meta?.source || "PostgreSQL";
  connectionState.database = payload.meta?.database || "digital_twin";
  connectionState.loadedAt = payload.meta?.loaded_at || new Date().toISOString();
  return payload;
}

export async function updateAnomalyStatus(anomalyId, status) {
  const response = await fetch(`/api/anomalies/${Number(anomalyId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ status })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  await loadDatabaseFromApi();
  return payload;
}

export const modelEvaluationDemo = {
  deployed: {
    name: "Multivariate Autoencoder",
    version: "AE-v1.3",
    purpose: "Multivariate sensor anomaly detection",
    status: "Demo configuration"
  },
  metrics: [
    { label: "Accuracy", value: "—", note: "Awaiting labelled evaluation" },
    { label: "Precision", value: "—", note: "Awaiting labelled evaluation" },
    { label: "Recall", value: "—", note: "Awaiting labelled evaluation" },
    { label: "F1", value: "—", note: "Awaiting labelled evaluation" },
    { label: "False Alarms", value: "—", note: "Awaiting labelled evaluation" },
    { label: "Detection Delay", value: "—", note: "Awaiting labelled evaluation" }
  ],
  comparison: [
    { model: "Autoencoder", purpose: "Anomaly detection", version: "AE-v1.3", precision: "—", recall: "—", f1: "—", deployment: "Demo configuration" },
    { model: "BOCPD", purpose: "Change-point detection", version: "—", precision: "—", recall: "—", f1: "—", deployment: "Not connected" },
    { model: "ANN", purpose: "Fault classification", version: "—", precision: "—", recall: "—", f1: "—", deployment: "Not connected" },
    { model: "SVM", purpose: "Fault classification", version: "—", precision: "—", recall: "—", f1: "—", deployment: "Not connected" }
  ]
};

export function getSpace(spaceId) {
  return db.Spaces.find(
    (row) => String(row.space_id) === String(spaceId)
  ) || null;
}

export function getFloor(floorId) {
  return db.Building_Floors.find(
    (row) => String(row.floor_id) === String(floorId)
  ) || null;
}

export function getAssetById(assetId) {
  return db.Assets.find(
    (row) => String(row.asset_id) === String(assetId)
  ) || null;
}

export function getAssetByName(name) {
  return db.Assets.find(
    (row) => row.asset_name === name
  ) || null;
}

export function getSensorsForAsset(assetId) {
  return db.Sensors.filter(
    (row) => String(row.asset_id ?? row.equipment_code) === String(assetId)
  );
}

export function getSensorById(sensorId) {
  return db.Sensors.find(
    (row) => String(row.sensor_id ?? row.sensor_code) === String(sensorId)
  ) || null;
}

export function getSensorByBimId(globalId) {
  if (!globalId) return null;
  return db.Sensors.find(
    (row) => String(row.ifc_global_id ?? row.global_id) === String(globalId)
  ) || null;
}

export function getAssetByBimId(globalId) {
  if (!globalId) return null;
  return db.Assets.find(
    (row) => String(row.ifc_global_id ?? row.global_id) === String(globalId)
  ) || null;
}

export function getSensorPoints(sensorId) {
  return db.Sensor_Points.filter(
    (row) => String(row.sensor_id ?? row.sensor_code) === String(sensorId)
  );
}

export function getReading(pointCode) {
  return db.Sensor_Readings.find(
    (row) => String(row.point_code ?? row.sensor_id) === String(pointCode)
  ) || null;
}

export function getSensorCurrentValues(sensorId) {
  return getSensorPoints(sensorId).map((point) => ({
    ...point,
    sensor_type: point.measurement_type ?? point.sensor_type,
    reading: getReading(point.point_code ?? point.sensor_id)
  }));
}

export function getAssetCurrentValues(assetId) {
  const sensors = getSensorsForAsset(assetId);

  if (db.Sensor_Points.length) {
    return sensors.flatMap((sensor) =>
      getSensorCurrentValues(sensor.sensor_id ?? sensor.sensor_code).map((point) => ({
        ...point,
        sensor_id: point.point_code ?? point.sensor_id,
        physical_sensor_id: sensor.sensor_id ?? sensor.sensor_code,
        sensor_name: sensor.sensor_name,
        sensor: sensor
      }))
    );
  }

  // Compatibility with the original one-row-per-measurement demo schema.
  return sensors.map((sensor) => ({
    ...sensor,
    reading: getReading(sensor.sensor_id ?? sensor.sensor_code)
  }));
}

export function getAnomaliesForAsset(assetId) {
  const sensors = getSensorsForAsset(assetId);
  const sensorIds = new Set(
    sensors.map((sensor) => String(sensor.sensor_id ?? sensor.sensor_code))
  );
  const pointIds = new Set(
    sensors.flatMap((sensor) =>
      getSensorPoints(sensor.sensor_id ?? sensor.sensor_code)
        .map((point) => String(point.point_code))
    )
  );

  return db.Anomaly_Results.filter((row) => {
    const sensorRef = row.sensor_id ?? row.sensor_code;
    const pointRef = row.point_code;
    return sensorIds.has(String(sensorRef)) || pointIds.has(String(pointRef ?? sensorRef));
  });
}

export function getAssetContext(asset) {
  if (!asset) return null;

  const space = getSpace(asset.space_id);
  const floor = space ? getFloor(space.floor_id) : null;
  const readings = getAssetCurrentValues(asset.asset_id);

  const anomalies = getAnomaliesForAsset(asset.asset_id)
    .slice()
    .sort((a, b) =>
      String(b.timestamp).localeCompare(String(a.timestamp))
    );

  return {
    asset,
    space,
    floor,
    readings,
    anomalies
  };
}

export function getLatestAnomalyRows() {
  return db.Anomaly_Results.map((anomaly) => {
    const point = db.Sensor_Points.find(
      (p) => String(p.point_code) === String(anomaly.point_code ?? anomaly.sensor_id)
    );
    const sensor = point
      ? getSensorById(point.sensor_id ?? point.sensor_code)
      : getSensorById(anomaly.sensor_id ?? anomaly.sensor_code);
    const asset = sensor ? getAssetById(sensor.asset_id ?? sensor.equipment_code) : null;
    const space = asset ? getSpace(asset.space_id) : null;
    const floor = space ? getFloor(space.floor_id) : null;
    return { ...anomaly, point, sensor, asset, space, floor };
  }).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function parseTimestamp(timestamp) {
  if (!timestamp) return null;
  // PostgreSQL TIMESTAMP values are intentionally treated as local demonstration times.
  const normalized = String(timestamp).includes("T") ? String(timestamp) : String(timestamp).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(timestamp) {
  const date = parseTimestamp(timestamp);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : (timestamp || "—");
}

export function formatShortTime(timestamp) {
  const date = parseTimestamp(timestamp);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (timestamp || "—");
}

export function applyLiveReading(
  incoming
) {

  if (!incoming?.point_code) {
    return;
  }


  const currentReading = {
    point_code:
      incoming.point_code,

    latest_update:
      incoming.latest_update ??
      incoming.timestamp,

    value:
      incoming.value,

    quality:
      incoming.quality
  };


  const index =
    db.Sensor_Readings.findIndex(
      (row) =>
        String(row.point_code) ===
        String(incoming.point_code)
    );


  if (index >= 0) {

    db.Sensor_Readings[index] =
      currentReading;

  } else {

    db.Sensor_Readings.push(
      currentReading
    );
  }


  // Also keep a short browser-side history.
  db.Historical_Sensor_Readings.push({
    point_code:
      incoming.point_code,

    timestamp:
      incoming.timestamp ??
      incoming.latest_update,

    value:
      incoming.value,

    quality:
      incoming.quality
  });


  // Prevent unlimited browser memory growth.
  if (
    db.Historical_Sensor_Readings.length >
    5000
  ) {

    db.Historical_Sensor_Readings.splice(
      0,
      db.Historical_Sensor_Readings.length -
      5000
    );
  }
}