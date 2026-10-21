// Status reflects accepted PostgreSQL inserts, not just a browser SSE connection.
// A connected broker without recent accepted readings must not appear "live".
let timer = null;
async function refresh() {
  let status;
  try {
    const response = await fetch("/api/live-status", {cache:"no-store"});
    if (!response.ok) throw new Error("Backend status unavailable");
    status = await response.json();
  } catch (_error) {
    status = {mqtt_connected:false,recent:false,last_received_at:null};
  }
  const label = !status.mqtt_connected ? "MQTT disconnected" :
    status.recent ? "Synthetic MQTT · live" :
    status.last_received_at ? "Synthetic MQTT · stale" : "MQTT waiting for data";
  document.querySelectorAll("[data-live-chip], [data-live-status]").forEach(node => {
    node.textContent = label;
    node.title = "Synthetic telemetry only. Never physical building sensor data.";
  });
  document.querySelectorAll("[data-live-last]").forEach(node => {
    node.textContent = status.last_received_at
      ? new Date(status.last_received_at).toLocaleString() +
        (status.last_point_code ? " · " + status.last_point_code : "")
      : "No accepted readings yet";
  });
}
export function startLiveStatusMonitoring() {
  if (timer !== null) return;
  void refresh();
  timer = setInterval(refresh, 5000);
}
