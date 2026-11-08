$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& .\.venv\Scripts\python.exe -m benchmark.run --task anomaly --run-id full_anomaly
& .\.venv\Scripts\python.exe -m benchmark.score --task anomaly --predictions outputs\anomaly_full_anomaly.jsonl
& .\.venv\Scripts\python.exe -m benchmark.run --task forecast --prompt P4_prediction --run-id full_forecast
& .\.venv\Scripts\python.exe -m benchmark.score --task forecast --predictions outputs\forecast_full_forecast.jsonl --keys ..\malaysian_office_v4_evaluation_KEYS.zip
& .\.venv\Scripts\python.exe -m benchmark.report --anomaly outputs\anomaly_metrics.json --forecast outputs\forecast_metrics.json
