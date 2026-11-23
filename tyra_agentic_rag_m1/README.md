# Local Agentic RAG for Building Time Series (MacBook Air M1 / 8 GB)

A runnable, **open-source software + open-weight LLM** research prototype.

The same local language model performs anomaly detection and numerical forecasting under three retrieval conditions:

- **baseline**: one hour of current observations, no further retrieval
- **traditional**: fixed summaries, seasonal references and numerical analogues
- **agentic**: a LangGraph loop where the local LLM chooses what evidence to retrieve
- **agentic_verify**: agentic retrieval plus a second LLM evidence-verification call

All sensor readings are stored locally. Inference and retrieval modules never read anomaly labels. Future observations are blocked by an application-enforced `as_of` cutoff. Every prediction is logged separately from ground truth.

## 0. Hardware and scope

This was designed for an Apple M1 with **8 GB unified memory**. Use a small quantized model, `num_ctx=4096`, and run experiments sequentially. The LLM's forecast and detection accuracy is **not guaranteed**: the point is to measure it.

**Recommended models:**

- Start: `qwen3:1.7b` (~1.4 GB model download).
- Upgrade for research if usable: `qwen3:4b-instruct` (~2.5 GB download).
- Do not use 9B on the 8 GB M1 for this project.

Qwen weights are Apache 2.0-licensed. The model is open-weight, not necessarily a fully reproducible open-training model. Confirm whether this meets your institution's definition of "open-source model".

## 1. Install Ollama

Download the **macOS** release from https://ollama.com/download and launch the app.

In Terminal:

```bash
ollama pull qwen3:1.7b
ollama list
```

Verify the service responds:

```bash
curl http://127.0.0.1:11434/api/tags
```

To run the larger model later:

```bash
ollama pull qwen3:4b-instruct
```

Avoid pulling `qwen3` without a size: the default may be too large.

## Quick start (after installing Python and Ollama)

```bash
cd ~/Downloads/tyra_agentic_rag_m1
bash setup_mac.sh
ollama pull qwen3:1.7b
bash run_pilot.sh
```

The setup script builds the venv, installs requirements, runs offline tests, generates a demo, and imports the demo database. The pilot script runs all three retrieval conditions and evaluates outputs. Run the steps below manually if anything needs to be customized.

## 2. Install Python and dependencies

Install Python 3.11 or 3.12 from python.org or Homebrew. In Terminal:

```bash
cd ~/Downloads/tyra_agentic_rag_m1  # change to wherever you unzipped the project
python3 --version
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

No cloud API keys are required. Leave the downloaded Ollama app running.

## 3. Run data-only tests **before** downloading any large dataset

```bash
python -m pytest -q
```

These test DuckDB import, causal cutoff, forecast historical continuations, and LangGraph tool selection using a fake LLM. They do **not** contact Ollama.

## 4. Generate and ingest the small demo

```bash
python -m src.cli demo
python -m src.cli ingest --csv data/raw/demo_readings.csv --format long --zone-col zone_id
python -m src.cli inspect
```

The demo generator creates 21 days of three 5-minute sensors, with three injected anomaly events in `data/ground_truth/demo_events.csv`. That is for pipeline tests, not your experimental dataset.

**Important timestamp policy:** normalize your input CSV timestamps to UTC before importing (e.g., `2025-01-10T10:00:00Z`). The DuckDB table stores UTC timestamps without a timezone suffix, and the Python API treats them as UTC. Do not mix timezone-naive local timestamps with UTC values. Daylight-saving offsets must be resolved before ingestion.

## 5. Run your first local inference

An injected temperature event begins on **2025-01-10 at 10:00 UTC** in the demo.

```bash
python -m src.cli batch --task detect --method baseline --sensor TEMP_01 \
  --start 2025-01-10T09:55:00Z --stride 1 --limit 4 \
  --out results/demo_baseline.jsonl

