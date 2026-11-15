// Level 5 adapter of the R4.3.1 evidence-validation and semantic-review policy.
// No ground-truth labels, training data, or model-generated numbers enter these checks.
export const ACTIVE_POINTS = Object.freeze([
  'SAT-501A', 'MAT-501A', 'FS-501A', 'SAT-504', 'DP-504',
  'DPCMD-504', 'SAT-507', 'CV-507', 'S-L5-008-TEMP'
]);
export const NUMERIC_KEYS = Object.freeze([
  'observed_average', 'observed_minimum', 'observed_maximum',
  'observed_last', 'historical_median', 'baseline_difference', 'baseline_threshold'
]);
export const MODEL = 'qwen3:1.7b';
export const PROMPT_VARIANT = 'concise';
export const VALIDATION_MODE = 'hybrid_semantic';

const isNum = x => typeof x === 'number' && Number.isFinite(x);
export const round3 = x => Math.round(x * 1000) / 1000;
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
export function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1));
}
export function expectedClaims(evidence) {
  const cur = evidence.current_window || {};
  const hist = evidence.historical_baseline || {};
  const rule = evidence.anomaly_assessment || {};
  return {
    observed_average: cur.average ?? null,
    observed_minimum: cur.minimum ?? null,
    observed_maximum: cur.maximum ?? null,
    observed_last: cur.last?.value ?? null,
    historical_median: hist.window_mean_median ?? null,
    baseline_difference: rule.difference ?? null,
    baseline_threshold: rule.absolute_threshold ?? null,
    observed_maximum_time: cur.maximum_time ?? null
  };
}
const close = (a, b) => a === null || b === null ? a === b :
  isNum(a) && isNum(b) && Math.abs(a - b) <= Math.max(.02, Math.abs(b) * .0001);
