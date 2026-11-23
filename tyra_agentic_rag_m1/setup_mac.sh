#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '== Local Agentic RAG setup for macOS =='
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3 required. Install Python 3.11/3.12 first from python.org.' >&2
  exit 1
fi
python3 - <<'PY'
import sys
if not (3,11) <= sys.version_info[:2] <= (3,13):
    raise SystemExit('Use Python 3.11, 3.12, or 3.13 for this project.')
print('Python:',sys.version.split()[0])
PY
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if [[ ! -f .env ]]; then cp .env.example .env; fi
python -m pytest -q
python -m src.cli demo
python -m src.cli ingest --csv data/raw/demo_readings.csv --format long --zone-col zone_id
python -m src.cli inspect
echo 'Setup complete. Install/launch Ollama, then: ollama pull qwen3:1.7b'
