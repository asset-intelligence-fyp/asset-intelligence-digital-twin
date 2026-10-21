import {
  db,
  modelEvaluationDemo,
  connectionState,
  loadDatabaseFromApi,
  updateAnomalyStatus,
  getAssetById,
  getAssetByName,
  getAssetContext,
  getLatestAnomalyRows,
  getSensorsForAsset,
  getSensorByBimId,
  getAssetByBimId,
  getSensorCurrentValues,
  getReading,
  formatShortTime,
  formatTime,
  applyLiveReading
} from "./data/dataStore.js";
import { initXeokitViewer, destroyActiveViewer } from "./xeokitViewer.js";
import { LEVEL5_SENSORS, LEVEL5_UNLOCATED_POINTS } from "./data/level5Sensors.js";
import { sensorMiniOverviewHtml, refreshMiniOverview } from "./bimSensorUI.js";
import { applyTheme, getSavedTheme, initAppearance } from "./theme.js";
import {
  heading, banner, metrics, overviewDetails, monitoring, forecasting,
  historical, simulator, settings
} from "./redesignViews.js";

initAppearance();

const app = document.getElementById("app");

document.addEventListener("fullscreenchange", () => {
  const expanded = Boolean(document.fullscreenElement?.matches?.("[data-bim-workspace]"));
  const button = document.querySelector("[data-viewer-fullscreen]");
  if (button) button.textContent = expanded ? "⤢ Exit full screen" : "⛶ Expand";
  // Xeokit canvas resizes with its CSS container; force a viewport update.
  window.dispatchEvent(new Event("resize"));
});

let liveEventSource = null;
let activeBimController = null;

const state = {
  selectedAssetId: "HRU501A",
  selectedBimElement: null,
  aiDrawerOpen: false,
  aiResponse: "",
  sensorAssetId: "HRU501A",
  sensorId: "SAT-501A",
  assetSearch: "",
  assetFloor: "all",
  anomalyStatus: "all",
  anomalyAsset: "all"
};

