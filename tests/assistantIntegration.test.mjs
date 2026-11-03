import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync('src/components/AssistantPanel.tsx', 'utf8');
const shell = readFileSync('src/components/Shell.tsx', 'utf8');
const app = readFileSync('src/main.tsx', 'utf8');
const css = readFileSync('src/ai-assistant.css', 'utf8');
const api = readFileSync('server/index.js', 'utf8');
test('assistant is present on all pages and performs a real POST to the backend', () => {
  assert.match(shell, /import \{ AssistantPanel \} from '\.\/AssistantPanel'/);
  assert.match(shell, /<AssistantPanel selectedCode=\{selectedCode\}\s*\/>/);
  assert.match(ui, /fetch\('\/api\/ai\/analyze'/);
  assert.match(ui, /method: 'POST'/);
  assert.match(ui, /aria-expanded=\{open\}/);
  assert.match(ui, /event\.key === 'Escape'/);
  assert.doesNotMatch(ui, /Coming soon|Messaging coming soon|disabled placeholder/);
  assert.match(css, /\.ai-analysis/);
  assert.match(api, /createAiRouter/);
});
test('BIM and monitor selections are sent through shared App state', () => {
  assert.match(app, /<Shell page=\{page\} setPage=\{setPage\} selectedCode=\{selectedCode\}>/);
  assert.match(app, /<Sensors selectedCode=\{selectedCode\} onSelectCode=\{setSelectedCode\}\s*\/>/);
  assert.match(ui, /POINTS\.map\(p => <option/);
  assert.match(ui, /useEffect\(\(\) => \{ if \(selectedCode/);
});