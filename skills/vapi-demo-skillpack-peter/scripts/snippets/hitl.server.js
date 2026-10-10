
// ---- Human in the loop (transcripts + regex watcher) --------------------------------
// Every FINAL transcript line goes to the `transcripts` table. Caller lines (role
// "user") are checked against HITL_REGEX (default: swear words + anger); the first
// match on a call creates a `human_in_the_loop` row (later matches add to it),
// posts to HITL_WEBHOOK_URL if set, and tells the live board ('hitl.flag', real
// calls only). Never blocks the Vapi webhook.
const HITL_DEFAULT = String.raw`\b(idiot|idiots|stupid|dumb(?:ass)?|dummy|moron|imbecile|f+u+c+k\w*|f\*+k\w*|shit\w*|bullshit|damn(?:ed|it)?|crap|ass(?:hole)?s?|bitch\w*|bastard|piss(?:ed)?(?: off)?|screw you|shut up|useless|worthless|incompetent|worst|ridiculous|pathetic|terrible|garbage|hate (?:this|you|it)|sick of (?:this|you)|fed up)\b`;
let hitlRe = null;
function hitlRegex() {
  if (hitlRe) return hitlRe;
  try { hitlRe = new RegExp(process.env.HITL_REGEX || HITL_DEFAULT, 'gi'); }
  catch (err) { console.error('[hitl] bad HITL_REGEX, using default', err.message); hitlRe = new RegExp(HITL_DEFAULT, 'gi'); }
  return hitlRe;
}
let hitlTablesReady = null;
async function hitlTables() {
  const pool = await pgInit();
  if (!pool) return null;
  hitlTablesReady ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS transcripts (
      id BIGSERIAL PRIMARY KEY,
      call_id TEXT NOT NULL,
      role TEXT NOT NULL,                 -- 'user' (caller) | 'assistant'
      text TEXT NOT NULL,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('CREATE INDEX IF NOT EXISTS transcripts_call_idx ON transcripts (call_id, received_at)');
    await pool.query(`CREATE TABLE IF NOT EXISTS human_in_the_loop (
      id BIGSERIAL PRIMARY KEY,
      call_id TEXT NOT NULL UNIQUE,
      assistant_id TEXT,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      matched_terms TEXT[] NOT NULL DEFAULT '{}',
      match_count INT NOT NULL DEFAULT 0,
      first_text TEXT,
      last_text TEXT,
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'handled'
      flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      handled_at TIMESTAMPTZ)`);
    console.log('[db] transcripts + human_in_the_loop ready');
  })().catch((err) => { console.error('[db] hitl init failed', err.message); hitlTablesReady = null; });
  await hitlTablesReady;
  return pool;
}
function hitlOnTranscript(message) {
  if (message?.type !== 'transcript' || message.transcriptType !== 'final' || !message.call?.id) return;
  const text = String(message.transcript ?? '').trim();
  if (!text) return;
  const callId = message.call.id, sim = isTestCall(message.call);
  const role = message.role === 'user' ? 'user' : 'assistant';
  (async () => {
    const pool = await hitlTables();
    if (pool) await pool.query('INSERT INTO transcripts (call_id, role, text, is_simulation) VALUES ($1,$2,$3,$4)', [callId, role, text, sim]);
    if (role !== 'user') return;
    const terms = [...new Set([...text.matchAll(hitlRegex())].map((m) => m[0].toLowerCase()))];
    if (!terms.length) return;
    let first = true;
    if (pool) {
      const r = await pool.query(`INSERT INTO human_in_the_loop (call_id, assistant_id, is_simulation, matched_terms, match_count, first_text, last_text)
        VALUES ($1,$2,$3,$4,$5,$6,$6)
        ON CONFLICT (call_id) DO UPDATE SET
          matched_terms = (SELECT ARRAY(SELECT DISTINCT unnest(human_in_the_loop.matched_terms || EXCLUDED.matched_terms))),
          match_count = human_in_the_loop.match_count + EXCLUDED.match_count,
          last_text = EXCLUDED.last_text, updated_at = now()
        RETURNING (xmax = 0) AS inserted`,
        [callId, message.call.assistantId ?? message.assistant?.id ?? null, sim, terms, terms.length, text]);
      first = !!r.rows[0]?.inserted;
    }
    console.log(`[hitl] ${first ? 'FLAGGED' : 'more'} call=${callId} terms=${terms.join(',')}${sim ? ' (simulation)' : ''}`);
    const payload = { type: 'human-in-the-loop', callId, terms, text, isSimulation: sim, at: new Date().toISOString() };
    if (!sim) emitEvent('hitl.flag', { callId, terms, text, first });
    if (first && process.env.HITL_WEBHOOK_URL) {
      fetch(process.env.HITL_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .catch((err) => console.error('[hitl] outbound webhook failed', err.message));
    }
  })().catch((err) => console.error('[hitl] failed', err.message));
}

// GET /hitl — flagged calls for the tab; POST /hitl/handled {id} — mark one handled.
async function hitlHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const pool = await hitlTables();
  if (!pool) return send(200, { enabled: false, regex: (process.env.HITL_REGEX || HITL_DEFAULT), items: [] });
  if (req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    let id; try { ({ id } = JSON.parse(body || '{}')); } catch { return send(400, { error: 'bad json' }); }
    if (!Number.isInteger(id)) return send(400, { error: 'bad id' });
    await pool.query(`UPDATE human_in_the_loop SET status = 'handled', handled_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return send(200, { ok: true });
  }
  const r = await pool.query(`SELECT id, call_id, is_simulation, matched_terms, match_count, first_text, last_text, status, flagged_at, updated_at, handled_at
    FROM human_in_the_loop ORDER BY flagged_at DESC LIMIT 50`);
  const counts = (await pool.query(`SELECT count(*) FILTER (WHERE status = 'open') AS open, count(*) AS total FROM human_in_the_loop`)).rows[0];
  send(200, { enabled: true, regex: (process.env.HITL_REGEX || HITL_DEFAULT), webhook: !!process.env.HITL_WEBHOOK_URL,
    open: Number(counts.open), total: Number(counts.total), items: r.rows });
}