const NAV_ITEMS = [
  ["/", "▦", "Overview"],
  ["/bim-viewer", "◫", "BIM Viewer"],
  ["/sensor-data", "≋", "Sensor Monitoring"],
  ["/model-results", "⌁", "AI Forecasting"],
  ["/anomalies", "△", "Anomaly Detection"],
  ["/historical-data", "▤", "Historical Data"],
  ["/simulator", "▷", "Sensor Simulator"],
  ["/settings", "⚙", "Settings"],
  ["/assets", "◇", "Assets"],
  ["assistant", "□", "AI Assistant"]
];
const ROUTE_TITLES = {
  "/": "Overview",
  "/bim-viewer": "BIM Viewer",
  "/assets": "Assets",
  "/sensor-data": "Sensor Monitoring",
  "/model-results": "AI Forecasting",
  "/anomalies": "Anomaly Detection",
  "/historical-data": "Historical Data",
  "/simulator": "Sensor Simulator",
  "/settings": "Settings"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pathName() {
  return window.location.pathname || "/";
}

function go(path) {
  if (path === pathName()) {
    render();
    return;
  }
  history.pushState({}, "", path);
  render();
}

function currentNavPath(path) {
  if (path.startsWith("/assets")) return "/assets";
  return path;
}

function statusClass(value) {
  const s = String(value || "").toLowerCase();
  if (["normal", "running", "open", "online", "completed"].includes(s)) return "normal";
  if (["review", "medium", "warning", "scheduled"].includes(s)) return "review";
  if (["new", "anomaly", "high"].includes(s)) return "anomaly";
  if (["critical", "fault", "offline"].includes(s)) return "critical";
  if (["closed", "acknowledged"].includes(s)) return "closed";
  return "closed";
}

function statusPill(value, label = value) {
  return `<span class="status-pill ${statusClass(value)}"><span class="status-dot ${statusClass(value) === "normal" ? "green" : statusClass(value) === "critical" ? "red" : "orange"}"></span>${escapeHtml(label)}</span>`;
}

function shell(pageHtml, { activePath = pathName(), breadcrumb = ROUTE_TITLES[pathName()] || "Workspace", noScroll = false } = {}) {
  const navPath = currentNavPath(activePath);
  const activeAlerts = db.Alerts.filter((a) => ["New", "Review"].includes(a.alert_status)).length;
  const nav = NAV_ITEMS.map(([path, glyph, label]) => {
    const isAssistant = path === "assistant";
    const active = isAssistant ? state.aiDrawerOpen : navPath === path;
    const badge = label === "Anomalies / Faults" && activeAlerts ? `<span class="nav-badge">${activeAlerts}</span>` : "";
    return `<button class="nav-item ${active ? "active" : ""}" data-nav="${path}">
      <span class="nav-glyph">${glyph}</span><span class="nav-text">${label}</span>${badge}
    </button>`;
  }).join("");

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div class="brand-copy">
            <div class="brand-title">Digital Twin</div>
            <div class="brand-subtitle">Asset Intelligence</div>
          </div>
        </div>
        <button type="button" class="sidebar-location" data-nav="/bim-viewer" title="Open Level 5 BIM Viewer">Building / Level 5 &nbsp;⌄</button>
        <div class="sidebar-label">Asset Intelligence</div>
        <nav class="nav" aria-label="Primary navigation">${nav}</nav>
        <div class="system-status">
          <div class="sidebar-note"><strong>Demo workspace</strong>
            Simulated sources only. No physical building sensors connected.</div>
          <div class="workspace-user"><span class="avatar">FM</span>
            <div class="workspace-user-copy">Facility Manager<small>Prototype workspace</small></div>
          </div>
        </div>
      </aside>

      <header class="topbar">
        <div class="breadcrumb"><strong>Digital Twin / Asset Intelligence</strong> &nbsp; / &nbsp; Building / Level 5 &nbsp; / &nbsp; ${escapeHtml(breadcrumb)}</div>
        <div class="search-wrap"><input class="global-search" id="globalSearch" placeholder="Search asset, sensor or location…" /></div>
        <div class="top-actions">
          <div class="top-status-group" aria-label="Data source status">
            <span class="live-chip">Local simulation</span>
            <span class="top-updated">PostgreSQL · ${escapeHtml(connectionState.status)}</span>
          </div>
          <div class="top-icon-group">
            <button class="icon-button" data-theme-toggle type="button" aria-label="Toggle light and dark appearance" title="Change appearance">☾</button>
            <button class="icon-button" id="notificationButton" type="button" title="Anomalies" aria-label="View anomaly records">♧</button>
          </div>
          <button class="user-button" id="userButton" type="button" title="Open account options">
            <span class="avatar">FM</span>
            <span class="user-copy"><strong>Facility Manager</strong><small>Demo workspace</small></span>
            <span class="user-caret" aria-hidden="true">⌄</span>
          </button>
        </div>
      </header>

      <main class="content ${noScroll ? "no-scroll" : ""}" id="mainContent">${pageHtml}</main>
    </div>
    ${state.aiDrawerOpen ? assistantDrawerHtml() : ""}
  `;

  bindShellEvents();
  applyTheme(getSavedTheme());
}

function bindShellEvents() {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.nav;
      if (target === "assistant") {
        state.aiDrawerOpen = true;
        render();
      } else {
        go(target);
      }
    });
  });

  document.getElementById("notificationButton")?.addEventListener("click", () => go("/anomalies"));
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(current === "dark" ? "light" : "dark", {persist:true});
  });
  document.querySelectorAll("[data-route]").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.route)));
  document.getElementById("userButton")?.addEventListener("click", () => go("/login"));

  const search = document.getElementById("globalSearch");
  search?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const q = search.value.trim().toUpperCase();
    const asset = db.Assets.find((a) => a.asset_name.toUpperCase().includes(q));
    if (asset) {
      state.selectedAssetId = asset.asset_id;
      go(`/assets/${asset.asset_id}`);
    }
  });

  bindAssistantDrawer();
}

function pageHeading({ eyebrow, title, subtitle, actions = "" }) {
  return `<div class="page-heading-row">
    <div>
      <div class="eyebrow">${escapeHtml(eyebrow)}</div>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <p class="page-subtitle">${escapeHtml(subtitle)}</p>
    </div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

function selectedAssetContext() {
  return getAssetContext(getAssetById(state.selectedAssetId)) || getAssetContext(db.Assets[0]);
}

function assetAnomalyStatus(assetId) {
  const context = getAssetContext(getAssetById(assetId));
  const active = context?.anomalies?.find((a) => ["New", "Review", "Acknowledged"].includes(a.anomaly_status));
  if (!active) return "Normal";
  return active.anomaly_status === "Review" ? "Review" : "Anomaly";
}

function readingByType(context, type) {
  const item = context?.readings?.find((r) =>
    String(r.sensor_type ?? r.measurement_type).toLowerCase() === String(type).toLowerCase()
  );
  return item?.reading ? `${item.reading.value} ${item.unit || ""}`.trim() : "—";
}

function latestReadingTimestamp(context = null) {
  const rows = context
    ? context.readings.map((r) => r.reading).filter(Boolean)
    : db.Sensor_Readings;
  const timestamps = rows.map((r) => r.latest_update ?? r.timestamp).filter(Boolean).sort();
  return timestamps.at(-1) || null;
}

function selectedSensor() {
  const entityId = state.selectedBimElement?.entityId;
  return entityId ? getSensorByBimId(entityId) : null;
}

function sensorInspectorHtml(sensor, { detailed = false } = {}) {
  const sensorId = sensor.sensor_id ?? sensor.sensor_code;
  const assetId = sensor.asset_id ?? sensor.equipment_code;
  const asset = getAssetById(assetId);
  const assetContext = asset ? getAssetContext(asset) : null;
  const points = getSensorCurrentValues(sensorId);
  const latestTimestamp = points
    .map((point) => point.reading?.latest_update ?? point.reading?.timestamp)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  const readingsHtml = points.length
    ? `<div class="bim-selected-reading-grid">${points.map((point) => {
        const reading = point.reading;
        const number = reading?.value == null ? null : Number(reading.value);
        const value = number == null || !Number.isFinite(number) ? "—"
          : number.toLocaleString(undefined, {maximumFractionDigits:2});
        return `<div class="bim-selected-reading">
          <span>${escapeHtml(point.measurement_type ?? point.sensor_type ?? point.point_code)}</span>
          <strong>${escapeHtml(value)} <small>${escapeHtml(point.unit || "")}</small></strong>
          <em>${escapeHtml(reading?.quality || "No data")} · ${escapeHtml(formatTime(reading?.latest_update ?? reading?.timestamp))}</em>
        </div>`;
      }).join("")}</div>`
    : `<div class="section-meta">No measurement points or current readings are stored for this sensor.</div>`;

  const qualityRows = points
    .filter((point) => point.reading?.quality)
    .map((point) => `${point.measurement_type}: ${point.reading.quality}`)
    .join(" · ");

  return `<section class="panel asset-inspector">
    <div class="panel-header">
      <div class="section-title">Selected Sensor</div>
      <div class="section-meta"><span class="status-dot ${statusClass(sensor.status) === "normal" ? "green" : "orange"}"></span>POSTGRESQL</div>
    </div>

    <div class="asset-inspector-body">
      <div class="asset-title-row">
        <div class="asset-icon-box">◉</div>
        <div class="asset-title-copy">
          <div class="asset-name">${escapeHtml(sensor.sensor_name || sensorId)}</div>
          <div class="asset-type">${escapeHtml(sensor.model || "Physical sensor")}</div>
        </div>
        ${statusPill(sensor.status || "Unknown")}
      </div>

      <div class="info-section">
        <div class="info-heading">Identification</div>
        <div class="info-row"><span class="info-key">Sensor ID</span><span class="info-value mono">${escapeHtml(sensorId)}</span></div>
        <div class="info-row"><span class="info-key">BIM Element ID</span><span class="info-value mono">${escapeHtml(sensor.ifc_global_id || sensor.global_id || state.selectedBimElement?.entityId || "—")}</span></div>
        <div class="info-row"><span class="info-key">Linked Asset</span><span class="info-value">${escapeHtml(asset?.asset_name || assetId || "—")}</span></div>
        <div class="info-row"><span class="info-key">Location</span><span class="info-value">${escapeHtml(assetContext?.space?.space_name || "—")}</span></div>
        <div class="info-row"><span class="info-key">Floor</span><span class="info-value">${escapeHtml(assetContext?.floor?.floor_name || "—")}</span></div>
      </div>

      <div class="info-section">
        <div class="info-heading">Device Information</div>
        <div class="info-row"><span class="info-key">Manufacturer</span><span class="info-value">${escapeHtml(sensor.manufacturer || "—")}</span></div>
        <div class="info-row"><span class="info-key">Model</span><span class="info-value">${escapeHtml(sensor.model || "—")}</span></div>
        <div class="info-row"><span class="info-key">Data Source</span><span class="info-value">${escapeHtml(sensor.data_source || "—")}</span></div>
      </div>

      <div class="info-section">
        <div class="info-heading">Sensor measurements · stored simulation data</div>
        ${readingsHtml}
      </div>

      ${detailed ? `<div class="info-section">
        <div class="info-heading">Reading Status</div>
        <div class="info-row"><span class="info-key">Last Updated</span><span class="info-value">${formatTime(latestTimestamp)}</span></div>
        <div class="info-row"><span class="info-key">Quality</span><span class="info-value">${escapeHtml(qualityRows || "—")}</span></div>
        <div class="info-row"><span class="info-key">Measurement Channels</span><span class="info-value">${points.length}</span></div>
      </div>` : ""}
    </div>

    <div class="asset-actions">
      ${asset ? `<button class="btn btn-primary btn-wide" data-open-asset="${escapeHtml(asset.asset_id)}">Open Linked Asset ↗</button>` : ""}
    </div>
  </section>`;
}

function unmappedBimInspectorHtml() {
  const selection = state.selectedBimElement;
  return `<section class="panel asset-inspector">
    <div class="panel-header">
      <div class="section-title">Selected BIM Element</div>
      <div class="section-meta">NO DATABASE MAPPING</div>
    </div>
    <div class="asset-inspector-body">
      <div class="asset-title-row">
        <div class="asset-icon-box">◇</div>
        <div class="asset-title-copy">
          <div class="asset-name">${escapeHtml(selection?.name || "BIM Element")}</div>
          <div class="asset-type">${escapeHtml(selection?.type || "BIM Element")}</div>
        </div>
      </div>
      <div class="info-section">
        <div class="info-heading">Identification</div>
        <div class="info-row"><span class="info-key">BIM Element ID</span><span class="info-value mono">${escapeHtml(selection?.entityId || "—")}</span></div>
      </div>
      <div class="section-meta" style="margin-top:10px">This BIM object does not currently map to a row in the sensors or equipment tables.</div>
    </div>
  </section>`;
}

function assetInspectorHtml({ detailed = false } = {}) {
  const sensor = selectedSensor();
  if (sensor) return sensorInspectorHtml(sensor, { detailed });

  if (state.selectedBimElement?.entityId) {
    const mappedAsset = getAssetByBimId(state.selectedBimElement.entityId);
    if (!mappedAsset) return unmappedBimInspectorHtml();
    state.selectedAssetId = mappedAsset.asset_id;
  }

  const context = selectedAssetContext();
  const { asset, space, floor, anomalies } = context;
  const latestAnomaly = anomalies[0] || null;
  const status = latestAnomaly && latestAnomaly.anomaly_status !== "Closed" ? "Anomaly" : (asset.status || "Normal");

  const readingsHtml = context.readings.length
    ? context.readings.map((item) => `<div class="info-row">
        <span class="info-key">${escapeHtml(item.measurement_type ?? item.sensor_type ?? item.point_code ?? "Measurement")}</span>
        <span class="info-value">${item.reading ? `${escapeHtml(item.reading.value)} ${escapeHtml(item.unit || "")}` : "—"}</span>
      </div>`).join("")
    : `<div class="section-meta">No current measurements are stored for this asset.</div>`;

  return `<section class="panel asset-inspector">
    <div class="panel-header">
      <div class="section-title">Selected Asset</div>
      <div class="section-meta"><span class="status-dot green"></span>POSTGRESQL</div>
    </div>
    <div class="asset-inspector-body">
      <div class="asset-title-row">
        <div class="asset-icon-box">⇄</div>
        <div class="asset-title-copy">
          <div class="asset-name">${escapeHtml(asset.asset_name)}</div>
          <div class="asset-type">${escapeHtml(asset.asset_type)}</div>
        </div>
        ${statusPill(status)}
      </div>

      <div class="info-section">
        <div class="info-heading">Identification</div>
        <div class="info-row"><span class="info-key">Asset ID</span><span class="info-value">${escapeHtml(asset.asset_id)}</span></div>
        <div class="info-row"><span class="info-key">BIM Element ID</span><span class="info-value mono">${escapeHtml(asset.ifc_global_id || "—")}</span></div>
        <div class="info-row"><span class="info-key">Location</span><span class="info-value">${escapeHtml(space?.space_name || floor?.floor_name || "—")}</span></div>
        <div class="info-row"><span class="info-key">Manufacturer</span><span class="info-value">${escapeHtml(asset.manufacturer || "—")}</span></div>
        <div class="info-row"><span class="info-key">Model</span><span class="info-value">${escapeHtml(asset.model || "—")}</span></div>
      </div>

      <div class="info-section">
        <div class="info-heading">Current Measurements</div>
        ${readingsHtml}
      </div>

      ${detailed ? `<div class="info-section">
        <div class="info-heading">Sync Status</div>
        <div class="info-row"><span class="info-key">Last Updated</span><span class="info-value">${formatTime(latestReadingTimestamp(context))}</span></div>
        <div class="info-row"><span class="info-key">Database</span><span class="info-value">${escapeHtml(connectionState.database)}</span></div>
      </div>` : ""}

      ${latestAnomaly ? `<div class="ai-box">
        <div class="ai-head"><div class="ai-label">Latest AI Result</div></div>
        <div class="ai-score-row">
          <div class="ai-state">${escapeHtml(latestAnomaly.prediction || "Anomaly")}</div>
          <div class="ai-score">${Number(latestAnomaly.anomaly_score).toFixed(2)}<small>Anomaly Score</small></div>
        </div>
        <div style="margin-top:9px">
          <div class="info-row"><span class="info-key">Detected</span><span class="info-value">${formatTime(latestAnomaly.timestamp)}</span></div>
          <div class="info-row"><span class="info-key">Evidence</span><span class="info-value">${escapeHtml(latestAnomaly.description || "—")}</span></div>
        </div>
      </div>` : ""}
    </div>
    <div class="asset-actions">
      <button class="btn btn-primary btn-wide" data-open-asset="${escapeHtml(asset.asset_id)}">Open Asset Detail ↗</button>
    </div>
  </section>`;
}

function bindAssetInspector() {
  document.querySelector("[data-open-asset]")?.addEventListener("click", (event) => go(`/assets/${event.currentTarget.dataset.openAsset}`));
  document.querySelector("[data-explain-anomaly]")?.addEventListener("click", () => {
    state.aiDrawerOpen = true;
    state.aiResponse = "";
    render();
  });
  document.querySelector("[data-acknowledge]")?.addEventListener("click", async (event) => {
    const anomalyId = Number(event.currentTarget.dataset.acknowledge);
    if (!anomalyId) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Updating…";
    try {
      await updateAnomalyStatus(anomalyId, "Acknowledged");
      render();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry Acknowledge";
      console.error(error);
    }
  });
}

function viewerPanelHtml({ stageId, detailed = false } = {}) {
  return `<section class="panel viewer-panel">
    <div class="panel-header">
      <div>
        <div class="section-title">◫ Digital Twin BIM Viewer</div>
        <div class="section-meta" style="margin-top:4px">Level 5 pilot &nbsp;•&nbsp; Simulated telemetry &nbsp; <span class="demo-label">SIMULATION</span></div>
      </div>
      <div class="viewer-tools-row">
        <span class="viewer-level-tag">Level 5 only</span>
        <button class="btn" data-viewer-action="threeD" title="Return to 3D orbit">3D View</button>
        ${detailed ? `<button class="btn viewer-expand-btn" data-viewer-fullscreen type="button" title="Expand BIM viewer and sensor details">⛶ Expand</button>` : ""}
      </div>
    </div>
    <div class="viewer-stage" id="${stageId}">
      <canvas class="viewer-canvas" data-xeokit-canvas></canvas>
      <canvas class="nav-cube-canvas" data-navcube-canvas></canvas>
      <div class="viewer-overlay-top"><span>● Snowdon Towers &nbsp;/&nbsp; Level 5</span><span>● Selected Element &nbsp; <strong data-selected-element>${escapeHtml(state.selectedBimElement?.entityId || "None")}</strong></span></div>
      <div class="viewer-toolbar" aria-label="BIM viewer tools">
        <button class="viewer-tool" title="Restore all BIM geometry" data-viewer-action="resetAllCuts">▣</button>
        <button class="viewer-tool" title="Reset / Home" data-viewer-action="home">⌂</button>
        <button class="viewer-tool" title="Plan view" data-viewer-action="plan">⌗</button>
        <button class="viewer-tool" title="3D floor view" data-viewer-action="threeD">◉</button>
        <button class="viewer-tool" title="Fit model" data-viewer-action="fit">⌕</button>
        
        <button class="viewer-tool active" title="BIM selection active">◇</button>
      </div>
      <div class="level5-viewer-tools">
        <details class="level5-viewer-details">
          <summary class="level5-panel-summary" aria-label="Expand or collapse view options">
            <span>View options</span><span class="level5-collapse-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="level5-viewer-content">
            <label class="architecture-checkbox"><input type="checkbox" data-architecture-toggle checked /> Show architecture</label>
            <div class="level5-layer-status" data-architecture-status>Loading architectural floor…</div>
            <button type="button" class="level5-recovery-btn" data-viewer-action="resetAllCuts">Restore visible model</button>
            <div class="level5-mode-help">The Level 5 floor cut is applied automatically when the reference slab is available.</div>
          </div>
        </details>
      </div>
      <div class="viewer-floor-control"><span class="viewer-floor-label" data-floor-label>Level 5</span></div>
      <div class="viewer-loading" data-viewer-loading>
        <div class="viewer-loading-card">
          <div class="viewer-loading-icon"></div>
          <div class="viewer-loading-title">Loading BIM model</div>
          <div class="viewer-loading-sub">Snowdon Towers · xeokit</div>
        </div>
      </div>
    </div>
    <div class="viewer-statusbar">
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:#35d07f"></span>Normal</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ffd447"></span>Warning</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ff7a00"></span>Anomaly</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ff5154"></span>Critical</span>
        <span class="legend-item"><span class="legend-dot" style="background:#55b7ff"></span>Selected</span>
      </div>
      <span>8 mapped devices · 11 channels</span>
    </div>
  </section>`;
}

function bindMiniSensorOverview() {
  const region = document.querySelector(".bim-sensor-overview");
  region?.addEventListener("click", event => {
    const button = event.target.closest("[data-sensor-mini]");
    if (!button) return;
    const sensor = LEVEL5_SENSORS.find(item => item.sensorId === button.dataset.sensorMini);
    if (!sensor) return;
    const feedback = region.querySelector("[data-sensor-feedback]");
    if (!activeBimController?.viewer.scene.objects[sensor.guid]) {
      if (feedback) feedback.textContent = "BIM sensor marker is not loaded. Check the model loading status.";
      return;
    }
    if (feedback) feedback.textContent = "";
    activeBimController.selectSensor(sensor.guid);
  });
}

function initViewer(stageId) {
  const controller = initXeokitViewer({
    stageId,
    onSelection: (selection) => {
      state.selectedBimElement = selection;
      const sensor = getSensorByBimId(selection.entityId);
      const mappedAsset = getAssetByBimId(selection.entityId);
      if (sensor) state.selectedAssetId = sensor.asset_id ?? sensor.equipment_code;
      else if (mappedAsset) state.selectedAssetId = mappedAsset.asset_id;
      const label = document.querySelector("[data-selected-element]");
      if (label) label.textContent = selection.entityId;
      const inspector = document.querySelector(".asset-inspector");
      if (inspector) {
        inspector.outerHTML = assetInspectorHtml({ detailed: pathName() === "/bim-viewer" });
        bindAssetInspector();
      }
      document.querySelectorAll("[data-sensor-guid]").forEach(button => {
        button.classList.toggle("active", button.dataset.sensorGuid === selection.entityId);
      });
      refreshMiniOverview(selection.entityId);
    }
  });
  if (!controller) return null;
  if (stageId === "mainViewer") activeBimController = controller;
  const stage = document.getElementById(stageId);
  const panel = stage?.closest(".viewer-panel");
  if (!panel) return controller;
  const fullButton = panel.querySelector("[data-viewer-fullscreen]");
  fullButton?.addEventListener("click", async () => {
    const workspace = panel.closest("[data-bim-workspace]");
    if (!workspace) return;
    try {
      if (document.fullscreenElement === workspace) await document.exitFullscreen();
      else await workspace.requestFullscreen();
    } catch (error) {
      console.error("Could not expand BIM viewer:", error);
    }
  });
  const navigation = document.createElement("aside");
  navigation.className = "level5-sensor-nav";
  navigation.setAttribute("aria-label", "Level 5 physical sensors");
  navigation.innerHTML = '<details class="level5-sensor-details">' +
    '<summary class="level5-panel-summary" aria-label="Expand or collapse Level 5 sensors">' +
      '<span>Level 5 sensors</span><span class="level5-sensor-summary-right">' +
        '<span data-mapping-count>Checking model…</span><span class="level5-collapse-chevron" aria-hidden="true">⌄</span>' +
      '</span></summary>' +
    '<div class="level5-sensor-body">' +
      '<input data-sensor-filter type="search" aria-label="Find a sensor" placeholder="Search ID or asset…" />' +
      '<div class="level5-sensor-nav-list">' +
      LEVEL5_SENSORS.map(item => '<button type="button" data-sensor-guid="' + escapeHtml(item.guid) + '" title="' + escapeHtml(item.label) + '">' +
        '<strong>' + escapeHtml(item.sensorId) + '</strong><span>' + escapeHtml(item.assetId) + ' · ' + escapeHtml(item.label) + '</span></button>').join("") +
      '<div class="level5-unlocated">' + LEVEL5_UNLOCATED_POINTS.map(item => escapeHtml(item.pointCode) + ' · No BIM marker').join("") + '</div></div>' +
    '</div></details>';
  const treeMount = stageId === "mainViewer"
    ? document.querySelector("[data-bim-sensor-tree]") : null;
  (treeMount || stage).appendChild(navigation);
  if (treeMount) navigation.querySelector("details").open = true;
  navigation.querySelector("[data-sensor-filter]")?.addEventListener("input", event => {
    const value = event.target.value.trim().toLowerCase();
    navigation.querySelectorAll("[data-sensor-guid]").forEach(button => {
      button.hidden = !button.textContent.toLowerCase().includes(value);
    });
  });
  navigation.querySelectorAll("[data-sensor-guid]").forEach(button => button.addEventListener("click", () => {
    const guid = button.dataset.sensorGuid;
    if (!controller.selectSensor(guid)) {
      button.title = "BIM GUID not found in loaded XKT. Check IFC conversion and model metadata.";
      button.classList.add("unmapped");
    }
  }));
  controller.model?.on?.("loaded", () => {
    const {matched,total} = controller.configureSensors(LEVEL5_SENSORS);
    const count = navigation.querySelector("[data-mapping-count]");
    if (count) count.textContent = matched + "/" + total + " found";
    navigation.querySelectorAll("[data-sensor-guid]").forEach(button => {
      const found = Boolean(controller.viewer.scene.objects[button.dataset.sensorGuid]);
      button.classList.toggle("unmapped", !found);
      if (!found) button.title = "GUID is not present in this XKT model";
    });
  });
  return controller;
}

function trendSvg(sensorId = 1001) {
  const data = db.Historical_Sensor_Readings
    .filter((r) => r.sensor_id === Number(sensorId))
    .slice()
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!data.length) {
    return `<div class="empty-chart">No historical readings are stored for this sensor yet.</div>`;
  }

  const sensor = db.Sensors.find((s) => s.sensor_id === Number(sensorId));
  const values = data.map((d) => Number(d.value)).filter(Number.isFinite);
  const width = 700, height = 125, px = 34, py = 13;
  let min = Math.min(...values), max = Math.max(...values);
  const isSupplyTemp = sensor?.sensor_type === "Supply Air Temperature";
  if (isSupplyTemp) {
    min = Math.min(min, 20.0);
    max = Math.max(max, 20.8);
  }
  const span = Math.max(max - min, Math.max(Math.abs(max), 1) * 0.05);
  const pad = span * 0.16;
  min -= pad;
  max += pad;
  const x = (i) => px + (i / Math.max(1, values.length - 1)) * (width - px * 2);
  const y = (v) => py + ((max - v) / Math.max(0.0001, max - min)) * (height - py * 2 - 14);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${px},${height - 18} ${points} ${width - px},${height - 18}`;
  const ticks = Array.from({ length: 5 }, (_, i) => max - (i * (max - min) / 4));
  const decimals = sensor?.unit === "Pa" || sensor?.unit === "%" ? 0 : 1;
  const grid = ticks.map((t) => `<line class="chart-grid" x1="${px}" x2="${width-px}" y1="${y(t)}" y2="${y(t)}"/><text class="chart-label" x="1" y="${y(t)+3}">${t.toFixed(decimals)}</text>`).join("");
  const labelIndices = [...new Set([0, Math.floor((data.length-1)*0.25), Math.floor((data.length-1)*0.5), Math.floor((data.length-1)*0.75), data.length-1])];
  const labels = labelIndices.map((i) => `<text class="chart-label" x="${x(i)}" y="${height-2}" text-anchor="middle">${String(data[i]?.timestamp || "").slice(11,16)}</text>`).join("");
  const references = isSupplyTemp
    ? `<line class="chart-threshold" x1="${px}" x2="${width-px}" y1="${y(20)}" y2="${y(20)}"/><line class="chart-line-secondary" x1="${px}" x2="${width-px}" y1="${y(20.8)}" y2="${y(20.8)}"/>`
    : "";
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(sensor?.sensor_type || "Sensor")} trend">
    <defs><linearGradient id="trendFill-${sensorId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff7a00" stop-opacity=".18"/><stop offset="100%" stop-color="#ff7a00" stop-opacity="0"/></linearGradient></defs>
    ${grid}${references}
    <polygon class="chart-area" style="fill:url(#trendFill-${sensorId})" points="${area}"/>
    <polyline class="chart-line" points="${points}"/>
    ${labels}
  </svg>`;
}

function trendPanelHtml() {
  const sensor = db.Sensors.find((s) => s.sensor_id === 1001) || db.Sensors[0];
  const asset = sensor ? getAssetById(sensor.asset_id) : null;
  const reading = sensor ? getReading(sensor.sensor_id) : null;
  const current = reading ? Number(reading.value) : null;
  const expected = 21.0;
  const delta = current == null ? null : current - expected;
  return `<section class="panel trend-panel">
    <div class="panel-header compact-header"><div class="section-title">≋ Sensor Trend</div><div class="section-meta">${escapeHtml(asset?.asset_name || "Asset")} · POSTGRESQL DEMO</div></div>
    <div class="trend-body">
      <div class="trend-controls">
        <select class="select" style="height:26px"><option>Supply Air Temperature</option><option>Airflow</option><option>Static Pressure</option></select>
        <div style="display:flex;align-items:center;gap:12px"><div class="segmented"><button>1H</button><button>6H</button><button class="active">24H</button><button>7D</button></div><div class="trend-value"><strong>${current == null ? "—" : current.toFixed(1)} <span style="font-size:9px;color:#8798a4">${escapeHtml(sensor?.unit || "")}</span></strong><div class="trend-delta">${delta == null ? "No reading" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} °C from demo reference`}</div></div></div>
      </div>
      <div class="chart-wrap">${trendSvg()}</div>
    </div>
  </section>`;
}

function anomalyRowsHtml({ compact = false } = {}) {
  let rows = getLatestAnomalyRows();
  if (state.anomalyStatus !== "all") rows = rows.filter((r) => r.anomaly_status === state.anomalyStatus);
  if (state.anomalyAsset !== "all") rows = rows.filter((r) => r.asset?.asset_name === state.anomalyAsset);
  return rows.map((r) => {
    const result = r.description || "Anomalous behaviour detected";
    const score = Number(r.anomaly_score).toFixed(2);
    if (compact) {
      return `<tr data-anomaly-asset="${r.asset?.asset_id}" data-anomaly-id="${r.anomaly_id}"><td>${formatShortTime(r.timestamp)}</td><td class="primary">${escapeHtml(r.asset?.asset_name || "—")}</td><td>${escapeHtml(r.space?.space_name || r.floor?.floor_name || "—")}</td><td>${escapeHtml(result)}</td><td>${statusPill(r.anomaly_status)}</td><td class="accent">${score}</td></tr>`;
    }
    return `<tr data-anomaly-asset="${r.asset?.asset_id}" data-anomaly-id="${r.anomaly_id}"><td class="primary">${formatShortTime(r.timestamp)}</td><td class="primary">${escapeHtml(r.asset?.asset_name || "—")}</td><td>${escapeHtml(r.sensor?.sensor_type || "—")}</td><td class="accent">${score}</td><td>${escapeHtml(result)}</td><td>${statusPill(r.severity)}</td><td>${escapeHtml(r.model_version || "Not verified")}</td><td>${statusPill(r.anomaly_status)}</td></tr>`;
  }).join("");
}

function recentAnomaliesPanelHtml() {
  return `<section class="panel anomaly-panel">
    <div class="panel-header compact-header"><div class="section-title">△ Recent Anomalies / Faults</div><button class="btn btn-ghost" style="height:26px;min-height:26px" data-view-all-anomalies>View all ↗</button></div>
    <div class="panel-body">
      <div class="anomaly-filters">
        <select class="select" id="dashStatusFilter"><option value="all">All Status</option><option>New</option><option>Review</option><option>Acknowledged</option><option>Closed</option></select>
        <select class="select" id="dashAssetFilter"><option value="all">All Assets</option>${db.Assets.map(a=>`<option>${a.asset_name}</option>`).join("")}</select>
      </div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Asset</th><th>Location</th><th>AI Result</th><th>Status</th><th>Score</th></tr></thead><tbody>${anomalyRowsHtml({compact:true})}</tbody></table></div>
    </div>
  </section>`;
}

function bindAnomalyRows() {
  document.querySelectorAll("[data-anomaly-asset]").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.anomalyAsset;
      if (!id || id === "undefined") return;
      state.selectedAssetId = id;
      go("/assets/" + encodeURIComponent(id));
    });
  });
}

function renderDashboard() {
  destroyActiveViewer();
  const anomalyCount = db.Anomaly_Results.filter(a => a.anomaly_status !== "Closed").length;
  const html = '<div class="page ai-page">' +
    heading("Overview", "A clear view of your building’s operational health.") +
    banner("Simulated monitoring · not physical sensor measurements",
      "The interface displays PostgreSQL demonstration data; " + anomalyCount + " stored open anomaly records. No production AI inference is connected.") +
    metrics([
      ["HRU assets", "3", "Level 5 pilot equipment"],
      ["Sensor devices", "8", "Physical BIM sensor markers"],
      ["Measurement channels", "11", "Mapped MQTT points"]
    ]) +
    '<div class="ai-source-row"><span class="ai-badge">Local simulation</span><strong>PostgreSQL: ' +
    escapeHtml(connectionState.status) + '</strong><span>No live building BMS connected</span></div>' +
    '<div class="ai-grid-two ai-overview-top">' +
      '<section class="ai-overview-viewer">' + viewerPanelHtml({stageId:"dashboardViewer"}) + '</section>' +
      '<section class="ai-overview-inspector">' + assetInspectorHtml() + '</section>' +
    '</div>' + overviewDetails() +
    '<p class="ai-demo-foot">Source: local simulation. Historical LBNL-derived inputs are not measurements collected from Snowdon Towers.</p></div>';
  shell(html, { activePath: "/", breadcrumb:"Overview" });
  bindAssetInspector();
  requestAnimationFrame(() => initViewer("dashboardViewer"));
}
function renderBimViewer() {
  destroyActiveViewer();
  activeBimController = null;
  const html = '<div class="page bim-viewer-page ai-fullscreen-bim">' +
    heading("BIM Viewer", "Explore Level 5 and monitor all eight physical sensor devices.") +
    '<div class="ai-banner"><strong>Interactive xeokit BIM model</strong><div>Click any sensor card or BIM element to inspect real recorded simulation values. Status colors use reading freshness and stored anomaly records.</div></div>' +
    '<div class="bim-workspace bim-three-column" data-bim-workspace>' +
       '<aside class="bim-tree-column panel" aria-label="Level 5 sensor tree"><div class="bim-tree-heading">Sensor tree</div><div data-bim-sensor-tree></div></aside>' +
       '<div class="bim-center-column">' +
         sensorMiniOverviewHtml(state.selectedBimElement?.entityId) +
         viewerPanelHtml({stageId:"mainViewer",detailed:true}) +
       '</div>' +
       assetInspectorHtml({detailed:true}) +
    '</div><p class="ai-demo-foot">Green = recent data without a matching anomaly record; amber/red = stored demonstration anomaly; gray = missing or stale. Statuses do not diagnose physical equipment.</p></div>';
  shell(html, {activePath:"/bim-viewer",breadcrumb:"BIM Viewer",noScroll:true});
  bindAssetInspector();
  bindMiniSensorOverview();
  requestAnimationFrame(() => initViewer("mainViewer"));
}

function assetsTableRows() {
  const q = state.assetSearch.trim().toLowerCase();
  return db.Assets.filter((asset) => {
    const context = getAssetContext(asset);
    const floorMatch = state.assetFloor === "all" || String(context?.floor?.floor_id) === state.assetFloor;
    const searchMatch = !q || [asset.asset_name, asset.asset_type, context?.space?.space_name, context?.floor?.floor_name].some((v) => String(v || "").toLowerCase().includes(q));
    return floorMatch && searchMatch;
  }).map((asset) => {
    const context = getAssetContext(asset);
    const status = assetAnomalyStatus(asset.asset_id);
    const latest = context.readings[0]?.reading?.latest_update;
    return `<tr data-asset-row="${asset.asset_id}"><td class="primary" style="color:#ffb25f">${asset.asset_name}</td><td>${asset.asset_type}</td><td>${context.floor?.floor_name || "—"}</td><td>HVAC</td><td>${statusPill(asset.status)}</td><td>${statusPill(status)}</td><td class="mono">${formatTime(latest)}</td><td>↗</td></tr>`;
  }).join("");
}

function renderAssets() {
  destroyActiveViewer();
  const floorOptions = db.Building_Floors.map(f=>`<option value="${f.floor_id}">${f.floor_name}</option>`).join("");
  const html = `<div class="page">
    ${pageHeading({eyebrow:"Asset Register", title:"Assets", subtitle:"Snowdon Towers · BIM-linked HVAC pilot assets", actions:'<span class="demo-label" style="border:1px solid #34454f;padding:7px 9px;border-radius:6px">DEMONSTRATION DATA</span>'})}
    <section class="panel">
      <div class="search-panel"><input id="assetSearch" class="field" placeholder="⌕  Search assets…" value="${escapeHtml(state.assetSearch)}"><select id="assetFloor" class="select"><option value="all">All Floors</option>${floorOptions}</select></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Floor</th><th>System</th><th>Live Status</th><th>Anomaly Status</th><th>Last Update</th><th></th></tr></thead><tbody id="assetsBody">${assetsTableRows()}</tbody></table></div>
      <div class="table-foot">4 pilot assets · BMS simulation</div>
    </section>
    <div class="page-footer-line"><span>SNOWDON TOWERS &nbsp;•&nbsp; BIM-INTEGRATED ASSET MONITORING</span><span>Demonstration data · Not connected to a live BMS</span></div>
  </div>`;
  shell(html, { activePath: "/assets", breadcrumb: "Assets" });
  const search = document.getElementById("assetSearch");
  const floor = document.getElementById("assetFloor");
  if (floor) floor.value = state.assetFloor;
  const refresh = () => {
    document.getElementById("assetsBody").innerHTML = assetsTableRows();
    bindAssetRows();
  };
  search?.addEventListener("input", () => { state.assetSearch = search.value; refresh(); });
  floor?.addEventListener("change", () => { state.assetFloor = floor.value; refresh(); });
  bindAssetRows();
}

function bindAssetRows() {
  document.querySelectorAll("[data-asset-row]").forEach((row) => row.addEventListener("click", () => {
    state.selectedAssetId = row.dataset.assetRow;
    go(`/assets/${row.dataset.assetRow}`);
  }));
}

function updateAssetDetailLiveReading(reading) {

  if (!reading?.point_code) {
    return;
  }

  // Only update an asset-detail page.
  if (!pathName().startsWith("/assets/")) {
    return;
  }

  const routeAssetId =
    decodeURIComponent(
      pathName().split("/")[2] || ""
    );

  // Ignore readings belonging to another asset.
  if (
    String(routeAssetId) !==
    String(reading.asset_id)
  ) {
    return;
  }

  const row =
    document.querySelector(
      `[data-live-point="${CSS.escape(
        String(reading.point_code)
      )}"]`
    );

  if (!row) {
    console.warn(
      `No live table row found for ${reading.point_code}`
    );

    return;
  }

  const valueElement =
    row.querySelector(
      "[data-live-value]"
    );

  const unitElement =
    row.querySelector(
      "[data-live-unit]"
    );

  const qualityElement =
    row.querySelector(
      "[data-live-quality]"
    );

  const updatedElement =
    row.querySelector(
      "[data-live-updated]"
    );


  if (valueElement) {

    const numericValue =
      Number(reading.value);

    valueElement.textContent =
      Number.isFinite(numericValue)
        ? numericValue.toFixed(2)
        : String(reading.value ?? "—");
  }


  if (
    unitElement &&
    reading.unit
  ) {
    unitElement.textContent =
      reading.unit;
  }


  if (qualityElement) {

    qualityElement.textContent =
      reading.quality ?? "—";
  }


  if (updatedElement) {

    updatedElement.textContent =
      formatTime(
        reading.latest_update ??
        reading.timestamp
      );
  }


  // Briefly mark the row when a new value arrives.
  row.classList.add(
    "live-reading-update"
  );

  window.setTimeout(
    () => {
      row.classList.remove(
        "live-reading-update"
      );
    },
    500
  );
}

