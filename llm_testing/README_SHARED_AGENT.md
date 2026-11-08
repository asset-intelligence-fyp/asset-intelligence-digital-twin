# Digital Twin v4 — keep original anomaly agent, add 90-day forecasting agent

## What this version does

- **Anomaly:** The actual previous website `shared_llm` Python code is preserved **unchanged** under `website_original/llm_service/shared_llm/`. It calls Ollama tools and uses the previous SQLite schema. It has **not** yet been adapted to the v4 ZIP's new schema. For original anomaly runs, use the original `shared_llm/cli.py` and its own original database/ingestion format. Do **not** claim the new `benchmark/run.py` reproduces this anomaly agent.
- **Forecast:** `forecast_agent/runner.py` implements the same bounded agent/tool-loop approach as the original `shared_llm/agent.py` but with five **read-only, as-of-limited 90-day forecasting tools** operating on prepared Dataset v4 evidence. It independently predicts sensor mean, 90-day condition/trend and 13 weekly qualitative outlooks.
- **Evaluation:** existing `benchmark.score` reads the withheld key ZIP **only after** predictions were written. It computes per-sensor numeric MAE/RMSE/WAPE, historical and scenario macro F1. Weekly outlooks cannot be numerically scored because 13 observed weekly ground truths are not provided.

## Where the ZIPs go

```
Downloads/
  malaysian_office_v4_llm_inputs_ONLY.zip
  malaysian_office_v4_evaluation_KEYS.zip
  digital_twin_llm_shared_agent_v4/
    benchmark/
    forecast_agent/
    website_original/
    scripts/
```

**Do not give evaluation_KEYS.zip to the Ollama service.** Preparing anomaly test *case selection* uses keys, but inference packets must not include labels. The forecast inference agent never opens the key ZIP.

## Windows PowerShell: first run

From inside `digital_twin_llm_shared_agent_v4`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/prepare.ps1
ollama pull qwen3:1.7b
powershell -ExecutionPolicy Bypass -File scripts/forecast_agent_smoke.ps1
```

The existing `prepare.ps1` generates 600 anomaly cases and 478 forecast cases. Its anomaly packets are for the fixed-evidence research baseline, **not** for the original website anomaly agent. If you have an existing `outputs/prepared/` folder, copy it into this package to skip prepare; ZIP paths still required for evaluation.

Scenario-focused smoke test: `powershell -ExecutionPolicy Bypass -File scripts/forecast_agent_scenario_smoke.ps1`.

Inspect `outputs/forecast_agent_smoke_v1.jsonl` for `tool_trace`, `tool_call_count`, `raw`, `parsed`, `valid`, `error` and elapsed time. Smoke tests do not establish performance.

Compare all four on identical cases (requires installed Ollama models, may take substantial compute):

```powershell
ollama pull qwen3:4b
ollama pull llama3.2:3b
ollama pull gemma3:4b
powershell -ExecutionPolicy Bypass -File scripts/forecast_agent_compare.ps1
```

For a manageable pilot, manually run:

```powershell
.\.venv\Scripts\python.exe -m forecast_agent.runner --models qwen3:1.7b --limit 15 --run-id pilot_15
.\.venv\Scripts\python.exe -m benchmark.score --task forecast --predictions outputs/forecast_pilot_15.jsonl --out outputs/pilot_15_metrics.json
```

**Caution:** Old website anomaly code uses its own ingestion/schema and cannot automatically consume Dataset v4. A proper adapter needs to be separately implemented/tested to preserve its original semantics. Forecast metrics are preliminary if run on only a few historical cases. `think: false` is the default for Qwen3 so final outputs are schema-constrained; `--think` enables a Qwen3 thinking ablation (different runtime/config; do not mix results).

## How prediction differs from anomaly

Forecast task is **not** asking if an individual 5-minute value is anomalous. It retrieves up to 180 past daily summaries and 52 prior weekly summaries, relevant known future schedules and climatology, to predict the next 90 days. Scenarios have separate multi-sensor daily history and known future inputs. No hidden future outcomes may be retrieved. Baseline numeric comparisons still need to be added for final scientific reporting.

## Verification scope

Offline syntax/unit tests can be run here. Ollama endpoint and four locally installed models are necessary for live benchmark results; the ZIP does not invent scores.
