"""Offline, no-Ollama tests for the bounded whole-building Agentic RAG adapter."""
from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from llm_service.agentic_room import RoomAgentTools, analyse_agentic
from llm_service.validated_room import build_evidence

MYT = timezone(timedelta(hours=8))
CUTOFF = datetime(2026, 2, 2, 12, 0, tzinfo=MYT)
SENSOR_ID = 'L02-OFFICE-TEMP-01'


def make_request():
    def reading(minutes_before, value):
        return {'point_code': SENSOR_ID, 'value': value,
                'timestamp': (CUTOFF - timedelta(minutes=minutes_before)).isoformat(),
                'quality': 'synthetic'}
    return {
        'room_id': 'L02-OFFICE',
        'room_name': 'Level 2 office',
        'source': 'historical_replay',
        'as_of': CUTOFF.isoformat(),
        'question': 'Is the temperature unusually high?',
        'points': [{'code': SENSOR_ID, 'simulatorRoomId': 'L02-OFFICE',
                    'sensorType': 'temperature', 'unit': 'C'}],
        'history': [reading(45, 23.0), reading(30, 24.0), reading(5, 23.5),
                    reading(-15, 100.0)],  # Future reading must never be returned.
    }


class FakeOllama:
    model = 'qwen3:1.7b'

    def __init__(self, call_tools=True):
        self.call_tools = call_tools
        self.requested = []

    def chat(self, messages, tools=None, format=None):
        if tools is not None:
            count = sum(m['role'] == 'tool' for m in messages)
            if count == 0 and self.call_tools:
                self.requested = [t['function']['name'] for t in tools]
                return {'message': {
                    'content': '',
                    'tool_calls': [{
                        'function': {'name': 'get_recent_trend',
                                     'arguments': {'sensor_id': SENSOR_ID, 'hours': 1}}
                    }]
                }}
            return {'message': {'content': '', 'tool_calls': []}}
        assert format is not None, 'Final answer must be schema constrained'
        return {'message': {'content': json.dumps({
            'finding': 'No unusual temperature pattern was identified.',
            'needs_investigation': False,
            'affected_rooms': ['L02-OFFICE'],
            'evidence': ['Recent readings reviewed.'],
            'possible_explanations': [],
            'recommended_checks': ['Continue monitoring.'],
            'limitations': ['Synthetic data.'],
        })}}


class AgenticRoomTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.db = Path(self.temporary.name) / 'normal.sqlite'
        with sqlite3.connect(self.db) as conn:
            conn.execute(
                'CREATE TABLE sensor_readings '
                '(dataset TEXT, sensor_id TEXT, timestamp TEXT, value REAL, '
                'weekday INTEGER, minute_of_day INTEGER, quality_flag TEXT)'
            )
            for weeks in range(1, 9):
                dt = CUTOFF - timedelta(weeks=weeks)
                conn.execute(
                    'INSERT INTO sensor_readings VALUES (?, ?, ?, ?, ?, ?, ?)',
                    ('normal', SENSOR_ID, dt.isoformat(), 23.5,
                     dt.weekday(), dt.hour * 60 + dt.minute, 'ok'),
                )
            future = CUTOFF + timedelta(weeks=1)
            conn.execute(
                'INSERT INTO sensor_readings VALUES (?, ?, ?, ?, ?, ?, ?)',
                ('normal', SENSOR_ID, future.isoformat(), 999.0,
                 future.weekday(), future.hour * 60 + future.minute, 'ok'),
            )

    def tearDown(self):
        self.temporary.cleanup()

    def tools(self):
        request = make_request()
        evidence = build_evidence(request, str(self.db))
        return RoomAgentTools(request, evidence, str(self.db))

    def test_recent_trend_excludes_future_readings(self):
        result = self.tools().execute('get_recent_trend',
                                      {'sensor_id': SENSOR_ID, 'hours': 1})
        self.assertEqual(result['count'], 3)
        self.assertEqual(result['maximum'], 24.0)
        self.assertTrue(all(row['value'] != 100.0 for row in result['last_12']))

    def test_tools_reject_unauthorised_sensor_and_arguments(self):
        tools = self.tools()
        with self.assertRaises(ValueError):
            tools.execute('get_recent_trend',
                          {'sensor_id': 'UNAUTHORISED', 'hours': 1})
        with self.assertRaises(ValueError):
            tools.execute('get_recent_trend',
                          {'sensor_id': SENSOR_ID, 'hours': 999})
        with self.assertRaises(ValueError):
            tools.execute('get_room_context', {'room_id': 'OTHER'})
        self.assertEqual(tools.used, [])

    def test_seven_year_normal_baseline_is_read_only_and_pre_cutoff(self):
        baseline = self.tools().execute('get_historical_baseline',
            {'sensor_id': SENSOR_ID, 'years': 7})
        self.assertEqual(baseline['status'], 'ok')
        self.assertEqual(baseline['comparable_days'], 8)
        self.assertEqual(baseline['median'], 23.5)
        self.assertTrue(baseline['latest_day'] < CUTOFF.date().isoformat())

    def test_actual_model_selected_tool_is_required(self):
        model = FakeOllama(call_tools=False)
        with self.assertRaisesRegex(RuntimeError, 'at least one successful'):
            analyse_agentic(make_request(), {'model': 'qwen3:1.7b',
                                              'history_db': str(self.db)},
                            lambda _: model)

    def test_agent_retries_when_model_initially_ignores_tool_request(self):
        class InitiallyNoTool(FakeOllama):
            attempts = 0

            def chat(self, messages, tools=None, format=None):
                if tools is not None:
                    self.attempts += 1
                    if self.attempts == 1:
                        return {'message': {
                            'content': 'I would normally answer directly.',
                            'tool_calls': [],
                        }}
                return super().chat(messages, tools=tools, format=format)

        model = InitiallyNoTool()
        result = analyse_agentic(make_request(),
                                 {'model': 'qwen3:1.7b', 'history_db': str(self.db)},
                                 lambda _: model)
        self.assertGreaterEqual(model.attempts, 2)
        self.assertEqual(result['agentic']['tool_call_count'], 1)

    def test_agentic_output_keeps_existing_validator(self):
        model = FakeOllama()
        result = analyse_agentic(make_request(),
                                 {'model': 'qwen3:1.7b', 'history_db': str(self.db)},
                                 lambda _: model)
        self.assertEqual(result['retrieval_variant'], 'agentic_sql_tools')
        self.assertEqual(result['agentic']['tool_call_count'], 1)
        self.assertEqual(result['tool_trace'][0]['tool'], 'get_recent_trend')
        self.assertIn(result['status'], ('no_alert', 'review_required'))
        self.assertEqual(result['verified_evidence']['focus_sensor_id'], SENSOR_ID)
        self.assertIn('get_historical_baseline', model.requested)


if __name__ == '__main__':
    unittest.main()
