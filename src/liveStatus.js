// Reflect the number of active Level 5 points actually accepted by
// PostgreSQL. Broker connectivity alone never counts as "9/9 live".
let timer = null;
async function refresh() {
  let status = null;
  try {
    const response = await fetch("/api/live-status", {cache:"no-store"});
    if (!response.ok) throw new Error("status unavailable");
    status = await response.json();
  } catch (_error) {
    // The API can be down independently from the browser page.
  }
  const total = status?.expected_points ?? 9;
  const received = status?.received_points ?? 0;
  const connected = Boolean(status?.mqtt_connected);
  const ready = connected && received === total;
  const label = !connected ? "MQTT disconnected" :
    ready ? `Synthetic MQTT · ${received}/${total}` :
    `Synthetic MQTT · ${received}/${total} recent`;
  document.querySelectorAll("[data-live-chip], [data-live-status]").forEach(node => {
    node.textContent = label;
    node.title = "Independent synthetic stream: number of active data points accepted within 90 seconds. Not physical measurements.";
  });
  const missing = (status?.points || []).filter(point => !point.recent).map(point => point.point_code);
  document.querySelectorAll("[data-live-coverage]").forEach(node => {
    node.textContent = ready ? "All nine independent simulator points are reporting." :
      "Not reporting: " + (missing.length ? missing.join(", ") : "status unavailable");
  });
  document.querySelectorAll("[data-live-last]").forEach(node => {
    node.textContent = status?.last_received_at
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

