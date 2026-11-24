"""Website adapter for the UNMODIFIED E8-A screening/retrieval/verification pipeline.

Unlike the research DuckDB, the website's telemetry is an HTTP simulation
stream. We copy only source observations and canonical room/sensor IDs into a
temporary, label-free DuckDB per inference request. Five-minute resampling
uses the *last actually observed value* in each bucket, not interpolation.
No test keys, ground truth, or future measurements can reach LangGraph.
"""
from __future__ import annotations
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

MAX_ROWS = 18000
MAX_HISTORY_DAYS = 90
BAD_QUALITY = {'missing', 'invalid', 'bad', 'fault', 'error'}
SUPPORTED = {'temperature', 'humidity', 'co2', 'light', 'power', 'water_leakage'}
FORBIDDEN = {'label', 'labels', 'ground_truth', 'fault_active', 'fault_type',
             'anomaly_label', 'event_id', 'actual_status', 'is_anomaly'}


def _utc(value):
    if not isinstance(value, str):
        raise ValueError('An observation timestamp must be an ISO string')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Observation timestamps require an explicit UTC offset')
    return parsed.astimezone(timezone.utc)


def normalise_e8a_request(request):
    if not isinstance(request, dict):
        raise ValueError('E8-A requires a request object')
    if FORBIDDEN.intersection(request):
        raise ValueError('Ground-truth fields are forbidden')
    as_of = _utc(request.get('as_of'))
    target = request.get('sensor_id')
    points = request.get('points')
    history = request.get('history')
    if not isinstance(points, list) or not 1 <= len(points) <= 18:
        raise ValueError('Canonical sensor metadata required')
    if not isinstance(history, list) or len(history) > MAX_ROWS:
        raise ValueError('At most 18000 source observations accepted')
    registry = {}
    for point in points:
        if not isinstance(point, dict) or FORBIDDEN.intersection(point):
            raise ValueError('Invalid canonical sensor metadata')
        code, room, kind = point.get('code'), point.get('assetId'), point.get('sensorType')
        if not isinstance(code, str) or not isinstance(room, str) or kind not in SUPPORTED:
            continue
        if len(code) > 100 or len(room) > 100:
            raise ValueError('Invalid sensor identifiers')
        registry[code] = (room, kind)
    if target not in registry:
        raise ValueError('Target is not a supported canonical sensor')
    # Keep one LAST observed value for each five-minute UTC bucket, without
    # inventing samples at empty intervals or using data after as_of.
    latest = {}
    from_time = as_of.timestamp() - MAX_HISTORY_DAYS * 86400
    for row in history:
        if not isinstance(row, dict) or FORBIDDEN.intersection(row):
            raise ValueError('Unlabelled telemetry rows only')
        code = row.get('point_code')
        if code not in registry:
            continue
        value = row.get('value')
        if type(value) not in (float, int) or not math.isfinite(value):
            continue
        if str(row.get('quality', '')).lower() in BAD_QUALITY:
            continue
        try:
            observed = _utc(row.get('timestamp'))
        except (ValueError, TypeError):
            continue
        observed_s = observed.timestamp()
        if not from_time <= observed_s <= as_of.timestamp():
            continue
        bucket = int(observed_s // 300) * 300
        key = code, bucket
        prior = latest.get(key)
        if prior is None or prior[0] < observed_s:
            latest[key] = (observed_s, float(value))
    result = []
    for (code, bucket), (_, value) in sorted(latest.items(), key=lambda r: (r[0][0], r[0][1])):
        result.append((datetime.fromtimestamp(bucket, tz=timezone.utc).replace(tzinfo=None),
                       code, registry[code][0], value))
    target_rows = [row for row in result if row[1] == target]
    if not target_rows:
        raise ValueError('No valid target observations at the selected cutoff')
    target_at = target_rows[-1][0]
    return result, target, target_at.strftime('%Y-%m-%dT%H:%M:%SZ'), as_of.isoformat()


def analyse_e8a_website(request, model='qwen3:1.7b', max_rounds=2):
    if model != 'qwen3:1.7b':
        raise ValueError('This website integration uses the E8-A Qwen3 1.7B research model')
    rows, target, at, requested_cutoff = normalise_e8a_request(request)
    # Imports are delayed deliberately: the site's existing Qwen bridge and
    # non-AI functionality must still start if E8-A dependencies are missing.
    import duckdb
    from tyra_agentic_rag_m1.src.retrieval import TemporalRetriever
    from tyra_agentic_rag_m1.src.e8a import run_e8a_detection
    from tyra_agentic_rag_m1.src.local_llm import OllamaJSON
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='twinlabs_e8a_') as temp:
        db = Path(temp) / 'readings.duckdb'
        con = duckdb.connect(str(db))
        try:
            con.execute('CREATE TABLE readings (timestamp TIMESTAMP, sensor_id VARCHAR, zone_id VARCHAR, value DOUBLE)')
            con.executemany('INSERT INTO readings VALUES (?,?,?,?)', rows)
        finally:
            con.close()
        retriever = TemporalRetriever(target, at, task='detect', db_path=db)
        llm = OllamaJSON(model=model, host=os.environ.get('OLLAMA_URL') or os.environ.get('OLLAMA_HOST') or 'http://127.0.0.1:11434')
        decision = run_e8a_detection(retriever, llm, max_rounds=max_rounds)
    return {
        'workflow': 'E8-A', 'model': model, 'source': 'synthetic_http_telemetry',
        'aggregation': 'last_observed_value_per_UTC_5_minute_bucket',
        'sensor_id': target, 'as_of': at, 'requested_cutoff': requested_cutoff,
        'source_observation_count': len(rows), 'screening_status': decision['screening_status'],
        'screening': decision['screening'],
        'verified_status': decision['verified_status'],
        'verification': decision.get('verification'),
        'evidence_status': decision['evidence_status'],
        'validation': decision.get('validation'),
        'review_audit': decision.get('review_audit'),
        'trace': decision.get('trace', []),
        'trajectory': decision.get('trajectory'),
        'evidence_count': decision.get('evidence_count', 0),
        'elapsed_seconds': round(time.monotonic() - started, 2),
        'limitations': [
            'Five-minute buckets retain the last observed synthetic HTTP value; gaps are not interpolated.',
            'No labels, future data or verified physical sensor measurements were used.',
            'Verified means citations/numeric comparisons are grounded; it does not prove anomaly classification is correct.',
            'Sparse current data or absent older comparable days may force a verified unknown/abstention.',
        ],
    }
