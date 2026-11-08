$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& .\.venv\Scripts\python.exe -m benchmark.run --task anomaly --models qwen3:1.7b --limit 3 --run-id smoke
& .\.venv\Scripts\python.exe -m benchmark.score --task anomaly --predictions outputs\anomaly_smoke.jsonl --allow-partial
