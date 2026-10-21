import { db } from "./data/dataStore.js";
import { LEVEL5_SENSORS, LEVEL5_UNLOCATED_POINTS } from "./data/level5Sensors.js";
import { getSensorCardState } from "./data/level5SensorCards.js";

const esc = value => String(value ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

export function sensorMiniGridHtml(selectedGuid = null, now = Date.now(), selectedVirtualId = null) {
  const allSensors = [
    ...LEVEL5_SENSORS,
    ...LEVEL5_UNLOCATED_POINTS.map(point => ({
      sensorId:point.sensorId, pointCodes:[point.pointCode], assetId:point.assetId,
      label:point.label + " · No BIM marker", guid:null, virtual:true
    }))
  ];
  return allSensors.map(sensor => {
    const data = getSensorCardState(sensor, {
      readings:db.Sensor_Readings,
      points:db.Sensor_Points,
      anomalies:db.Anomaly_Results
    },now);
    const active = sensor.virtual
      ? sensor.sensorId === selectedVirtualId
      : sensor.guid === selectedGuid;
    const entries = data.matches.map(({pointCode,point,reading}) => {
      const number = reading?.value == null ? null : Number(reading.value);
      const value = number == null || !Number.isFinite(number)
        ? "—" : pointCode === "FS-501A"
          ? (number === 1 ? "ON" : number === 0 ? "OFF" : "—")
          : number.toLocaleString(undefined,{maximumFractionDigits:2});
      const label = pointCode;
      return '<span class="bim-mini-reading" data-mini-point="'+esc(pointCode)+'">' +
        '<span title="'+esc(point?.measurement_type || pointCode)+'">'+esc(label)+'</span>' +
        '<strong>'+esc(value)+' <small>'+esc(pointCode === "FS-501A" ? "" : point?.unit || "")+'</small></strong></span>';
    }).join("") || '<span class="bim-mini-no-point">No channel in new dataset</span>';
    return '<button type="button" class="bim-mini-card '+(active?'is-selected':'')+
      '" data-sensor-mini="'+esc(sensor.sensorId)+'" data-status="'+esc(data.status)+
      '" data-unlocated="'+String(Boolean(sensor.virtual))+
      '" aria-pressed="'+active+'" title="'+esc(data.statusText)+' · Click to focus sensor in BIM">' +
      '<span class="bim-mini-card-top"><span class="bim-mini-dot" aria-hidden="true"></span>' +
      '<strong>'+esc(sensor.sensorId)+'</strong><span class="bim-mini-asset">'+esc(sensor.assetId)+'</span></span>' +
      '<span class="bim-mini-label">'+esc(sensor.label)+'</span>' +
      '<span class="bim-mini-readings">'+entries+'</span>' +
      '<span class="bim-mini-status">'+esc(data.statusText)+'</span></button>';
  }).join("");
}

export function sensorMiniOverviewHtml(selectedGuid = null, selectedVirtualId = null) {
  return '<section class="bim-sensor-overview" aria-label="Level 5 sensor overview">'+
    '<div class="bim-sensor-overview-head"><div><strong>Sensor overview</strong><span>9 sensor points · 8 selectable BIM markers</span></div>'+
    '<span class="bim-sensor-note">Green = recent simulated reading, not verified equipment health</span></div>'+
    '<div class="bim-mini-grid">'+sensorMiniGridHtml(selectedGuid,Date.now(),selectedVirtualId)+'</div>'+
    '<div class="bim-sensor-feedback" role="status" aria-live="polite" data-sensor-feedback></div></section>';
}

export function refreshMiniOverview(selectedGuid = null, selectedVirtualId = null) {
  const grid = document.querySelector(".bim-sensor-overview .bim-mini-grid");
  if (!grid) return;
  // Update in place so frequent MQTT messages do not steal keyboard focus
  // or interrupt a user clicking a sensor card.
  const next = document.createElement("div");
  next.innerHTML = sensorMiniGridHtml(selectedGuid,Date.now(),selectedVirtualId);
  const oldCards = Array.from(grid.querySelectorAll("[data-sensor-mini]"));
  const newCards = Array.from(next.querySelectorAll("[data-sensor-mini]"));
  if (oldCards.length !== newCards.length) {
    grid.innerHTML = next.innerHTML;
    return;
  }
  oldCards.forEach((card, i) => {
    const updated = newCards[i];
    if (card.dataset.sensorMini !== updated.dataset.sensorMini) return;
    card.dataset.status = updated.dataset.status;
    card.title = updated.title;
    const active = updated.getAttribute("aria-pressed") === "true";
    card.setAttribute("aria-pressed", String(active));
    card.classList.toggle("is-selected", active);
    const values = card.querySelector(".bim-mini-readings");
    const nextValues = updated.querySelector(".bim-mini-readings");
    if (values && nextValues) values.innerHTML = nextValues.innerHTML;
    const status = card.querySelector(".bim-mini-status");
    if (status) status.textContent = updated.querySelector(".bim-mini-status")?.textContent || "";
  });
}
