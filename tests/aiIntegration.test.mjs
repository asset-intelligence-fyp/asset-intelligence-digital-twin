import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_POINTS, expectedClaims, findingSignal, schema, verifyHybridSemantic } from '../server/aiCore.js';
import { AIError, callOllama, retrieveLevel5Evidence, validateAnalysisInput } from '../server/aiService.js';
const input = { point_code: 'SAT-501A', window_start: '2026-10-27T09:00:00+08:00', window_end: '2026-10-27T10:00:00+08:00', question: 'Compare historical temperatures.' };
const now = Date.parse('2026-11-03T09:00:00+08:00');
function pool(averages = [18, 18.1, 18.2, 18.3, 18.4]) {
  const readings = [
    { reading_timestamp: '2026-10-27T01:00:00Z', reading_value: '19.0', quality: 'simulated' },
    { reading_timestamp: '2026-10-27T01:30:00Z', reading_value: '19.2', quality: 'simulated' },
    { reading_timestamp: '2026-10-27T02:00:00Z', reading_value: '19.4', quality: 'simulated' }
  ];
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM sensor_points sp/.test(sql)) return { rows: [{ point_code: 'SAT-501A', sensor_code: 'SAT-501A', measurement_type: 'Supply Air Temperature', unit: '°C', equipment_code: 'HRU501A', location_code: 'L5-501A', location_name: 'HRU 501A', data_source: 'Simulated' }] };
    if (/ORDER BY reading_timestamp DESC LIMIT/.test(sql)) return { rows: [...readings] };
    if (/AVG\(sr.reading_value\)/.test(sql)) return { rows: averages.map((mean_value, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, mean_value, n: 10 })) };
    throw Error('Unexpected SQL');
  } };
}
const makeDraft = e => ({
  finding: 'The readings are within the expected historical range.', needs_investigation: false,
  affected_rooms: [e.room_id], evidence: [], possible_explanations: [], recommended_checks: [], limitations: [],
  sensor_id: e.sensor_id, room_id: e.room_id, anomaly_status: e.anomaly_assessment.status,
  numeric_claims: expectedClaims(e)
});
test('registered Level 5 points are nine exactly; no fictitious Level 3 mapping', () => {
  assert.equal(ACTIVE_POINTS.length, 9); assert(!ACTIVE_POINTS.includes('CO2-L03-MEET-01'));
});
test('request validation rejects noncanonical points, future data, custom tools, or missing Malaysia offset', () => {
  assert.equal(validateAnalysisInput(input, now).point, 'SAT-501A');
  for (const invalid of [
    { ...input, point_code: 'CO2-L03-MEET-01' },
    { ...input, sql: 'DROP TABLE sensors' },
    { ...input, window_end: '2026-11-05T00:00:00+08:00' },
    { ...input, window_end: '2026-10-27T10:00:00Z' },
    { ...input, window_start: '2026-10-27T11:00:00+08:00' }
  ]) assert.throws(() => validateAnalysisInput(invalid, now), AIError);
});
test('read-only, parameterized SQL evidence contains trusted numbers and earlier baseline', async () => {
  const fake = pool(); const e = await retrieveLevel5Evidence(fake, validateAnalysisInput(input, now));
  assert.equal(e.current_window.count, 3);
  assert.equal(e.current_window.average, 19.2);
  assert.equal(e.current_window.maximum, 19.4);
  assert.equal(e.historical_baseline.selected_days, 5);
  assert.equal(e.anomaly_assessment.status, 'within_historical_variation');
  assert.equal(e.operating_context.occupancy_available, false);
  assert(fake.calls.every(call => call.params[0] === 'SAT-501A'));
  assert(fake.calls.every(call => !call.sql.includes('SAT-501A')));
  assert(fake.calls.some(call => /AT TIME ZONE 'Asia\/Kuching'/.test(call.sql)));
});
test('insufficient history never produces a rule-based normal or fault classification', async () => {
  const e = await retrieveLevel5Evidence(pool([18, 19]), validateAnalysisInput(input, now));
  assert.equal(e.anomaly_assessment.status, 'insufficient_evidence');
  const draft = makeDraft(e); draft.finding = 'Historical data is insufficient';
  const v = verifyHybridSemantic(draft, e);
  assert.equal(v.verification.passed, true); assert.equal(v.decision_assessment.status, 'insufficient_evidence');
  assert.equal(v.decision_assessment.triage_alert, null);
});
test('R4.3.1 adapted numeric verifier rejects swapped values even when prose sounds correct', async () => {
  const e = await retrieveLevel5Evidence(pool(), validateAnalysisInput(input, now));
  const draft = makeDraft(e); draft.numeric_claims.observed_average = e.current_window.maximum;
  const v = verifyHybridSemantic(draft, e);
  assert.equal(v.verification.passed, false); assert(v.verification.issues.some(x => x.includes('observed_average')));
});
test('LLM-versus-rule disagreement escalates without replacing verified numerical evidence', async () => {
  const e = await retrieveLevel5Evidence(pool(), validateAnalysisInput(input, now));
  const draft = makeDraft(e); draft.finding = 'The unusual temperature requires further investigation.'; draft.needs_investigation = true;
  const v = verifyHybridSemantic(draft, e);
  assert.equal(v.verification.passed, true);
  assert.equal(v.decision_assessment.disagreement, true);
  assert.equal(v.decision_assessment.status, 'review_required');
  assert.equal(v.decision_assessment.triage_alert, true);
});
test('explicit contradictory finding/boolean decision is marked unscorable and reviewed', async () => {
  const e = await retrieveLevel5Evidence(pool(), validateAnalysisInput(input, now));
  const draft = makeDraft(e); draft.finding = 'Unusually high temperature requires investigation.';
  const v = verifyHybridSemantic(draft, e);
  assert.equal(v.verification.semantic_conflict, true);
  assert.equal(v.decision_assessment.scorable_llm_alert, null);
  assert.equal(v.decision_assessment.status, 'review_required');
  assert.equal(findingSignal('No anomaly was detected.'), 'normal_asserted');
});
test('Qwen3 uses local Ollama, P2 concise and constrained numeric schema', async () => {
  const evidence = await retrieveLevel5Evidence(pool(), validateAnalysisInput(input, now));
  let sent;
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:11434\/api\/chat$/);
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(makeDraft(evidence)) } }) };
  };
  const draft = await callOllama(evidence, 'Analyse sensor history', { fetchImpl });
  assert.equal(draft.sensor_id, 'SAT-501A'); assert.equal(sent.model, 'qwen3:1.7b');
  assert.equal(sent.options.temperature, 0); assert.equal(sent.format.type, 'object');
  assert.deepEqual(sent.format, schema()); assert.match(sent.messages[0].content, /P2 CONCISE/);
  await assert.rejects(callOllama(evidence, 'x', { fetchImpl, url: 'https://example.com' }), /loopback/);
});