function renderAssetDetail(assetId) {
  destroyActiveViewer();
  const asset = getAssetById(assetId) || db.Assets[0];
  state.selectedAssetId = asset.asset_id;
  const context = getAssetContext(asset);
  const anomaly = context.anomalies[0];
  const maintenance = db.Maintenance_Events.filter((m) => m.asset_id === asset.asset_id);
  const rows = context.readings.map((item) => {
    const pointCode =
      item.point_code ??
      item.sensor_id ??
      "";

    const parameter =
      item.measurement_type ??
      item.sensor_type ??
      "Unknown";

    const reading = item.reading;

    return `
      <tr data-live-point="${escapeHtml(pointCode)}">

        <td class="primary">
          ${escapeHtml(parameter)}
        </td>

        <td data-live-value>
          ${reading?.value ?? "—"}
        </td>

        <td data-live-unit>
          ${escapeHtml(item.unit || "")}
        </td>

        <td data-live-quality>
          ${escapeHtml(reading?.quality ?? "—")}
        </td>

        <td
          class="mono"
          data-live-updated
        >
          ${formatTime(reading?.latest_update)}
        </td>

      </tr>
    `;
  }).join("");

  const html = `<div class="page">
    ${pageHeading({eyebrow:"Asset Detail", title:asset.asset_name, subtitle:`${asset.asset_type} · ${context.space?.space_name || ""}`, actions:`${statusPill(asset.status)} ${statusPill(assetAnomalyStatus(asset.asset_id))} <button class="btn btn-primary" data-locate-bim>Locate in BIM ↗</button>`})}
    <div class="card-grid two">
      <section class="panel"><div class="panel-header"><div class="section-title">Asset Overview</div></div><div class="panel-body">
        <div class="info-row"><span class="info-key">Asset ID</span><span class="info-value">AST-${String(asset.asset_id).padStart(4,"0")}</span></div>
        <div class="info-row"><span class="info-key">BIM Element ID</span><span class="info-value mono">${asset.ifc_global_id}</span></div>
        <div class="info-row"><span class="info-key">Floor</span><span class="info-value">${context.floor?.floor_name || "—"}</span></div>
        <div class="info-row"><span class="info-key">Space</span><span class="info-value">${context.space?.space_name || "—"}</span></div>
        <div class="info-row"><span class="info-key">Installed</span><span class="info-value">${asset.installation_date}</span></div>
        <div class="info-row"><span class="info-key">Data Source</span><span class="info-value">MQTT Simulator</span></div>
      </div></section>
      <section class="panel"><div class="panel-header"><div class="section-title">Current AI Summary</div></div><div class="panel-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><div><div class="eyebrow">Latest status</div><div style="font-size:20px;font-weight:900;color:${anomaly ? '#ffad55' : '#6fe3a4'}">${anomaly ? 'Anomaly detected' : 'Normal'}</div></div><div class="ai-score">${anomaly ? Number(anomaly.anomaly_score).toFixed(2) : '—'}<small>Anomaly Score</small></div></div>
        <div class="info-row"><span class="info-key">Detection Model</span><span class="info-value">Multivariate Autoencoder</span></div>
        <div class="info-row"><span class="info-key">Interpretation</span><span class="info-value">${anomaly ? anomaly.description : 'No active abnormal behaviour'}</span></div>
        <div style="margin-top:12px"><button class="btn btn-primary" data-explain-anomaly>Explain with AI</button></div>
      </div></section>
    </div>
    <section class="panel" style="margin-top:12px"><div class="panel-header"><div class="section-title">Current Sensor Values</div><div class="section-meta"><span class="status-dot green"></span>Live MQTT readings</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Quality</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel" style="margin-top:12px"><div class="panel-header"><div class="section-title">Maintenance Events</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Description</th></tr></thead><tbody>${maintenance.length ? maintenance.map(m=>`<tr><td>${m.event_date}</td><td class="primary">${m.event_type}</td><td>${statusPill(m.maintenance_status)}</td><td>${m.description}</td></tr>`).join('') : '<tr><td colspan="4">No maintenance records in demo data.</td></tr>'}</tbody></table></div></section>
  </div>`;
  shell(html, { activePath: "/assets", breadcrumb: `Assets / ${asset.asset_name}` });
  document.querySelector("[data-locate-bim]")?.addEventListener("click", () => go("/bim-viewer"));
  document.querySelector("[data-explain-anomaly]")?.addEventListener("click", () => { state.aiDrawerOpen = true; render(); });
}

