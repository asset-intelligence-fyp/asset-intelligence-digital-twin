import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';
import { POINTS, useTwin } from '../services/twin';
import '../ai-assistant.css';

type NumericWindow = {
  count: number; average: number; minimum: number; maximum: number;
  last: { value: number; timestamp: string };
};
type AIResult = {
  sensor_id: string; room_id: string; status: string; finding: string;
  review_required: boolean; triage_alert: boolean | null;
  numeric_verification_passed: boolean; semantic_conflict: boolean;
  verified_evidence: {
    unit: string; current_window: NumericWindow | null;
    historical_baseline: { selected_days: number; window_mean_median: number | null } | null;
    anomaly_assessment: { status: string; difference: number | null; absolute_threshold: number | null };
    operating_context: { equipment_code: string };
  };
  evidence: string[]; hypotheses_unverified: string[]; recommended_checks: string[];
  verification: { passed: boolean; issues: string[]; warnings?: string[] };
  decision_assessment: { llm_alert?: boolean | null; rule_alert?: boolean | null; disagreement?: boolean };
  llm_assessment?: { finding_unverified?: string | null };
  model: string; latency_seconds: number; source_notice: string;
};
const malaysiaInput = (date: Date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
const stamp = (s: string) => `${s}:00+08:00`;
const statusText: Record<string, string> = {
  alert: 'Investigation alert', no_alert: 'No alert under current evidence',
  review_required: 'Human review required', insufficient_evidence: 'Insufficient evidence',
  validation_failed: 'AI response not verified'
};
export function AssistantPanel({ selectedCode }: { selectedCode?: string }) {
  const { mode } = useTwin();
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState(selectedCode && POINTS.some(p => p.code === selectedCode) ? selectedCode : POINTS[0].code);
  const [start, setStart] = useState(() => malaysiaInput(new Date(Date.now() - 60 * 60 * 1000)));
  const [end, setEnd] = useState(() => malaysiaInput(new Date()));
  const [question, setQuestion] = useState('Compare this sensor with its historical readings and explain whether an investigation is recommended.');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AIResult | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (selectedCode && POINTS.some(p => p.code === selectedCode)) setPoint(selectedCode); }, [selectedCode]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        controller.current?.abort(); setOpen(false); launcherRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { controller.current?.abort(); setOpen(false); launcherRef.current?.focus(); };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true); setError(''); setResult(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ point_code: point, window_start: stamp(start), window_end: stamp(end), question })
      });
      const data: AIResult & { message?: string } = await response.json();
      if (!response.ok) throw Error(data.message || `AI request failed (${response.status})`);
      setResult(data);
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'AI service unavailable');
    } finally {
      if (controller.current === abort) controller.current = null;
      setPending(false);
    }
  }
  const current = result?.verified_evidence.current_window;
  const baseline = result?.verified_evidence.historical_baseline;
  return <>
    <button ref={launcherRef} type="button" className="ask-floating" aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
      aria-controls="twinlabs-ai-assistant" aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
      <MessageCircle size={17} aria-hidden="true" /><span>AI Assistant</span>
    </button>
    {open && <section id="twinlabs-ai-assistant" className="assistant-panel twinlabs-assistant" role="dialog"
      aria-modal="false" aria-labelledby="twinlabs-assistant-title" aria-describedby="twinlabs-assistant-description">
      <div className="assistant-head">
        <span className="assistant-avatar" aria-hidden="true"><Bot size={17}/></span>
        <div className="assistant-identity"><strong id="twinlabs-assistant-title">TwinLabs AI Assistant</strong>
          <div className="eyebrow">LOCAL QWEN3 · VERIFIED EVIDENCE</div></div>
        <button ref={closeRef} type="button" className="close-icon" aria-label="Close AI Assistant" onClick={close}><X size={18}/></button>
      </div>
      <div className="assistant-messages ai-live-body" id="twinlabs-assistant-description">
        <p className="ai-source-note">Snowdon Towers · Level 5 · nine PostgreSQL sensor points. Data is synthetic.
          {mode === 'random' ? ' Browser random-mode readings are not stored in PostgreSQL and cannot be analysed here.' : ' Analyses use stored MQTT readings, not unpersisted browser values.'}</p>
        <form className="ai-controls" onSubmit={e => void submit(e)}>
          <label>Sensor point
            <select aria-label="AI sensor point" value={point} onChange={e => setPoint(e.target.value)} disabled={pending}>
              {POINTS.map(p => <option key={p.code} value={p.code}>{p.code} · {p.assetId}</option>)}
            </select>
          </label>
          <div className="ai-time-grid">
            <label>From (MYT +08)
              <input aria-label="Analysis window start Malaysia time" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} required disabled={pending}/>
            </label>
            <label>To (MYT +08)
              <input aria-label="Analysis window end Malaysia time" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} required disabled={pending}/>
            </label>
          </div>
          <label>Question
            <textarea aria-label="AI question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={700} rows={2} disabled={pending}/>
          </label>
          <button className="ai-submit" type="submit" disabled={pending || !question.trim() || !start || !end}>
            <Send size={14}/>{pending ? 'Analysing local sensor history…' : 'Analyse verified history'}
          </button>
        </form>
        {error && <p className="ai-error" role="alert">{error}</p>}
        {result && <div className="ai-analysis" aria-live="polite">
          <div className={`ai-result-status ai-status-${result.status}`}><strong>{statusText[result.status] || result.status}</strong>
            <span>{result.sensor_id} · {result.verified_evidence.operating_context.equipment_code}</span></div>
          <p className="ai-finding">{result.finding}</p>
          <div className="ai-metrics">
            <div><span>Readings</span><strong>{current?.count ?? '—'}</strong></div>
            <div><span>Average</span><strong>{current ? `${current.average} ${result.verified_evidence.unit}` : '—'}</strong></div>
            <div><span>Maximum</span><strong>{current ? `${current.maximum} ${result.verified_evidence.unit}` : '—'}</strong></div>
            <div><span>Previous baseline</span><strong>{baseline?.window_mean_median != null ? `${baseline.window_mean_median} ${result.verified_evidence.unit}` : 'Unavailable'}</strong></div>
          </div>
          <p className="ai-verification">Verified numeric evidence: <strong>{result.numeric_verification_passed ? 'Passed' : 'Not verified'}</strong>
            {' · '}Semantic conflict: <strong>{result.semantic_conflict ? 'Review' : 'None detected'}</strong></p>
          {result.review_required && <p className="ai-review-note">Human review is requested. This does not confirm a fault.</p>}
          <details><summary>Read-only sensor evidence</summary><ul>{result.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
          {result.hypotheses_unverified.length > 0 && <details><summary>LLM hypotheses (not verified causes)</summary><ul>{result.hypotheses_unverified.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
          {result.recommended_checks.length > 0 && <details><summary>Recommended checks</summary><ul>{result.recommended_checks.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
          <details><summary>Decision provenance and limitations</summary>
            <p>LLM: {String(result.decision_assessment.llm_alert ?? 'unavailable')} · Independent rule: {String(result.decision_assessment.rule_alert ?? 'unavailable')}</p>
            <p>{result.source_notice}</p><p>{result.model} · P2 concise · R4.3.1-style hybrid semantic · {result.latency_seconds}s</p>
            {result.verification.issues?.length > 0 && <ul>{result.verification.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </details>
        </div>}
      </div>
      <div className="assistant-foot">Private local Ollama · Python-free Level 5 PostgreSQL adapter · deterministic backend retrieval</div>
    </section>}
  </>;
}