export function trustedEvidence(e) {
  const c = e.current_window, h = e.historical_baseline, r = e.anomaly_assessment;
  if (!c) return [e.reason || 'No sufficiently complete sensor window in PostgreSQL.'];
  const unit = e.unit || '';
  const lines = [
    `Source: read-only PostgreSQL sensor_readings; synthetic Level 5 point ${e.sensor_id} (${e.room_id})`,
    `Window: ${e.period.start} to ${e.period.end}`,
    `${c.count} quality-accepted readings; minimum ${c.minimum} ${unit} at ${c.minimum_time}; maximum ${c.maximum} ${unit} at ${c.maximum_time}`,
    `Average ${c.average} ${unit}; latest ${c.last.value} ${unit} at ${c.last.timestamp}`
  ];
  if (h?.selected_days >= 5) lines.push(`Baseline: ${h.selected_days} earlier same-weekday, same-local-time daily means; median ${h.window_mean_median} ${unit}. No occupancy matching.`);
  else lines.push('Insufficient prior comparable days for a historical-baseline classification.');
  lines.push(`Exploratory rule: ${r?.status || 'insufficient_evidence'}; not an equipment fault diagnosis.`);
  return lines;
}
const POSITIVE = [
  /\b(?:unusually|abnormally|anomalously)\s+(?:high|low|elevated|warm|cold|rapid)\b/i,
  /\b(?:unusual|abnormal|anomalous|concerning|suspicious)\s+(?:temperature|co2|reading|readings|value|pattern|condition|level|deviation)\b/i,
  /\b(?:anomaly|abnormality|fault)\s+(?:was|is|has been)\s+(?:detected|observed|identified|flagged)\b/i,
  /\b(?:requires?|warrants?|needs?)\s+(?:further\s+)?(?:investigation|attention)\b/i
];
const NEGATIVE = [
  /\b(?:within|inside)\s+(?:the\s+)?(?:normal|expected|historical)\s+(?:range|variation|limits?|thresholds?)\b/i,
  /\b(?:no|without)\s+(?:clear\s+|significant\s+|evidence\s+of\s+)?(?:an?\s+)?(?:anomaly|abnormality|fault|unusual\s+pattern)\b/i,
  /\b(?:does|did)\s+not\s+(?:show|indicate|detect|flag|suggest)\s+(?:any\s+|an?\s+)?(?:anomaly|unusual|abnormal|fault)\b/i,
  /\b(?:not\s+flagged|no\s+alert|not\s+anomalous)\b/i,
  /\b(?:is|was)\s+not\s+(?:behaving\s+)?(?:unusually|abnormally|anomalously)\b/i
];
export function findingSignal(finding) {
  if (typeof finding !== 'string' || !finding.trim()) return 'undetermined';
  const negative = NEGATIVE.some(re => re.test(finding));
  const positive = POSITIVE.some(re => {
    const match = re.exec(finding);
    if (!match) return false;
    const prefix = finding.slice(Math.max(0, match.index - 26), match.index);
    return !/\b(?:no|not|without|never)\b[^.!?;,]{0,20}$/i.test(prefix) &&
      !/\b(?:no|not|without|never)\s+(?:an?\s+)?(?:unusual|abnormal|anomalous)\b/i.test(match[0]);
  });
  if (positive && negative) return 'mixed';
  if (positive) return 'anomaly_asserted';
  if (negative) return 'normal_asserted';
  return 'undetermined';
}
export function schema() {
  const fields = Object.fromEntries(NUMERIC_KEYS.map(k => [k, { type: ['number', 'null'] }]));
  fields.observed_maximum_time = { type: ['string', 'null'] };
  const props = {
    finding: { type: 'string' }, needs_investigation: { type: 'boolean' },
    affected_rooms: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    possible_explanations: { type: 'array', items: { type: 'string' } },
    recommended_checks: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
    sensor_id: { type: 'string' }, room_id: { type: 'string' },
    anomaly_status: { type: 'string', enum: ['potential_anomaly', 'within_historical_variation', 'insufficient_evidence'] },
    numeric_claims: { type: 'object', properties: fields, required: Object.keys(fields), additionalProperties: false }
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}
export function verifyHybridSemantic(draft, evidence) {
  const issues = [], warnings = [];
  const expected = expectedClaims(evidence);
  const status = evidence.anomaly_assessment?.status || 'insufficient_evidence';
  const ruleAlert = status === 'potential_anomaly' ? true : status === 'within_historical_variation' ? false : null;
  const keys = Object.keys(schema().properties);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) issues.push('Invalid structured LLM JSON');
  else {
    for (const key of keys) if (!(key in draft)) issues.push(`Missing ${key}`);
    for (const key of Object.keys(draft)) if (!keys.includes(key)) issues.push(`Unexpected ${key}`);
    if (draft.sensor_id !== evidence.sensor_id) issues.push('Incorrect sensor_id');
    if (draft.room_id !== evidence.room_id) issues.push('Incorrect room_id');
    if (JSON.stringify(draft.affected_rooms) !== JSON.stringify([evidence.room_id])) issues.push('Incorrect affected_rooms');
    if (draft.anomaly_status !== status) issues.push('Incorrect anomaly_status');
    if (typeof draft.finding !== 'string') issues.push('Invalid finding');
    if (typeof draft.needs_investigation !== 'boolean') issues.push('Invalid needs_investigation');
    for (const key of ['evidence', 'possible_explanations', 'recommended_checks', 'limitations']) {
      if (!Array.isArray(draft[key]) || !draft[key].every(x => typeof x === 'string')) issues.push(`Invalid ${key}`);
    }
    const claims = draft.numeric_claims;
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) ||
        JSON.stringify(Object.keys(claims).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
      issues.push('Invalid numeric_claims keys');
    } else {
      for (const key of NUMERIC_KEYS) if (!close(claims[key], expected[key])) issues.push(`Incorrect ${key}`);
      if (claims.observed_maximum_time !== expected.observed_maximum_time) issues.push('Incorrect observed_maximum_time');
    }
  }
  if (!evidence.current_window) issues.push('Missing verified sensor window');
  const passed = issues.length === 0;
  const rawAlert = typeof draft?.needs_investigation === 'boolean' ? draft.needs_investigation : null;
  const signal = findingSignal(draft?.finding);
  const conflict = passed && ((signal === 'anomaly_asserted' && rawAlert === false) ||
    (signal === 'normal_asserted' && rawAlert === true));
  if (conflict) warnings.push('LLM finding contradicts needs_investigation; human review required');
  if (signal === 'mixed') warnings.push('Mixed finding language; review model draft');
  const disagreement = passed && ruleAlert !== null && rawAlert !== ruleAlert;
  if (disagreement) warnings.push('LLM and exploratory rule disagree; neither is ground truth');
  let decisionStatus, triageAlert, reviewRequired;
  if (!passed) { decisionStatus = 'validation_failed'; triageAlert = null; reviewRequired = true; }
  else if (ruleAlert === null) { decisionStatus = 'insufficient_evidence'; triageAlert = null; reviewRequired = true; }
  else if (conflict || disagreement || signal === 'mixed') { decisionStatus = 'review_required'; triageAlert = true; reviewRequired = true; }
  else { decisionStatus = rawAlert ? 'alert' : 'no_alert'; triageAlert = rawAlert; reviewRequired = false; }
  return {
    verification: { mode: 'r4.3.1_semantic_review_level5_adapter', passed, issues, warnings,
      numeric_claims_passed: passed || !issues.some(x => /numeric_claims|Incorrect observed_|Incorrect historical_|Incorrect baseline_/.test(x)),
      semantic_conflict: conflict, finding_signal: signal, narrative_published: false,
      expected_numeric_claims: expected,
      limitations: ['Level 5 PostgreSQL adapter does not reproduce Level 03 occupancy/HVAC-matched baselines.',
        'Numerical verification does not establish a fault cause or certify all natural-language explanations.'] },
    decision_assessment: { status: decisionStatus, llm_alert: passed ? rawAlert : null,
      raw_llm_alert: rawAlert, scorable_llm_alert: passed && !conflict && ruleAlert !== null ? rawAlert : null,
      rule_alert: ruleAlert, disagreement, semantic_conflict: conflict,
      human_review_required: reviewRequired, triage_alert: triageAlert },
    evidence: trustedEvidence(evidence)
  };
}