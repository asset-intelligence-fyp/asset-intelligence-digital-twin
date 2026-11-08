$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -U pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
& .\.venv\Scripts\python.exe -m pytest -q