function sensorOptions(assetId) {
  return getSensorsForAsset(assetId).map((s)=>`<option value="${s.sensor_id}">${s.sensor_type}</option>`).join("");
}

function sensorHistoryRows() {
  const rows = db.Historical_Sensor_Readings
    .filter((r) => r.sensor_id === Number(state.sensorId))
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const sensor = db.Sensors.find((s)=>s.sensor_id===Number(state.sensorId));
  const asset = sensor ? getAssetById(sensor.asset_id) : null;
  if (!rows.length) return `<tr><td colspan="7" class="empty-table-cell">No historical PostgreSQL readings are stored for this sensor.</td></tr>`;
  return rows.map((r)=>`<tr><td class="mono">${String(r.timestamp).replace('T',' ')}</td><td>${sensor?.sensor_id || '—'}</td><td class="primary">${asset?.asset_name || '—'}</td><td>${sensor?.sensor_type || '—'}</td><td class="primary">${Number(r.value).toFixed(sensor?.unit==='Pa'?0:2)}</td><td>${sensor?.unit || '—'}</td><td><span class="status-dot ${r.quality === 'Good' ? 'green' : 'orange'}"></span>${escapeHtml(r.quality)}</td></tr>`).join('');
}

function renderSensorData() {
  destroyActiveViewer();
  shell(monitoring(), { activePath:"/sensor-data", breadcrumb:"Sensor Monitoring" });
  const search = document.getElementById("channelSearch");
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll("[data-equipment]").forEach(card => {
      card.hidden = q && !card.textContent.toLowerCase().includes(q);
    });
  });
}
function renderAnomalies() {
  destroyActiveViewer();
  const rows = getLatestAnomalyRows();
  const active = rows.filter(r => r.anomaly_status !== "Closed");
  const severities = active.map(r=>String(r.severity || "").toLowerCase());
  const highest = severities.includes("critical") ? "Critical" :
                  severities.includes("high") ? "High" :
                  severities.includes("medium") ? "Medium" :
                  severities.includes("low") ? "Low" : "—";
  const affected = new Set(active.map(r=>r.asset?.asset_id).filter(Boolean));
  const options = db.Assets.map(asset=>'<option value="' + escapeHtml(asset.asset_name) + '">' +
    escapeHtml(asset.asset_name) + '</option>').join("");
  const html = '<div class="page ai-page">' +
    heading("Anomaly Detection", "Investigate deviations with context, not just alerts.") +
    banner("Demonstration anomaly records · not verified building faults",
      "Anomalies loaded from the database are PoC records. No evaluated production detector or fault-classification service is connected.") +
    metrics([
      ["Open demo anomaly records", String(active.length), "PostgreSQL demonstration data"],
      ["Highest stored severity", highest, "From open database records"],
      ["Affected equipment", affected.size + " / 3", "Current Level 5 pilot"],
      ["Production detections", "—", "No trained service connected"]
    ]) +
    '<div class="ai-chip-row"><label class="ai-chip">Equipment <select class="select" id="anomalyAsset"><option value="all">All equipment</option>' + options + '</select></label>' +
    '<label class="ai-chip">Status <select class="select" id="anomalyStatus"><option value="all">All statuses</option><option>New</option><option>Review</option><option>Acknowledged</option><option>Closed</option></select></label></div>' +
    '<section class="ai-card" style="margin-bottom:14px">' +
      '<div class="ai-card-title"><div><strong>Recorded anomaly investigations</strong><small>Click a record to view its associated asset</small></div></div>' +
      '<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>Detected</th><th>Asset</th><th>Sensor</th><th>Score</th><th>Description</th><th>Severity</th><th>Model</th><th>Status</th></tr></thead>' +
      '<tbody id="anomalyBody">' + anomalyRowsHtml() + '</tbody></table></div>' +
    '</section><div class="ai-grid-two"><section class="ai-card">' +
      '<div class="ai-card-title"><strong>Recent event timeline</strong></div>' +
      (rows.slice(0,5).map(r=>'<div class="ai-key-value"><span>' + escapeHtml(formatTime(r.timestamp)) + ' · ' +
      escapeHtml(r.asset?.asset_name || "Unmapped asset") + '</span><strong>' +
      escapeHtml(r.anomaly_status || "Recorded") + '</strong></div>').join("") ||
      '<div class="ai-empty">No anomaly events are stored in this database.</div>') +
    '</section><section class="ai-card"><div class="ai-card-title"><strong>Historical context</strong></div>' +
      '<p class="ai-demo-foot">The original historical simulation is fault-free. Stored anomaly demo records and any future fault injections must be distinguished from confirmed physical building faults.</p>' +
      '<button class="btn" data-route="/historical-data">Explore historical baseline ↗</button>' +
    '</section></div></div>';
  shell(html,{activePath:"/anomalies",breadcrumb:"Anomaly Detection"});
  const status = document.getElementById("anomalyStatus");
  const asset = document.getElementById("anomalyAsset");
  status.value = state.anomalyStatus;
  asset.value = state.anomalyAsset;
  const refresh = () => { document.getElementById("anomalyBody").innerHTML = anomalyRowsHtml(); bindAnomalyRows(); };
  status.addEventListener("change", () => { state.anomalyStatus = status.value; refresh(); });
  asset.addEventListener("change", () => { state.anomalyAsset = asset.value; refresh(); });
  bindAnomalyRows();
}

