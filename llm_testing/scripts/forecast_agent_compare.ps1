$ErrorActionPreference = "Stop"
$py = if (Test-Path ".venv\Scripts\python.exe") { ".\.venv\Scripts\python.exe" } else { "python" }
& $py -m forecast_agent.runner --models qwen3:1.7b qwen3:4b llama3.2:3b gemma3:4b --limit 0 --run-id agent_comparison_v1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $py -m benchmark.score --task forecast --predictions outputs/forecast_agent_comparison_v1.jsonl --out outputs/forecast_agent_metrics.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
