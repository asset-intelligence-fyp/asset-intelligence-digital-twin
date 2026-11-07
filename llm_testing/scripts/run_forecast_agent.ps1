$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (!(Test-Path 'forecast_agent/runner.py')) {
    throw 'Missing forecast_agent/runner.py. Import existing code with scripts/import_existing.ps1.'
}
if (!(Test-Path 'outputs/prepared/forecast_inputs.jsonl')) {
    Write-Host 'Checking whether prepared forecast case data exists...'
    Get-ChildItem 'outputs/prepared' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    throw 'Missing prepared forecast cases. Run scripts/prepare.ps1 and inspect prepared paths.'
}
$python = '.\.venv\Scripts\python.exe'
if (!(Test-Path $python)) { $python = 'python' }
& $python -m forecast_agent.runner --models qwen3:1.7b --limit 3 --run-id github_branch_smoke
exit $LASTEXITCODE
