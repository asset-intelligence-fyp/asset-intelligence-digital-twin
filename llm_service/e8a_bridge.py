"""Isolated, loopback-only E8-A worker. Existing assistant bridge is unchanged.

Requires: pip install -r llm_service/requirements-e8a.txt
Requires: ollama pull qwen3:1.7b
Never exposes source-history ingestion or model execution to the LAN directly.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEPENDENCIES = ('duckdb', 'numpy', 'pydantic', 'langgraph', 'ollama')


def readiness():
    missing = [name for name in DEPENDENCIES if importlib.util.find_spec(name) is None]
    if not missing:
        try:
            import pydantic
            if int(pydantic.__version__.split('.')[0]) < 2:
                missing.append('pydantic>=2')
        except Exception:
            missing.append('pydantic>=2')
    return {'workflow': 'E8-A', 'model': 'qwen3:1.7b',
            'dependencies_ready': not bool(missing), 'missing': missing,
            'verification': 'dual_channel_grounded_review_with_optional_repair',
            'readings': 'causal_5min_HTTP_simulator', 'available': not bool(missing)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=int(os.environ.get('E8A_BRIDGE_PORT', '8012')))
    args = parser.parse_args()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, value):
            data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == '/health':
                self.respond(200, readiness())
            else:
                self.respond(404, {'error': 'Not found'})

        def do_POST(self):
            if self.path != '/detect':
                return self.respond(404, {'error': 'Not found'})
            health = readiness()
            if not health['available']:
                return self.respond(503, {'error': 'Install E8-A dependencies: ' +
                                                 ', '.join(health['missing'])})
            if not lock.acquire(blocking=False):
                return self.respond(429, {'error': 'An E8-A inference is already running'})
            try:
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    size = 0
                if not 0 < size < 1200000:
                    return self.respond(413, {'error': 'Invalid E8-A payload size'})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    return self.respond(400, {'error': 'Expected a request object'})
                from llm_service.e8a_website import analyse_e8a_website
                self.respond(200, analyse_e8a_website(body, model='qwen3:1.7b', max_rounds=2))
            except (TypeError, ValueError, KeyError) as exc:
                self.respond(400, {'error': str(exc)[:300]})
            except Exception as exc:
                self.respond(503, {'error': 'E8-A inference unavailable: ' +
                                           f'{type(exc).__name__}: {str(exc)[:200]}'})
            finally:
                lock.release()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'TwinLabs E8-A agentic detection bridge: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
