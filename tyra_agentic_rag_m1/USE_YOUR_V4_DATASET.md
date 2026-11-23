# Connect Malaysian Digital Twin Dataset v4

This guide works with an external directory at:

`/Users/tyralee/Desktop/malaysian_digital_twin_llm_dataset_v4`

Do not duplicate the seven-year sensor data. The adapter reads the source files directly and streams the selected sensor measurements into the project's local DuckDB file.

## 1. Activate your project

```bash
cd ~/Downloads/tyra_agentic_rag_m1
source .venv/bin/activate
export DATASET="/Users/tyralee/Desktop/malaysian_digital_twin_llm_dataset_v4"
```

Adjust the project directory if you extracted it elsewhere.

## 2. Inspect actual file schemas **first**

```bash
python -m src.v4_import inspect --dataset "$DATASET"
```

The output lists the columns of each `sensor_history.csv` from 2019–2025 and 2026 Q1, along with the headers of the sensor registry, forecast reference files, and ground-truth tables. It also shows sample timestamps from sensor histories. The importer does **not** assume all columns are numerical sensors or guess the dataset format.

## 3. Import the 2019–2025 history and optionally 2026 Q1

### Long format (only when the CSV really has the named columns)

For columns such as `timestamp,sensor_id,zone_id,value`:

```bash
python -m src.v4_import import --dataset "$DATASET" \
  --format long --timestamp-col timestamp \
  --sensor-col sensor_id --value-col value \
  --zone-col zone_id --include-2026 --replace
```

If sensor IDs are only unique within each room, add `--id-strategy zone`. This changes IDs to `zone::sensor`, so event labels must use that same naming convention during evaluation.

### Wide format (only when your actual headers match)

For columns such as `timestamp,room_id,temperature,humidity,co2,power`:

```bash
python -m src.v4_import import --dataset "$DATASET" \
  --format wide --timestamp-col timestamp \
  --zone-col room_id --wide-sensors temperature humidity co2 power \
  --id-strategy zone --include-2026 --replace
```

**Never add label/fault/anomaly or future-value columns to `--wide-sensors`.** The adapter refuses suspicious names.

All named column values above are examples. Use the exact headers reported by the `inspect` command.

### Timezone convention

The existing project stores UTC-naive timestamps and prints origins with a trailing `Z`.

- `--time-mode as-written` (default) only works if the input timestamps already represent UTC; this mode also accepts naive inputs but then the user must confirm they are UTC.
- `--time-mode malaysia-local` subtracts 8 hours from **timezone-naive Malaysian local timestamps** before storing them as UTC-naive.
- `--time-mode offset-aware` converts timestamps that contain explicit timezone offsets or `Z` to UTC.

Use **one consistent convention for every source and for evaluation labels**. Do not choose a mode without checking actual sample timestamps and source documentation.

## 4. Inspect imported sensors

```bash
python -m src.cli inspect
python -m src.cli splits
```

`data/building.duckdb` is the local datastore. The original dataset remains untouched on Desktop. The `splits` command makes generic chronological 60/20/20 boundaries; for a research comparison using **2026 Q1 as an independent anomaly-evaluation scenario**, edit `data/splits.json` before final experiments and avoid choosing prompts based on the final test outcomes.

## 5. Execute a small local pilot

Choose an exact `sensor_id` and timestamp returned by `inspect`. The examples below contain placeholders **not valid shell literals**. Replace them:

```bash
python -m src.cli batch --task detect --method baseline \
  --sensor 'YOUR_SENSOR_ID' --start 'YOUR_UTC_TIMESTAMP' \
  --stride 1 --limit 4 --out results/v4_baseline.jsonl

python -m src.cli batch --task detect --method traditional \
  --sensor 'YOUR_SENSOR_ID' --start 'YOUR_UTC_TIMESTAMP' \
  --stride 1 --limit 4 --out results/v4_traditional.jsonl

python -m src.cli batch --task detect --method agentic \
  --sensor 'YOUR_SENSOR_ID' --start 'YOUR_UTC_TIMESTAMP' \
  --stride 1 --limit 4 --out results/v4_agentic.jsonl

python -m src.cli batch --task forecast --method agentic \
  --sensor 'YOUR_SENSOR_ID' --start 'YOUR_UTC_TIMESTAMP' \
  --stride 12 --limit 4 --horizon 12 \
  --out results/v4_forecast.jsonl

python -m src.cli evaluate --task forecast --results results/v4_forecast.jsonl
```

Forecast evaluation directly against the sensor table works only if the true future readings are in `data/building.duckdb`. The specifically defined 90-day forecasting case inputs and `_HIDDEN` targets may require a separate adapter, since their schema and target mapping are not yet known. Do **not** add hidden forecast files to the retrieval database.

## 6. Separate ground-truth evaluation

In the original project, the detection evaluator expects event records with exactly these fields:

`event_id,sensor_id,start_timestamp,end_timestamp,anomaly_type`

Your dataset has a file at:

`generated/anomaly_eval_2026_q1_evaluation_keys/ground_truth_events.csv`

**Inspect its header before calling the evaluator.** If fields, timezone, or sensor ID conventions differ, create a separate evaluation-only normalization file. It must not be accessible to retrieval tools or the LLM. For matching event IDs, you must preserve the distinction between zone and sensor identifiers.

After the file is confirmed compatible or separately normalized:

```bash
python -m src.cli evaluate --task detect \
  --results results/v4_agentic.jsonl \
  --events /absolute/path/to/compatible_evaluation_events.csv
```

For meaningful event-level recall and false-alert rates, do not rely on a four-sample pilot. Evaluate complete episodes using every five-minute origin across a representative period.

## 7. Current limitations

- The adapter imports **only** yearly `sensor_history.csv` files and optionally 2026 Q1 `sensor_history.csv`. It deliberately does not load labels or hidden targets.
- Building-context files such as HVAC state, weather, bookings, occupancy, and holidays are **not yet wired into Agentic RAG's context tools**. That integration needs exact headers and strict as-of-time rules.
- Visible forecast case inputs and the hidden targets use a separate evaluation protocol; they are not automatically inferred from filenames.
- The importer validates duplicates but can require substantial disk storage for many millions of observations. Keep your Mac plugged in, ensure disk space, and run one import at a time.
- Because the actual dataset CSV contents were not supplied here, the adapter's full database integration has not been tested against your real schema. Syntax and file-discovery checks were performed; exact column mapping must be confirmed using `inspect`.
