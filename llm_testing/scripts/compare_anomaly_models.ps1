param(
    [int]$Limit = 12,
    [string]$RunId = 'pilot_01'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$py = '.\.venv\Scripts\python.exe'
if (!(Test-Path $py)) { $py = 'python' }
if (!(Test-Path 'anomaly_agent/v4_tools.py')) {
    throw 'Missing anomaly_agent/v4_tools.py. Import your existing anomaly_agent_patch first.'
}
if (!(Test-Path 'reference/llm_service/shared_llm/agent.py')) {
    throw 'Missing original shared_llm agent. Run scripts/import_existing.ps1 once.'
}
if (!(Test-Path 'outputs/prepared/anomaly_inputs.jsonl')) {
    throw 'Missing prepared Dataset v4. Run scripts/prepare.ps1 first.'
}
& $py anomaly_model_selection.py --run-id $RunId --limit $Limit --models qwen3:1.7b qwen3:4b llama3.2:3b gemma3:4b
exit $LASTEXITCODE
