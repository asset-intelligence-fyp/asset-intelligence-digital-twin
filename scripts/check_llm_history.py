"""Read-only audit of normal synthetic history for current TwinLabs sensor codes."""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from llm_service.validated_room import (MYT, RULE_MIN, normal_history_ready,
                                       reference_daily_samples, resolve_history_path,
                                       parse_myt)


def main():
    parser = argparse.ArgumentParser(description='Check actual normal-history coverage; never create or alter sensor data.')
    parser.add_argument('--as-of', help='ISO timestamp with offset; default: current Malaysian time')
    parser.add_argument('--history-db', default=os.environ.get('LLM_HISTORY_DB', ''), help='Read-only normal-history SQLite path')
    args = parser.parse_args()
    at_time = parse_myt(args.as_of) if args.as_of else datetime.now(MYT)
    path = resolve_history_path(args.history_db)
    ready = normal_history_ready(path)
    registry_path = Path(__file__).resolve().parents[1] / 'shared' / 'sensorRegistry.json'
    registry = json.loads(registry_path.read_text())
    rows = []
    for point in registry:
        if point['sensorType'] not in RULE_MIN:
            continue
        if ready:
            values, origin = reference_daily_samples(path, point['code'], at_time)
        else:
            values, origin = [], 'unavailable'
        rows.append({'sensor_id': point['code'], 'location': point['locationLabel'],
                     'comparison_days': len(values), 'minimum_required': 5,
                     'sufficient': len(values) >= 5, 'source': origin})
    summary = {'as_of': at_time.isoformat(), 'normal_history_database_ready': ready,
               'continuous_sensors_checked': len(rows),
               'sensors_with_sufficient_history': sum(p['sufficient'] for p in rows),
               'sensors': rows,
               'note': 'Only historical normal synthetic data before this time are read. Five comparable dates are required; no data are generated.'}
    print(json.dumps(summary, indent=2))
    if not ready:
        print('\nNo usable local normal-history database found. Set LLM_HISTORY_DB to the existing SQLite file, or put it in storage/digital_twin.sqlite. Do not upload it to GitHub.', file=sys.stderr)
        return 2
    return 0 if all(p['sufficient'] for p in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())