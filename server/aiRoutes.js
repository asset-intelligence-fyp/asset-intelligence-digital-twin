import { AIError, analysePoint, validateAnalysisInput } from './aiService.js';
import { MODEL, PROMPT_VARIANT, VALIDATION_MODE } from './aiCore.js';

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);
export function createAiRouter(express, pool, { analyse = analysePoint } = {}) {
  const router = express.Router();
  let busy = false;
  router.use((req, res, next) => {
    // The PoC has no user accounts. Do not expose model inference to the LAN.
    if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: 'LOCAL_ONLY', message: 'Local AI endpoint only.' });
    const origin = req.headers.origin;
    if (origin) {
      let url;
      try { url = new URL(origin); } catch { return res.status(403).json({ error: 'INVALID_ORIGIN' }); }
      if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol))
        return res.status(403).json({ error: 'INVALID_ORIGIN', message: 'Only local browser origins may use the AI endpoint.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/status', (_req, res) => res.json({
    enabled: process.env.AI_ENABLED !== 'false', model: MODEL,
    prompt_variant: PROMPT_VARIANT, retrieval_variant: 'validated',
    validation_mode: VALIDATION_MODE,
    dataset: 'Level 5 synthetic PostgreSQL; not Level 03 research SQLite',
    note: 'An enabled endpoint does not guarantee Ollama is running.'
  }));
  router.post('/analyze', async (req, res) => {
    if (process.env.AI_ENABLED === 'false') return res.status(503).json({ error: 'AI_DISABLED', message: 'Local AI integration is disabled.' });
    let input;
    try { input = validateAnalysisInput(req.body); }
    catch (e) { return res.status(e.status || 400).json({ error: e.code || 'INVALID_INPUT', message: e.message }); }
    if (busy) return res.status(429).json({ error: 'AI_BUSY', message: 'A local Qwen3 request is already running. Retry when it finishes.' });
    busy = true;
    try { res.json(await analyse(pool, input)); }
    catch (e) {
      if (!(e instanceof AIError)) console.error('[AI] Analysis failed:', e?.message || e);
      res.status(e instanceof AIError ? e.status : 503).json({
        error: e instanceof AIError ? e.code : 'AI_SERVICE_ERROR',
        message: e instanceof AIError ? e.message : 'PostgreSQL or local analysis service unavailable.'
      });
    } finally { busy = false; }
  });
  return router;
}