function renderModelResults() {
  destroyActiveViewer();
  const horizon = state.forecastHorizon || 15;
  const pointCode = state.forecastPoint || "SAT-507";
  shell(forecasting(horizon, pointCode), {activePath:"/model-results", breadcrumb:"AI Forecasting"});
  document.querySelectorAll("[data-horizon]").forEach(button => button.addEventListener("click", () => {
    state.forecastHorizon = Number(button.dataset.horizon);
    renderModelResults();
  }));
  document.querySelector("[data-forecast-point]")?.addEventListener("change", event => {
    state.forecastPoint = event.target.value;
    renderModelResults();
  });
}
function renderSettings() {
  destroyActiveViewer();
  shell(settings(getSavedTheme(), connectionState), {activePath:"/settings",breadcrumb:"Settings"});
  const sections = document.querySelectorAll("[data-settings-section]");
  const tabs = document.querySelectorAll("[data-settings-tab]");
  const openTab = name => {
    sections.forEach(section => { section.hidden = section.dataset.settingsSection !== name; });
    tabs.forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.settingsTab === name)));
  };
  tabs.forEach(tab => tab.addEventListener("click", () => openTab(tab.dataset.settingsTab)));
  document.querySelectorAll("[data-appearance-option]").forEach(button => button.addEventListener("click", () => {
    applyTheme(button.dataset.appearanceOption, {persist:true});
  }));
  openTab("sources");
}
function renderHistoricalData() {
  destroyActiveViewer();
  shell(historical(), {activePath:"/historical-data",breadcrumb:"Historical Data"});
}

