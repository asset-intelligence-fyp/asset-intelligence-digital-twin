// Only the supplied independent, synthetic three-HRU stream is eligible
// for the active nine-point PoC; legacy simulator telemetry is intentionally
// rejected even when an old publisher happens to use a matching topic.
export const LIVE_PROVENANCE = "STATEFUL_SYNTHETIC_TRAIN_CALIBRATED_THREE_HRU";
export const LIVE_POINT_ASSETS = Object.freeze({
  "SAT-501A": "HRU501A",
  "MAT-501A": "HRU501A",
  "FS-501A": "HRU501A",
  "SAT-504": "HRU504",
  "DP-504": "HRU504",
  "DPCMD-504": "HRU504",
  "SAT-507": "HRU507",
  "CV-507": "HRU507",
  "S-L5-008-TEMP": "HRU507"
});
const percentPoints = new Set(["DP-504","DPCMD-504","CV-507"]);
export function validateLiveMqttMessage(topic, message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return {ok:false,reason:"invalid JSON payload"};
  const code = String(message.point_code ?? "");
  const expectedAsset = LIVE_POINT_ASSETS[code];
  if (!expectedAsset) return {ok:false,reason:"inactive or unknown point",point_code:code};
  if (message.provenance !== LIVE_PROVENANCE || message.generation_mode !== "independent_simulation")
    return {ok:false,reason:"legacy or unapproved publisher",point_code:code};
  if (message.asset_id !== expectedAsset || message.sensor_id !== code)
    return {ok:false,reason:"sensor/asset mismatch",point_code:code};
  if (topic !== `dt/${expectedAsset}/${code}`)
    return {ok:false,reason:"topic/payload mismatch",point_code:code};
  if (message.quality !== "simulated")
    return {ok:false,reason:"unexpected source quality",point_code:code};
  if (typeof message.timestamp !== "string" || !Number.isFinite(Date.parse(message.timestamp)))
    return {ok:false,reason:"invalid publish timestamp",point_code:code};
  if (typeof message.source_timestamp !== "string" ||
      !Number.isFinite(Date.parse(message.source_timestamp.replace(" ", "T"))))
    return {ok:false,reason:"missing/invalid simulation timestamp",point_code:code};
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 1)
    return {ok:false,reason:"invalid sequence",point_code:code};
  if (typeof message.value !== "number" || !Number.isFinite(message.value))
    return {ok:false,reason:"invalid numerical reading",point_code:code};
  if (code === "FS-501A" && ![0,1].includes(message.value))
    return {ok:false,reason:"fan must be 0/1",point_code:code};
  if (percentPoints.has(code) && (message.value < 0 || message.value > 100))
    return {ok:false,reason:"percentage outside range",point_code:code};
  return {ok:true,point_code:code,asset_id:expectedAsset};
}
