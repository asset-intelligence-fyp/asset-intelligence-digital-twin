import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync('src/components/AssistantPlaceholder.tsx','utf8');
const backend=readFileSync('server/roomAssistant.js','utf8');
const predictor=readFileSync('llm_service/prediction.py','utf8');
test('one-month-only projection UI and API; unsupported horizons blocked',()=>{
 assert.match(ui,/Predict CO₂ in 1 month/);
 assert.match(ui,/horizon_months:1/);
 assert.doesNotMatch(ui,/<option value=\{(?:4|6|12|24)\}>/);
 assert.match(backend,/horizon_months!==1/);
 assert.match(predictor,/HORIZONS_MONTHS\s*=\s*\(1,\)/);
});
test('real measured accuracy report is opt-in and cannot be fabricated in UI',()=>{
 assert.match(ui,/\/api\/assistant\/evaluation/);
 assert.match(ui,/accuracy_score_pct/);
 assert.match(ui,/Not evaluated/);
 assert.match(ui,/MAE/);
 assert.match(ui,/RMSE/);
});