function renderSimulator() {
  destroyActiveViewer();
  shell(simulator(), {activePath:"/simulator",breadcrumb:"Sensor Simulator"});
}

function assistantDrawerHtml() {
  const context = selectedAssetContext();
  const anomaly = context.anomalies[0];
  return `<div class="drawer-backdrop" data-close-assistant></div>
    <aside class="drawer" aria-label="Asset Intelligence Assistant">
      <div class="drawer-header"><div><div class="drawer-title">□ Asset Intelligence Assistant</div><div class="drawer-subtitle">Grounded asset and engineering explanation</div></div><button class="icon-button" data-close-assistant>✕</button></div>
      <div class="drawer-body">
        <div class="context-chips"><span class="context-chip">${context.asset.asset_name}</span><span class="context-chip">${context.space?.space_name || 'Location'}</span><span class="context-chip">Anomaly Score ${anomaly?.anomaly_score?.toFixed(2) || '—'}</span></div>
        <div class="assistant-intro"><div class="assistant-intro-icon">□</div><h3>Understand the asset context</h3><p>Explore the demonstration signals and detection evidence. Responses are grounded in the temporary sensor and anomaly records loaded from PostgreSQL. Engineering documents and live BMS readings are not connected.</p></div>
        <div class="suggestions">
          <button class="suggestion-btn" data-ai-question="What changed before this anomaly?">What changed before this anomaly? <span>↑</span></button>
          <button class="suggestion-btn" data-ai-question="Why was this asset flagged?">Why was this asset flagged? <span>↑</span></button>
          <button class="suggestion-btn" data-ai-question="Show the recent sensor trend.">Show the recent sensor trend. <span>↑</span></button>
          <button class="suggestion-btn" data-ai-question="What does this airflow pattern mean?">What does this airflow pattern mean? <span>↑</span></button>
        </div>
        ${state.aiResponse ? `<div class="assistant-response">${escapeHtml(state.aiResponse)}</div>` : ""}
      </div>
      <div class="drawer-compose"><div class="compose-box"><textarea id="assistantInput" placeholder="Ask about this asset, its sensor behaviour, or the detected anomaly…"></textarea><button class="send-btn" id="assistantSend">↑</button></div><div class="assistant-disclaimer">ⓘ AI-generated explanation. Verify maintenance decisions using engineering procedures.</div></div>
    </aside>`;
}

