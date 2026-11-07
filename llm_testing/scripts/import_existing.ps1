param(
    [Parameter(Mandatory=$true)][string]$Source,
    [string]$AnomalyPatch = ""
)
$ErrorActionPreference = 'Stop'
$testing = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourcePath = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $sourcePath 'benchmark/prepare.py'))) {
    throw "Source is not the digital_twin_llm_shared_agent_v4 project root: $sourcePath"
}
foreach ($dir in @('benchmark','forecast_agent','reference','prompts','tests','scripts')) {
    $from = Join-Path $sourcePath $dir
    if (Test-Path $from) {
        $to = Join-Path $testing $dir
        if (!(Test-Path $to)) { New-Item -ItemType Directory -Path $to | Out-Null }
        Get-ChildItem -LiteralPath $from -Force | Where-Object {
            $_.Name -notin @('__pycache__','.venv','outputs')
        } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $to -Recurse -Force
        }
        Write-Host "Imported $dir"
    }
}
foreach ($file in @('requirements.txt','README_SHARED_AGENT.md')) {
    $from = Join-Path $sourcePath $file
    if (Test-Path $from) {
        Copy-Item -LiteralPath $from -Destination (Join-Path $testing $file) -Force
    }
}
if ($AnomalyPatch -ne '') {
    $patch = (Resolve-Path $AnomalyPatch).Path
    if (!(Test-Path (Join-Path $patch 'anomaly_agent/run.py'))) {
        throw "AnomalyPatch must contain anomaly_agent/run.py: $patch"
    }
    $dest = Join-Path $testing 'anomaly_agent'
    if (!(Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }
    Copy-Item -Path (Join-Path $patch 'anomaly_agent/*') -Destination $dest -Recurse -Force
    Write-Host 'Imported anomaly_agent'
}
Write-Host 'Imported source code into:' $testing
Write-Host 'No Dataset ZIPs, evaluation keys, or output files were copied.'
Write-Host 'Review changes with: git status --short'
