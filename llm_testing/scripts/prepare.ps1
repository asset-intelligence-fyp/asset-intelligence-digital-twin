$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& .\.venv\Scripts\python.exe -m benchmark.prepare --inputs ..\malaysian_office_v4_llm_inputs_ONLY.zip --keys ..\malaysian_office_v4_evaluation_KEYS.zip