function assistantAnswer(question) {
  const q = question.toLowerCase();
  const context = selectedAssetContext();
  const anomaly = context.anomalies[0];
  if (q.includes("changed") || q.includes("trend")) {
    const tempSensor = context.readings.find((r) => r.sensor_type === "Supply Air Temperature");
    const currentTemp = tempSensor?.reading?.value;
    return `In the PostgreSQL demonstration history, the supply-air temperature trend changes over the monitored period${currentTemp != null ? ` and the latest stored value is ${currentTemp} ${tempSensor.unit}` : ""}. Review the airflow, static-pressure and temperature records over the same time window before treating the anomaly as a maintenance diagnosis.`;
  }
  if (q.includes("why") || q.includes("flag")) return `The demonstration detector flagged ${context.asset.asset_name} because its multivariate signal pattern produced an anomaly score of ${anomaly?.anomaly_score?.toFixed(2) || '0.87'}. This score indicates deviation from the learned or configured normal pattern; it is not, by itself, a confirmed fault diagnosis.`;
  if (q.includes("airflow")) return "The current PostgreSQL anomaly record describes an airflow deviation. No supervised fault-classification result is connected in this build, so this should remain an anomaly requiring technical review rather than a confirmed diagnosis.";
  return `For ${context.asset.asset_name}, the current demo state is ${assetAnomalyStatus(context.asset.asset_id)}. The latest readings and anomaly evidence can be reviewed in the Sensor Data and Anomalies / Faults pages.`;
}

function bindAssistantDrawer() {
  document.querySelectorAll("[data-close-assistant]").forEach((el)=>el.addEventListener("click",()=>{ state.aiDrawerOpen=false; state.aiResponse=""; render(); }));
  document.querySelectorAll("[data-ai-question]").forEach((el)=>el.addEventListener("click",()=>{ state.aiResponse=assistantAnswer(el.dataset.aiQuestion); render(); }));
  const input = document.getElementById("assistantInput");
  const send = document.getElementById("assistantSend");
  const submit = () => {
    const q = input?.value.trim();
    if (!q) return;
    state.aiResponse = assistantAnswer(q);
    render();
  };
  send?.addEventListener("click", submit);
  input?.addEventListener("keydown", (e)=>{ if(e.key==="Enter" && !e.shiftKey){e.preventDefault();submit();} });
}

