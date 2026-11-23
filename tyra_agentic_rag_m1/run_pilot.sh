#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate
curl -sf http://127.0.0.1:11434/api/tags >/dev/null || {
  echo 'Ollama is not reachable. Open Ollama and pull the model first.' >&2; exit 1;
}
for method in baseline traditional agentic; do
  python -m src.cli batch --task detect --method "$method" --sensor TEMP_01 \
    --start 2025-01-10T09:55:00Z --stride 1 --limit 3 \
    --out "results/demo_${method}.jsonl"
  python -m src.cli evaluate --task detect \
    --results "results/demo_${method}.jsonl" \
    --events data/ground_truth/demo_events.csv
done
python -m src.cli batch --task forecast --method agentic --sensor TEMP_01 \
  --start 2025-01-10T08:00:00Z --stride 12 --limit 2 --horizon 12 \
  --out results/demo_forecast_agentic.jsonl
python -m src.cli evaluate --task forecast \
  --results results/demo_forecast_agentic.jsonl
