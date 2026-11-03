"""Loopback-only Qwen3 bridge for the actual whole-building 18-point website.

This bridge does not use the legacy Level 5 nine-point service, and it does not
pretend that the R4.3.1 research code/thresholds were deployed unchanged.
Evidence is collected deterministically from the requested 18-point room
snapshot and (optionally) the separate normal-history SQLite database.
"""
import argparse
import json
import os
import threading
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Import from the repository root, regardless of whether started via npm run dev
# or directly with `python llm_service/bridge.py`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from llm_service.shared_llm.ollama import OllamaClient
from llm_service.validated_room import analyse_validated


def analyse(request, config):
    def factory(model):
        return OllamaClient(base_url=os.environ.get('OLLAMA_URL','http://127.0.0.1:11434'),
                            model=model, temperature=0, timeout=150)
    return analyse_validated(request, config, factory)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8011)
    args = parser.parse_args()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, value):
            payload = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == '/health':
                self.reply(200, {'ok': True, 'model': 'qwen3:1.7b', 'prompt': 'concise',
                                 'validation_mode': 'hybrid_semantic',
                                 'retrieval': 'backend_verified_room_evidence'})
            else:
                self.reply(404, {'error': 'Not found'})

        def do_POST(self):
            if self.path != '/ask':
                self.reply(404, {'error': 'Not found'})
                return
            if not lock.acquire(blocking=False):
                self.reply(429, {'error': 'One room analysis is already running'})
                return
            try:
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    size = 0
                if not 0 < size <= 6000000:
                    self.reply(413, {'error': 'Invalid request size'})
                    return
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict) or not isinstance(data.get('request'), dict):
                    raise ValueError('Malformed request')
                self.reply(200, analyse(data['request'], data.get('config') or {}))
            except (ValueError, TypeError, KeyError) as exc:
                self.reply(400, {'error': str(exc)})
            except Exception as exc:
                # Client error is reported; no raw SQL or private label content.
                self.reply(503, {'error': 'Local LLM inference unavailable: ' + str(exc)[:260]})
            finally:
                lock.release()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Whole-building Qwen3 P2/R4.3.1-style bridge: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()