function renderAuth(kind) {
  destroyActiveViewer();
  const isRegister = kind === "register";
  app.innerHTML = `<div class="auth-page">
    <section class="auth-visual">
      <div class="auth-brand"><div class="brand-mark"></div><div><div style="font-weight:900">Asset Intelligence</div><div class="brand-subtitle" style="color:#9da8af">AI-Driven Digital Twin</div></div></div>
      <div><h2>Building operations with <span>clear safety status.</span></h2><p>A high-contrast BIM and asset-monitoring workspace designed for facility teams, technical staff and site users. Safety orange, amber, red and green states make abnormal conditions easier to recognise at a glance.</p></div>
      <div class="auth-safety-note">Prototype environment — alerts and sensor values shown in this project are demonstration data, not live building-control commands.</div>
    </section>
    <main class="auth-main"><div class="auth-wrap">
      <div class="auth-icon">${isRegister ? "♙+" : "↪"}</div>
      <h1 class="auth-heading">${isRegister ? "Create your account" : "Welcome back"}</h1>
      <p class="auth-sub">${isRegister ? "Sign up to get started" : "Log in to your account"}</p>
      <section class="auth-card">
        <button class="auth-btn google" id="googleAuth"><span style="color:#dd6200;font-weight:900">G</span> &nbsp; Continue with Google</button>
        <div class="auth-divider">OR</div>
        <form class="auth-form" id="authForm">
          <div><label class="label">Email</label><input class="field" id="authEmail" type="email" placeholder="you@example.com" required></div>
          <div><div class="auth-helper"><label class="label">Password</label>${!isRegister ? '<span class="auth-link" style="font-size:10px">Forgot password?</span>' : ''}</div><input class="field" id="authPassword" type="password" placeholder="••••••••" minlength="6" required></div>
          ${isRegister ? '<div><label class="label">Confirm Password</label><input class="field" id="authConfirm" type="password" placeholder="••••••••" minlength="6" required></div>' : ''}
          <div class="auth-error" id="authError"></div>
          <button class="auth-btn primary" type="submit">${isRegister ? "Create account" : "Log in"}</button>
        </form>
      </section>
      <div class="auth-bottom">${isRegister ? 'Already have an account? <span class="auth-link" data-auth-link="/login">Log in</span>' : 'Don\'t have an account? <span class="auth-link" data-auth-link="/register">Create one</span>'}</div>
    </div></main>
  </div>`;

  document.querySelectorAll("[data-auth-link]").forEach(el=>el.addEventListener("click",()=>go(el.dataset.authLink)));
  document.getElementById("googleAuth")?.addEventListener("click",()=>go("/"));
  document.getElementById("authForm")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const error = document.getElementById("authError");
    if (isRegister) {
      const confirm = document.getElementById("authConfirm").value;
      if (password !== confirm) { error.textContent = "Passwords do not match."; return; }
      localStorage.setItem("assetIntelligenceDemoUser", JSON.stringify({email}));
    }
    if (!email || password.length < 6) { error.textContent = "Enter a valid email and a password of at least 6 characters."; return; }
    go("/");
  });
}

function renderNotFound() {
  destroyActiveViewer();
  shell(`<div class="page"><section class="panel" style="max-width:620px;margin:70px auto;padding:30px"><div class="eyebrow">404</div><h1 class="page-title">Page not found</h1><p class="page-subtitle" style="margin-bottom:18px">The requested prototype route does not exist.</p><button class="btn btn-primary" id="home404">Return to Dashboard</button></section></div>`, {breadcrumb:"Not Found"});
  document.getElementById("home404")?.addEventListener("click",()=>go("/"));
}

function render() {
  const path = pathName();
  if (path === "/login") return renderAuth("login");
  if (path === "/register") return renderAuth("register");
  if (path === "/") return renderDashboard();
  if (path === "/bim-viewer") return renderBimViewer();
  if (path === "/assets") return renderAssets();
  if (path.startsWith("/assets/")) return renderAssetDetail(path.split("/")[2]);
  if (path === "/sensor-data") return renderSensorData();
  if (path === "/historical-data") return renderHistoricalData();
  if (path === "/simulator") return renderSimulator();
  if (path === "/anomalies") return renderAnomalies();
  if (path === "/model-results") return renderModelResults();
  if (path === "/settings") return renderSettings();
  return renderNotFound();
}

function renderDatabaseError(error) {
  destroyActiveViewer();
  app.innerHTML = `<div class="database-error-page"><section class="database-error-card"><div class="eyebrow">Database Connection</div><h1>PostgreSQL is not available</h1><p>The frontend is ready, but it could not load the temporary Digital Twin records from the backend API.</p><div class="database-error-detail">${escapeHtml(error?.message || "Unknown connection error")}</div><ol><li>Make sure PostgreSQL is running.</li><li>Create the <strong>digital_twin</strong> database.</li><li>Run <code>psql -d digital_twin -f database/postgres_init.sql</code>.</li><li>Check <code>.env</code> if your PostgreSQL user or password is different.</li><li>Restart <code>npm run dev</code>.</li></ol><button class="btn btn-primary" id="retryDatabase">Retry connection</button></section></div>`;
  document.getElementById("retryDatabase")?.addEventListener("click", initialize);
}

function refreshInspectorOnly() {

  const inspector =
    document.querySelector(
      ".asset-inspector"
    );

  if (!inspector) {
    return;
  }


  inspector.outerHTML =
    assetInspectorHtml({
      detailed:
        pathName() ===
        "/bim-viewer"
    });


  bindAssetInspector();
}


function startLiveUpdates() {

  if (liveEventSource) {
    return;
  }


  liveEventSource =
    new EventSource(
      "/api/events"
    );


  liveEventSource.addEventListener(
    "connected",
    () => {

      console.log(
        "Live Digital Twin stream connected"
      );
    }
  );


  liveEventSource.addEventListener(
    "sensor-reading",
    (event) => {

      try {

        const reading =
          JSON.parse(
            event.data
          );


        // Update frontend cache.
        applyLiveReading(
          reading
        );

        // Update visible monitoring cards without rebuilding the xeokit scene
        // or rerendering the entire SPA on every MQTT message.
        document.querySelectorAll("[data-channel]").forEach(card => {
          if (card.dataset.channel !== String(reading.point_code)) return;
          const point = db.Sensor_Points.find(p => String(p.point_code) === String(reading.point_code));
          const valueNode = card.querySelector(".point-value");
          const timeNode = card.querySelector(".point-time");
          const qualityNode = card.querySelector(".point-quality");
          if (valueNode) {
            const value = Number(reading.value);
            valueNode.textContent = (Number.isFinite(value)
              ? value.toLocaleString(undefined, {maximumFractionDigits:2})
              : "—") + " " + (point?.unit || "");
          }
          if (timeNode) timeNode.textContent = String(reading.timestamp || reading.latest_update || "—");
          if (qualityNode) qualityNode.textContent = String(reading.quality || "simulated");
        });

        refreshMiniOverview(state.selectedBimElement?.entityId);
        updateAssetDetailLiveReading(
          reading
        );


        // -----------------------------------------------
        // Is the currently selected BIM sensor affected?
        // -----------------------------------------------

        const sensor =
          state.selectedBimElement?.entityId
            ? getSensorByBimId(
                state.selectedBimElement.entityId
              )
            : null;


        if (
          sensor &&
          String(
            sensor.sensor_id ??
            sensor.sensor_code
          ) ===
          String(
            reading.sensor_id
          )
        ) {

          refreshInspectorOnly();

          return;
        }


        // -----------------------------------------------
        // Otherwise update the selected asset inspector
        // when this reading belongs to that asset.
        // -----------------------------------------------

        if (
          String(
            state.selectedAssetId
          ) ===
          String(
            reading.asset_id
          )
        ) {

          refreshInspectorOnly();
        }


      } catch (error) {

        console.error(
          "Live reading update failed:",
          error
        );
      }
    }
  );


  liveEventSource.onerror =
    () => {

      console.warn(
        "Live Digital Twin stream disconnected; browser will retry automatically."
      );
    };
}

async function initialize() {
  app.innerHTML = `<div class="database-loading"><div class="database-loading-mark"></div><h1>Connecting to Digital Twin data</h1><p>Loading Snowdon Towers assets, sensors, readings and anomalies from PostgreSQL…</p></div>`;
  try {
    await loadDatabaseFromApi();

    if (!db.Assets.length) {
      throw new Error(
        "PostgreSQL connected, but no asset records were returned."
      );
    }

    if (
      !getAssetById(
        state.selectedAssetId
      )
    ) {
      state.selectedAssetId =
        db.Assets[0].asset_id;
    }

    startLiveUpdates();

    render();
  } catch (error) {
    connectionState.status = "error";
    connectionState.error = error?.message || String(error);
    renderDatabaseError(error);
  }
}

// Freshness can expire even without new MQTT events.
setInterval(() => refreshMiniOverview(state.selectedBimElement?.entityId), 30_000);
window.addEventListener("popstate", render);
initialize();
