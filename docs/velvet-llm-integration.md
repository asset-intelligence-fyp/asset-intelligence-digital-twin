# Velvet + Qwen3 1.7B integration

The **AI assistant** page and floating assistant now offer two modes without removing the existing Velvet interface:

- **Building evidence:** preserves Velvet's original whole-building evidence selection at `/api/assistant/building`, including weather, context and sensor scope.
- **Qwen room AI + 1-month forecast:** calls `/api/assistant/ask` for validated sensor anomaly assessments and `/api/assistant/predict` for Qwen-generated temperature, humidity and CO₂ values one calendar month ahead.

The Node API runs on port 3001; the local Python bridge (`llm_service/bridge.py`) uses port 8011; Ollama runs `qwen3:1.7b` on port 11434 with temperature 0. The real-time HTTP/SSE simulator, replay isolation, original building assistant and Velvet pages are preserved.

## Setup

From your Mac project folder:

```bash
git switch feature/velvet-ui
git pull --ff-only origin feature/velvet-ui
npm ci
ollama pull qwen3:1.7b
npm run dev
```

Start Ollama separately if it is not already running. The historical normal SQLite reference is read from `storage/digital_twin.sqlite` or from the `LLM_HISTORY_DB` environment variable.

Select **AI assistant → Qwen room AI + 1-month forecast**. Choose the room, run an anomaly assessment, or select a temperature/humidity/CO₂ sensor and click **Predict +1 month**. Forecasting requires connected HTTP mode; browser demo, what-if and timeline replay are not accepted by the forecast API. If no sufficient history exists, the UI shows the backend's `insufficient_history` result rather than a fabricated forecast.

The LLM supplies the future numerical estimate. The backend supplies prior observed monthly averages, checks JSON and physical bounds, and verifies anomaly claims against source statistics. The one-month forecast is **one future point reading**, not an entire month of predicted measurements; lower/upper scenarios are not calibrated confidence intervals.

## Evaluation and checks

```bash
npm run build
npm test
npm run test:ai
node --test tests/velvetRoomAI.test.mjs
python3 -m unittest discover -s tests -p 'test_room_prediction.py' -v
python3 -m unittest discover -s tests -p 'test_evaluate_llm_anomalies.py' -v
python3 -m unittest discover -s tests -p 'test_evaluate_llm_one_month.py' -v
python3 -m unittest discover -s tests -p 'test_llm_evaluation_reports.py' -v
```

To evaluate forecasting and anomaly performance, follow `README_LLM_RESEARCH_EVALUATION.md`. The one-month backtest writes `reports/llm_one_month_eval/summary.json`, which is shown in the AI interface. Private fault labels and synthetic evaluation outputs stay out of Git. Run a fresh evaluation on this integrated branch before making accuracy claims.

All sensor data remains synthetic, and the system does not claim verified physical-sensor fault diagnoses.
