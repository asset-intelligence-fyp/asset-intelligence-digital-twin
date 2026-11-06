#!/usr/bin/env python3
"""Combine *measured* one-month forecast and anomaly reports without merging metrics."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


def generate(forecast_path, anomaly_path, output):
    forecast = json.loads(Path(forecast_path).read_text(encoding='utf8'))
    anomaly = json.loads(Path(anomaly_path).read_text(encoding='utf8'))
    if forecast.get('horizon_months') != 1 or not isinstance(forecast.get('summary'), list):
        raise ValueError('Expected a one-month forecasting summary')
    if anomaly.get('method') != 'blind_synthetic_fault_cases' or not isinstance(anomaly.get('methods'), dict):
        raise ValueError('Expected a blind anomaly evaluation summary')
    complete = not forecast.get('partial_run', True) and anomaly.get('status') == 'evaluated'
    report = {
        'status': 'complete' if complete else 'partial',
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'forecasting': {
            'horizon_months': 1, 'model': forecast.get('model'),
            'planned_cases': forecast.get('expected_planned_cases'),
            'evaluated_cases': forecast.get('overall', {}).get('valid_predictions'),
            'per_sensor': [{key: row.get(key) for key in
                ('sensor_id','unit','planned_cases','valid_predictions','MAE','RMSE',
                 'WAPE_pct','bias','persistence_MAE','skill_vs_persistence_pct',
                 'skill_vs_seasonal_naive_pct')} for row in forecast['summary']],
            'note': 'Raw errors across °C, %RH and ppm are not averaged.'},
        'anomaly_detection': {
            'total_cases': anomaly.get('total_cases'),
            'evaluated_cases': anomaly.get('evaluated_cases'),
            'methods': anomaly['methods'],
            'events': anomaly.get('event_results'),
            'reliability': anomaly.get('reliability')},
        'limitations': [
            'Synthetic sensor data and fault injections are not independent real-building measurements.',
            'This is a one-month point-value forecast, not an entire month of values.',
            'The reported forecast accuracy index (100-WAPE) is not classification accuracy.',
            'The anomaly diagnostic sample is event-balanced; precision is sample-dependent.',
            'Numeric validation is not a substitute for a human explanation-quality assessment.',
            'Prompt tuning on tested periods or seeds requires a fresh held-out evaluation.'
        ]}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf8')
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--forecast', default='reports/llm_one_month_eval/summary.json')
    ap.add_argument('--anomaly', default='reports/llm_anomaly_eval/summary.json')
    ap.add_argument('--out', default='reports/llm_research_evaluation.json')
    args = ap.parse_args(argv)
    result = generate(args.forecast, args.anomaly, args.out)
    print(json.dumps({'status': result['status'], 'report': args.out}, indent=2))


if __name__ == '__main__':
    main()
