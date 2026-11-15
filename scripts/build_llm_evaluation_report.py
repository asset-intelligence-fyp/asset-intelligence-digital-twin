#!/usr/bin/env python3
"""Combine *measured* one-month forecast and anomaly reports without merging metrics."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


def generate(forecast_path, anomaly_path, output):
    forecast_file, anomaly_file = Path(forecast_path), Path(anomaly_path)
    has_forecast, has_anomaly = forecast_file.is_file(), anomaly_file.is_file()
    if not has_forecast and not has_anomaly:
        raise ValueError(
            'No evaluation summaries found. Run the anomaly score command '
            '(python3 scripts/evaluate_llm_anomalies.py score) and/or the '
            'one-month forecast evaluation first.'
        )
    forecast = json.loads(forecast_file.read_text(encoding='utf8')) if has_forecast else None
    anomaly = json.loads(anomaly_file.read_text(encoding='utf8')) if has_anomaly else None
    if forecast is not None and (forecast.get('horizon_months') != 1 or
                                 not isinstance(forecast.get('summary'), list)):
        raise ValueError('Expected a valid one-month forecasting summary: ' + str(forecast_file))
    if anomaly is not None and (anomaly.get('method') != 'blind_synthetic_fault_cases' or
                                not isinstance(anomaly.get('methods'), dict)):
        raise ValueError('Expected a valid blind anomaly evaluation summary: ' + str(anomaly_file))
    complete = (forecast is not None and anomaly is not None and
                not forecast.get('partial_run', True) and anomaly.get('status') == 'evaluated')
    report = {
        'status': 'complete' if complete else 'partial',
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'forecasting': ({
            'status': 'not_evaluated', 'horizon_months': 1, 'per_sensor': [],
            'message': 'No one-month forecasting summary at ' + str(forecast_file) +
                       '. Run scripts/evaluate_llm_one_month.py when ready.'
        } if forecast is None else {
            'status': 'partial' if forecast.get('partial_run', True) else 'evaluated',
            'horizon_months': 1, 'model': forecast.get('model'),
            'planned_cases': forecast.get('expected_planned_cases'),
            'evaluated_cases': forecast.get('overall', {}).get('valid_predictions'),
            'per_sensor': [{key: row.get(key) for key in
                ('sensor_id','unit','planned_cases','valid_predictions','MAE','RMSE',
                 'WAPE_pct','bias','persistence_MAE','skill_vs_persistence_pct',
                 'skill_vs_seasonal_naive_pct')} for row in forecast['summary']],
            'note': 'Raw errors across °C, %RH and ppm are not averaged.'}),
        'anomaly_detection': ({
            'status': 'not_evaluated',
            'message': 'No anomaly detection summary at ' + str(anomaly_file) +
                       '. Run scripts/evaluate_llm_anomalies.py score when ready.'
        } if anomaly is None else {
            'status': anomaly.get('status'),
            'total_cases': anomaly.get('total_cases'),
            'evaluated_cases': anomaly.get('evaluated_cases'),
            'methods': anomaly['methods'],
            'events': anomaly.get('event_results'),
            'reliability': anomaly.get('reliability')}),
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
    try:
        result = generate(args.forecast, args.anomaly, args.out)
    except (FileNotFoundError, ValueError) as exc:
        ap.error(str(exc))
    print(json.dumps({'status': result['status'], 'report': args.out,
                      'forecasting_status': result['forecasting']['status'],
                      'anomaly_status': result['anomaly_detection']['status']}, indent=2))


if __name__ == '__main__':
    main()
