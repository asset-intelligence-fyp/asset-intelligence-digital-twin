#!/usr/bin/env python3
"""Inspect raw Ollama tool_calls without executing tools or reading private fault labels.

Run from repo root:
    python3 scripts/diagnose_agentic_tools.py
No sensor history, SQLite data or evaluation cases are accessed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from llm_service.agentic_room import TOOL_SPECS
from llm_service.shared_llm.ollama import OllamaClient


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default='qwen3:1.7b')
    parser.add_argument('--ollama-url', default='http://127.0.0.1:11434')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    registry = json.loads((ROOT / 'shared/sensorRegistry.json').read_text(encoding='utf8'))
    sensor_id = registry[0]['code']

    # Exactly the tool schema and names used by the live Agentic RAG code.
    tools = [x for x in TOOL_SPECS if x['function']['name'] == 'get_recent_trend']
    messages = [
        {'role': 'system', 'content':
         'You are testing native Ollama function calling. '
         'Do not answer in text; request the provided get_recent_trend function.'},
        {'role': 'user', 'content':
         f'Call get_recent_trend for sensor_id={sensor_id}, hours=1. '
         'The application must obtain the data first. Return the native tool call.'},
    ]
    model = OllamaClient(base_url=args.ollama_url, model=args.model,
                         timeout=args.timeout, temperature=0)
    started = perf_counter()
    response = model.chat(messages, tools=tools)
    message = response.get('message') or {}
    calls = message.get('tool_calls') or []
    print(json.dumps({
        'model': response.get('model', args.model),
        'elapsed_seconds': round(perf_counter() - started, 2),
        'done_reason': response.get('done_reason'),
        'structured_tool_calls': len(calls),
        'tool_calls': [
            {'name': (call.get('function') or {}).get('name'),
             'arguments': (call.get('function') or {}).get('arguments')}
            for call in calls
        ],
        'content_preview': str(message.get('content') or '')[:500],
        'thinking_present': bool(message.get('thinking')),
        'diagnosis': (
            'Native tool calls are available: retry the agentic smoke test.'
            if calls else
            'No native tool calls. Check Ollama version/model template and retry. '
            'Do not treat plain-text JSON as a successful native tool call.'
        ),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
