# Digital Twin LLM Testing — isolated research branch

This folder is dedicated to **LLM anomaly detection and 90-day forecast model selection**. It is not wired to the production website and must never change production data.

## Branch safety
- Work only on `experiment/digital-twin-llm-testing`.
- Do not merge this branch into `main` without a separate review.
- Keep Dataset v4 input ZIPs, evaluation keys, experiment outputs, SQLite/PostgreSQL credentials and model downloads **local**. The `.gitignore` explicitly excludes these.
- This repository initially contained only a README on `main`. The existing `shared_llm` source and testing modules were provided as local ZIPs, **not** as GitHub files. They must be imported once using `scripts/import_existing.ps1` before inference is possible.

## One-time setup (Windows PowerShell)

From a directory where you want the checkout:

```powershell
git clone --branch experiment/digital-twin-llm-testing https://github.com/asset-intelligence-fyp/asset-intelligence-digital-twin.git
cd asset-intelligence-digital-twin
powershell -ExecutionPolicy Bypass -File llm_testing/scripts/import_existing.ps1 -Source "C:\Users\User\Downloads\digital_twin_llm_shared_agent_v4\digital_twin_llm_shared_agent_v4" -AnomalyPatch "C:\Users\User\Downloads\anomaly_agent_patch"
git status --short
git add llm_testing
git commit -m "test: import shared-agent v4 and anomaly adapter"
git push origin experiment/digital-twin-llm-testing
```

If the `-AnomalyPatch` directory is unavailable, omit it, but anomaly tool-calling tests will be unavailable until `anomaly_agent/` is imported. The import command copies **code only**; it does not copy datasets or private ground truth.

The imported layout under `llm_testing/` should include `benchmark/`, `forecast_agent/`, `reference/`, `anomaly_agent/`, `prompts/`, `scripts/`, and `tests/`.

## Local data (never commit)

Place these at the **repo root** (one level above `llm_testing`) because the existing `benchmark` defaults expect `../` when invoked from `llm_testing`:

```text
asset-intelligence-digital-twin/
  malaysian_office_v4_llm_inputs_ONLY.zip
  malaysian_office_v4_evaluation_KEYS.zip
  llm_testing/
    benchmark/
    anomaly_agent/
    forecast_agent/
    scripts/
    outputs/     # ignored by Git
```

Keep the complete `malaysian_digital_twin_llm_dataset_v4.zip` offline and outside LLM inference access. The evaluation ZIP is for the local scoring process only. It must never be passed into prompts, tool responses or LLM-accessible storage.

## Run locally

Open PowerShell in the `llm_testing` directory:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/prepare.ps1
powershell -ExecutionPolicy Bypass -File scripts/run_anomaly_agent.ps1
powershell -ExecutionPolicy Bypass -File scripts/run_forecast_agent.ps1
```

These wrappers call imported modules; they **do not** claim the complete model comparison has been run. Ollama must be running and the appropriate `qwen3:1.7b` model must be installed.

## Research requirements

- Anomaly: original `shared_llm.agent` loop + v4 **read-only, as-of-limited** tools, current 5-minute samples, historical normal comparison; keep anomaly and normal controls and fault-event-aware holdouts.
- Forecast: 90-day/13-week predictions from daily and weekly historical data with no post-origin observations.
- Compare Qwen3 1.7B, Qwen3 4B, Llama 3.2 3B, Gemma 3 4B on identical cases and evidence.
- Report actual Accuracy >85% criterion, Precision, Recall, F1, Coverage, latency, schema validity, tool errors, and forecast MAE/RMSE by compatible unit.
- Do not treat valid JSON or smoke-test scores as model-selection performance.
- No hidden ground truth in inference prompts or retrieval; keep the scoring process isolated.

## Future changes

Ask to update files **on this branch**, and changes can be committed through the GitHub integration without distributing another ZIP. You can then use `git pull origin experiment/digital-twin-llm-testing` in the local checkout. Run Ollama locally; GitHub hosting alone does not run your locally installed models.
