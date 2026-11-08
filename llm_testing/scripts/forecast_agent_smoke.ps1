$ErrorActionPreference = "Stop"
$py = if (Test-Path ".venv\Scripts\python.exe") { ".\.venv\Scripts\python.exe" } else { "python" }
& $py -m forecast_agent.runner --models qwen3:1.7b --limit 3 --run-id agent_smoke_v1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
