# TwinLabs: frozen-Qwen Agentic RAG forecasting experiment

Branch: experiment/agentic-rag-forecast-20261124

## Client constraints implemented

- Frozen local Qwen3 1.7B and 4B. No fine-tuning, updated weights, LSTM, trained forecast model or cloud inference.
- Historical sensor records retrieved as timestamped structured data, with strictly bounded tool calls.
- Similarity matching uses **numeric Dynamic Time Warping (DTW)**, without vector embeddings or an embedding database.
- Forecast cutoff: 2026-01-01; held-out evaluation: January 1–31, 2026.
- Known future evidence: calendars, workdays, holidays and synthetic climatology. Actual future sensor readings, occupancy and weather are withheld.
- Scientific objective: test whether richer historical retrieval **improves or fails to improve** Qwen forecasting, without assuming the outcome.

## Experimental arms

Every arm predicts the same **monthly January mean of four daily metrics**: peak indoor temperature, mean RH, peak CO2 and electricity (kWh/day). Each is scored on the same 60 synthetic scenarios.

| Arm | Name | What is new |
|---|---|---|
| A | Original prompt, already finished | qwen4b_one_month_backtest.py; 90-day summary only |
| B | Structured history | Adds daily readings, numerical trend slopes, headcount and operational associations |
| C | Historical analogue RAG | Adds scaled multivariate numeric DTW retrieval and observed subsequent 31-day outcomes |
| D | Agentic RAG | Qwen selects bounded historical retrieval tools and uses returned evidence before forecasting |

The 60 cases are six counterfactual families with ten synthetic replicates each: **not 60 real buildings**. Each has 90 past days, so only 32 nonoverlapping 14-day plus 31-day analogue windows can be retrieved per case. This limitation makes retrieval more challenging. No independent counterfactual case is treated as the current case's historical building.

## Available agent tools

- get_sensor_history: observed timestamped values and corresponding occupancy, HVAC and rainfall.
- get_operational_context: recent observed staffing/AC/rain plus known future calendar.
- calculate_trends: last-28-day slopes, recent averages and occupancy correlation.
- find_similar_periods: numeric DTW nearest historical 14-day windows, no embeddings.
- get_historical_outcomes: 31-day observed continuations of previously retrieved windows.
- finish: stop retrieval when sufficient evidence was selected.

All retrieval occurs in Python allowlisted functions, not arbitrary model-generated SQL. Tool outputs and tool traces are stored and cited with evidence IDs. The agent is bounded to three tool requests by default, and a minimum retrieval is enforced if it immediately requests finish.

An analogue-only numeric reference method is reported alongside conventional persistence and weekday baselines. It uses the mean pre/post change in historical matches and does not involve an LLM.

## Update the research worktree, not the main TwinLabs website

Your previously completed A predictions are saved in local outputs and are preserved. Run from the separate research worktree:

~~~bash
cd ~/Desktop/TwinLabs-Forecast
git status -sb
git fetch origin
git switch --track -c agentic-rag-forecast origin/experiment/agentic-rag-forecast-20261124
~~~

If your worktree has uncommitted modifications, do not force-checkout or reset; resolve those changes first. The new branch uses the same sparse checkout and does not require downloading the entire dataset.

## Offline preparation and checks

~~~bash
python3 -m unittest discover -s experiments -p 'test_agentic_rag_forecast.py' -v
python3 experiments/agentic_rag_forecast.py preview --mode analogue --limit-cases 1
~~~

Preview prints ONLY pre-cutoff historical and known future planning evidence. It does not call Ollama and does not open hidden January truth.

## Smoke test (3 cases per arm)

Make sure Ollama is already serving; run ollama list. If not, run ollama serve in a separate Terminal window.

~~~bash
python3 experiments/agentic_rag_forecast.py run --mode structured --model qwen3:1.7b --limit-cases 3
python3 experiments/agentic_rag_forecast.py run --mode analogue --model qwen3:1.7b --limit-cases 3
python3 experiments/agentic_rag_forecast.py run --mode agentic --model qwen3:1.7b --limit-cases 3 --max-tools 3
~~~

Every case should show valid status; agentic records should show a positive tool count.

## Full 60-case comparison

~~~bash
python3 experiments/agentic_rag_forecast.py run --mode structured --model qwen3:1.7b --limit-cases 0 --resume
python3 experiments/agentic_rag_forecast.py run --mode analogue --model qwen3:1.7b --limit-cases 0 --resume
python3 experiments/agentic_rag_forecast.py run --mode agentic --model qwen3:1.7b --limit-cases 0 --resume --max-tools 3

python3 experiments/agentic_rag_forecast.py score --mode all --model qwen3:1.7b
~~~

Resume skips only previously valid cases; model errors are retried. The existing A model runs remain intact. Repeat the same commands with qwen3:4b to compare model size, if desired. Default context size is 6,144 tokens; choose --context 4096 if you run into memory pressure.

## Saved results

All new results live in the gitignored research directory:

experiments/outputs/jan2026/agentic_rag/

- predictions_structured_qwen3_1_7b.jsonl (also analogue and agentic; and 4B variants)
- summary_ARM_MODEL.json: accuracy, case validity, latency, tool counts and citation validity
- scores_ARM_MODEL.csv: per-case predictions, actual held-out results and the same baselines
- comparison_MODEL.json: original A plus the completed B/C/D arms

The hidden January data is read only by the explicit score command. Offline CI uses a mock Qwen response to test logic and does not present mock predictions as research findings.

## Scientific limits

- These are synthetic, heuristic building relationships, not physically calibrated real-building observations.
- The 60 cases forecast the same month. Multiple seasons, rolling forecast origins and building generalization have NOT been evaluated.
- B/C/D prompts and tool use do not guarantee better accuracy; improvements must appear in the held-out scores.
- This is a **client-aligned small adaptation**, not a complete reimplementation or performance replication of TimeRAG or FLAIRR-TS.
- The current task is monthly aggregation, not a 31-day forecast trajectory or a causal simulation of staffing changes. Scenario-conditioned predictions need explicit future operating assumptions, not leaked actual occupancy.
- The website's one-month-ahead point reading is a different target; the experiment cannot validate that website endpoint.

## Research references

- TimeRAG — historical numeric DTW retrieval: https://arxiv.org/abs/2412.16643
- FLAIRR-TS — retrieval, forecasting agent and iterative prompting: https://aclanthology.org/2025.findings-emnlp.834/
- NVIDIA Agentic RAG article cited by SAIC: https://developer.nvidia.com/blog/traditional-rag-vs-agentic-rag-why-ai-agents-need-dynamic-knowledge-to-get-smarter/
