$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$python = '.\.venv\Scripts\python.exe'
if (!(Test-Path $python)) { $python = 'python' }
if (!(Test-Path 'anomaly_agent/run.py')) {
    throw 'Missing anomaly_agent/run.py. Import existing code with scripts/import_existing.ps1 and -AnomalyPatch.'
}
if (!(Test-Path 'reference/llm_service/shared_llm/agent.py')) {
    throw 'Missing original shared_llm Agent. Run scripts/import_existing.ps1 with the v4 source first.'
}
if (!(Test-Path 'outputs/prepared/anomaly_inputs.jsonl')) {
    throw 'Missing prepared cases. Run scripts/prepare.ps1 first.'
}
& $python -m anomaly_agent.run --model qwen3:1.7b --limit 6 --out outputs/anomaly_agent_pilot.jsonl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (!(Test-Path 'outputs/prepared/anomaly_truth_PRIVATE.jsonl')) {
    throw 'Missing local evaluation keys. Never commit these.'
}
& $python -m anomaly_agent.score --predictions outputs/anomaly_agent_pilot.jsonl --truth outputs/prepared/anomaly_truth_PRIVATE.jsonl --out outputs/anomaly_agent_pilot_metrics.json
exit $LASTEXITCODE
