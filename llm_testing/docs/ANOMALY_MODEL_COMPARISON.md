# Four-Model Anomaly Detection Comparison

Run the existing original `shared_llm.agent.run_agent()` tool-calling workflow against frozen Dataset v4 input packets. This is **not** the separate fixed-prompt `benchmark.run` test.

## One-time code import

Run the existing `scripts/import_existing.ps1` with:
- `-Source` pointing to the extracted `digital_twin_llm_shared_agent_v4`.
- `-AnomalyPatch` pointing to the extracted `anomaly_agent_patch` containing `anomaly_agent/v4_tools.py`.

This keeps the source code in your GitHub testing branch; private Dataset v4 ZIPs stay local and excluded from Git.

## Prepare and run

From `llm_testing` on Windows PowerShell:

```powershell
ollama pull qwen3:1.7b
ollama pull qwen3:4b
ollama pull llama3.2:3b
ollama pull gemma3:4b

powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/prepare.ps1
powershell -ExecutionPolicy Bypass -File scripts/compare_anomaly_models.ps1 -Limit 12 -RunId pilot_01
```

Check `outputs/model_selection/pilot_01/anomaly_model_comparison.csv`.

Only after verifying the pilot, run the full selected 600 sensor-level cases per model:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/compare_anomaly_models.ps1 -Limit 0 -RunId full_01
```

**Important limitations**:
- Pilot selection uses case ID prefixes (A/N) but never passes them to tools; test model prompts must not mention the prefix. Treat as a nonrepresentative balanced pilot, not blind deployment accuracy.
- The 600 cases correspond to 200 fault events and matched normal sensor-level controls; these are not independent events. Confidence intervals and fault-group split studies are still required.
- `as_of` is enforced by the prepared packet generation; current tool calls access packet data, **not** a live seven-year PostgreSQL query.
- Separate final blind evaluation must use a frozen development/validation/test protocol. This model comparison does not claim a final publishable result.
- Tool-call success must be checked in traces, not inferred from JSON validity.
- Each run keeps full model responses, tool traces, evidence digests, per-case inference errors and latency. Invalid predictions remain invalid rather than being silently replaced with Normal.
- Ground truth is read **after all model inference has been written**. Its ZIP and extracted files must not be checked in.
- Ollama /model quantisation and digest should be documented independently (run `ollama list` / `ollama show`). This runner currently uses identical temperature, prompt and packet evidence but does not enforce equal token budget across model architectures.