python -m src.cli batch --task detect --method traditional --sensor TEMP_01 \
  --start 2025-01-10T09:55:00Z --stride 1 --limit 4 \
  --out results/demo_traditional.jsonl

python -m src.cli batch --task detect --method agentic --sensor TEMP_01 \
  --start 2025-01-10T09:55:00Z --stride 1 --limit 4 \
  --out results/demo_agentic.jsonl
```

See `results/*.jsonl` for classifications, evidence, agent tool traces, latency and tokens. If Ollama is down or produces an invalid JSON response, the failure is recorded as an unclassified result.

## 6. Test local forecasting

Predict 12 successive steps (one hour) using only observations through the forecast origin:

```bash
python -m src.cli batch --task forecast --method baseline --sensor TEMP_01 \
  --start 2025-01-10T08:00:00Z --stride 12 --limit 3 --horizon 12 \
  --out results/forecast_baseline.jsonl

python -m src.cli batch --task forecast --method agentic --sensor TEMP_01 \
  --start 2025-01-10T08:00:00Z --stride 12 --limit 3 --horizon 12 \
  --out results/forecast_agentic.jsonl
```

The agent may retrieve historical continuations only when the entire continuation precedes the current origin.

## 7. Evaluate separately (ground-truth data never enters the agent)

```bash
python -m src.cli evaluate --task detect \
  --results results/demo_agentic.jsonl \
  --events data/ground_truth/demo_events.csv

python -m src.cli evaluate --task forecast \
  --results results/forecast_agentic.jsonl
```

**Attention:** four pilot predictions do not cover the full anomaly episodes. Event-level detection metrics from such a tiny pilot are NOT meaningful. For valid scientific results, evaluate complete, preregistered periods containing normal and abnormal observations.

## 8. Bring your own seven-year dataset

### Option A: long-format CSV

```
timestamp,sensor_id,zone_id,value
2020-01-01T00:00:00Z,TEMP_01,Zone_A,23.1
2020-01-01T00:05:00Z,TEMP_01,Zone_A,23.2
2020-01-01T00:00:00Z,CO2_01,Zone_A,510
```

```bash
python -m src.cli ingest --csv data/raw/YOUR_SENSOR_DATA.csv \
  --format long --timestamp-col timestamp \
  --sensor-col sensor_id --value-col value --zone-col zone_id
```

### Option B: wide-format CSV

```
timestamp,temperature,humidity,co2,occupancy,power
2020-01-01T00:00:00Z,23.1,55,510,4,2.5
2020-01-01T00:05:00Z,23.2,55,515,5,2.6
```

```bash
python -m src.cli ingest --csv data/raw/YOUR_SENSOR_DATA.csv \
  --format wide --timestamp-col timestamp \
  --wide-sensors temperature humidity co2 occupancy power
```

**Wide-format sensor columns must be supplied explicitly** using `--wide-sensors ...`. The importer fails closed rather than accidentally importing `anomaly_label` or `fault_type` as an observable sensor.

Optional sensor metadata file (never include labels): `data/sensor_metadata.csv` with columns `sensor_id,unit,sensor_type,description,equipment`.

### Ground truth (separate file)

Place a **separate** CSV at `data/ground_truth/events.csv`:

```
event_id,sensor_id,start_timestamp,end_timestamp,anomaly_type
F001,TEMP_01,2025-04-03T10:00:00Z,2025-04-03T11:00:00Z,drift
```

**Never ingest this event CSV** into DuckDB. The event evaluator reads it only after predictions are saved.

If your ground truth is pointwise rather than event intervals, convert consecutive labeled anomalies into event intervals in a separate preprocessing step. Do not expose the labels to retrieval.

## 9. Run a controlled experiment

Keep the same origin timestamps, model tag, and context budget for comparisons:

```bash
python -m src.cli batch --task detect --method baseline --sensor TEMP_01 \
  --start 2025-01-10T00:00:00Z --stride 1 --limit 288 \
  --out results/e0_temp_one_day.jsonl

python -m src.cli batch --task detect --method traditional --sensor TEMP_01 \
  --start 2025-01-10T00:00:00Z --stride 1 --limit 288 \
  --out results/e2_temp_one_day.jsonl

python -m src.cli batch --task detect --method agentic --sensor TEMP_01 \
  --start 2025-01-10T00:00:00Z --stride 1 --limit 288 \
  --out results/e3_temp_one_day.jsonl
```

The M1 may require a substantial amount of time for 288 local LLM calls, particularly Agentic RAG. Start with `--limit 4`, then `--limit 24`; scale only after validation. Do not run parallel model processes on 8 GB of RAM.

The implementation is a **working research prototype**, not a production Digital Twin. Before final FYP conclusions, establish held-out chronological/scenario partitions, evaluate complete episodes, run multiple independent periods, report uncertainty intervals, and investigate why the agent selects each tool. The `--stride 12` sampling mode is convenient for quick tests, but does not establish full five-minute anomaly-classification coverage.

## 10. Local dashboard

```bash
streamlit run dashboard.py
```

This opens a browser interface to view historical readings and saved prediction traces. It does not run any LLM inference or access anomaly labels.

## Troubleshooting on M1 8 GB

- `Connection refused` or `Ollama not running`: launch Ollama, test `curl http://127.0.0.1:11434/api/tags`.
- `Model not found`: run `ollama pull qwen3:1.7b` and check `.env`.
- macOS memory pressure: close Chrome and other heavy apps; use `qwen3:1.7b`, `NUM_CTX=2048`, `--max-rounds 1`. Keep experiments sequential.
- Invalid structured JSON: results show `valid:false`; the adapter retries once but never invents a classification or forecast.
- CSV date errors: convert timestamps explicitly into UTC ISO 8601 first.
- Schema mismatches: run `python -m src.cli inspect` and check your actual column names.

## Research constraints addressed

- **LLM-only decisions:** no pretrained anomaly classifier or forecasting model.
- **Agentic RAG:** LangGraph uses LLM-selected retrieval calls; not a fixed RAG chain.
- **Causality:** application-held `as_of` cutoff for all tools.
- **Labels hidden:** retrieval modules cannot read the ground-truth folder.
- **Numeric forecasts:** each horizon value validated and independently scored against actual future values.
- **Evaluation coverage:** invalid/unknown LLM decisions reported separately.

## Primary sources

- Ollama local models: https://ollama.com/library/qwen3
- Ollama JSON schema: https://docs.ollama.com/capabilities/structured-outputs
- LangGraph StateGraph: https://langchain-ai.github.io/langgraph/concepts/low_level/
- DuckDB CSV ingestion: https://duckdb.org/docs/current/clients/python/data_ingestion
- DuckDB UNPIVOT: https://duckdb.org/docs/current/sql/statements/unpivot

## 11. Chronological split manifest

After importing your **own** seven-year data:

```bash
python -m src.cli splits
cat data/splits.json
```

This writes chronological 60% / 20% / 20% boundaries from the dataset's time span. You can then restrict prediction origins to a selected partition:

```bash
python -m src.cli batch --task detect --method agentic --sensor TEMP_01 \
  --partition validation --stride 12 --limit 8 \
  --out results/validation_agentic.jsonl
```

Before the final study, adjust the boundaries to avoid cutting fault events or mixing independent generator scenarios. **Do not use test labels or metrics to revise your model settings.** The manifest restricts evaluated origins; the retriever still has permission to inspect previously observed readings in earlier partitions, which is correct for chronological deployment.


## Connect Malaysian Digital Twin Dataset v4

For this dataset, see [USE_YOUR_V4_DATASET.md](USE_YOUR_V4_DATASET.md). The new multi-file importer is `python -m src.v4_import` and does not overwrite the database once per year.
