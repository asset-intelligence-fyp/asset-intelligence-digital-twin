"""Generate human-readable model selection report from saved real result files."""
import argparse,json,datetime
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--anomaly',required=True);p.add_argument('--forecast');p.add_argument('--out',default='outputs/model_selection_report.md');a=p.parse_args()
 anomalies=json.loads(Path(a.anomaly).read_text(encoding='utf8'))
 forecasts=json.loads(Path(a.forecast).read_text(encoding='utf8')) if a.forecast else []
 lines=['# Digital Twin v4 Model Selection — Measured Results','',
        'This report is generated from real Ollama outputs, not predicted model rankings.','',
        '## Anomaly: full-set Accuracy > 85% required','',
        '| Model | Accuracy (all) | F1 | Recall | Coverage | Mean latency (s) | Pass? |','|---|---:|---:|---:|---:|---:|---|']
 def pct(x):return 'n/a' if x is None else f'{100*x:.2f}%'
 for r in anomalies:
  lines.append(f"| {r['model']} | {pct(r['accuracy_all'])} | {pct(r['f1'])} | {pct(r['recall'])} | {pct(r['coverage'])} | {r.get('mean_latency_s','n/a')} | {'YES' if r['success_gt85'] else 'NO'} |")
 if forecasts:
  lines+=['','## 90-day forecast, condition and trend','', '| Model | Historical condition macro F1 | Historical trend macro F1 | Scenario condition macro F1 | Scenario trend macro F1 | Valid response rate |','|---|---:|---:|---:|---:|---:|']
  for r in forecasts:
   lines.append(f"| {r['model']} | {pct(r.get('condition_macro_f1_historical'))} | {pct(r.get('trend_macro_f1_historical'))} | {pct(r.get('condition_macro_f1_scenarios'))} | {pct(r.get('trend_macro_f1_scenarios'))} | {pct(r.get('valid_response_rate'))} |")
  lines+=['','Numerical MAE/RMSE/WAPE are in the JSON results **per sensor**; MAE is never combined across incompatible units.']
 lines+=['','## Interpretation constraints','',
 '- Dataset v4 is synthetic, and matched sampling does not estimate the real-world fault prevalence.',
 '- Compare Accuracy on all cases, not classified-only accuracy.',
 '- Check error analysis by fault type and sensor, and compare precision/recall before deployment.',
 '- The archived website One-Month Prediction remains a separate task, not measured in this v4-only report.',
 '- Prompts and deployment strategies should be selected on development/validation runs; never repeatedly tune against this final blind test.',
 '- A model with insufficient schema validity or high latency may be unsuitable even if its accuracy is highest.']
 target=Path(a.out);target.parent.mkdir(parents=True,exist_ok=True);target.write_text('\n'.join(lines)+'\n',encoding='utf8');print('Report:',target)
if __name__=='__main__':main()
