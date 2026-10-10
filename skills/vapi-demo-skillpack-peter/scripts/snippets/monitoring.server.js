
// ---- Webhook store (Postgres) ------------------------------------------------------
// Three tables: end_of_call_reports (one row per call, from POST /vapi),
// monitors_webhook_events (monitor alerts and other webhooks, POST /webhooks/monitor?
// token=WEBHOOK_TOKEN), structured_output_results (one row per call per output).
// DATABASE_URL (Railway: ${{Postgres.DATABASE_URL}}) turns it on; without it,
// nothing is stored and nothing breaks. Storage never blocks a webhook reply.
let pgPool = null, pgReady = null;
async function pgInit() {
  if (!process.env.DATABASE_URL) return null;
  if (pgReady) return pgReady;
  pgReady = (async () => {
    const { default: pg } = await import('pg');
    pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4,
      ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    // Renamed webhook_events -> monitors_webhook_events (keeps existing rows).
    await pgPool.query(`DO $$ BEGIN
      IF to_regclass('public.webhook_events') IS NOT NULL AND to_regclass('public.monitors_webhook_events') IS NULL THEN
        ALTER TABLE webhook_events RENAME TO monitors_webhook_events;
      END IF; END $$`);
    await pgPool.query(`CREATE TABLE IF NOT EXISTS monitors_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT NOT NULL,              -- 'end-of-call-report' | 'monitor'
      event_type TEXT,
      call_id TEXT,
      assistant_id TEXT,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      payload JSONB NOT NULL)`);
    await pgPool.query('CREATE INDEX IF NOT EXISTS monitors_webhook_events_received_idx ON monitors_webhook_events (received_at DESC)');
    await pgPool.query('CREATE INDEX IF NOT EXISTS monitors_webhook_events_call_idx ON monitors_webhook_events (call_id)');
    // End-of-call logs: their own table, one row per call.
    await pgPool.query(`CREATE TABLE IF NOT EXISTS end_of_call_reports (
      id BIGSERIAL PRIMARY KEY,
      call_id TEXT NOT NULL UNIQUE,
      assistant_id TEXT,
      call_type TEXT,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_seconds NUMERIC,
      ended_reason TEXT,
      cost NUMERIC,
      summary TEXT,
      transcript TEXT,
      recording_url TEXT,
      payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pgPool.query('CREATE INDEX IF NOT EXISTS eoc_received_idx ON end_of_call_reports (received_at DESC)');
    // One-time move: end-of-call reports stored in monitors_webhook_events before this table existed.
    await pgPool.query(`INSERT INTO end_of_call_reports (call_id, assistant_id, is_simulation, ended_reason, payload, received_at)
      SELECT DISTINCT ON (call_id) call_id, assistant_id, is_simulation, event_type, payload, received_at
      FROM monitors_webhook_events WHERE source = 'end-of-call-report' AND call_id IS NOT NULL
      ORDER BY call_id, received_at DESC ON CONFLICT (call_id) DO NOTHING`);
    // Structured output results: their own table, one row per call per output.
    await pgPool.query(`CREATE TABLE IF NOT EXISTS structured_output_results (
      id BIGSERIAL PRIMARY KEY,
      call_id TEXT NOT NULL,
      structured_output_id TEXT NOT NULL,
      name TEXT,
      result JSONB,                      -- the extracted value (true/false, text, object…)
      assistant_id TEXT,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      call_ended_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (call_id, structured_output_id))`);
    await pgPool.query('CREATE INDEX IF NOT EXISTS so_results_received_idx ON structured_output_results (received_at DESC)');
    console.log('[db] monitors_webhook_events ready');
    return pgPool;
  })().catch((err) => { console.error('[db] init failed', err.message); pgReady = null; return null; });
  return pgReady;
}
async function storeEvent(ev) {
  try {
    const pool = await pgInit();
    if (!pool) return;
    await pool.query('INSERT INTO monitors_webhook_events (source, event_type, call_id, assistant_id, is_simulation, payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [ev.source, ev.eventType ?? null, ev.callId ?? null, ev.assistantId ?? null, !!ev.isSimulation, JSON.stringify(ev.payload ?? {})]);
  } catch (err) { console.error('[db] store failed', err.message); }
}
function storeEndOfCall(message) {
  if (message?.type !== 'end-of-call-report') return;
  storeCallLog(message).catch((err) => console.error('[db] call log store failed', err.message));
  storeStructuredOutputs(message);
}
async function storeCallLog(m) {
  const pool = await pgInit();
  if (!pool || !m.call?.id) return;
  const a = m.artifact ?? {};
  const started = m.startedAt ?? m.call?.startedAt ?? null, ended = m.endedAt ?? m.call?.endedAt ?? null;
  const dur = m.durationSeconds ?? (started && ended ? (Date.parse(ended) - Date.parse(started)) / 1000 : null);
  await pool.query(`INSERT INTO end_of_call_reports (call_id, assistant_id, call_type, is_simulation, started_at, ended_at,
      duration_seconds, ended_reason, cost, summary, transcript, recording_url, payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (call_id) DO UPDATE SET ended_reason = EXCLUDED.ended_reason, cost = EXCLUDED.cost, summary = EXCLUDED.summary,
      transcript = EXCLUDED.transcript, recording_url = EXCLUDED.recording_url, payload = EXCLUDED.payload, received_at = now()`,
    [m.call.id, m.assistant?.id ?? m.call?.assistantId ?? null, m.call?.type ?? null, isTestCall(m.call), started, ended, dur,
      m.endedReason ?? null, m.cost ?? null, m.analysis?.summary ?? m.summary ?? null, a.transcript ?? m.transcript ?? null,
      a.recordingUrl ?? a.recording?.mono?.combinedUrl ?? m.recordingUrl ?? null, JSON.stringify(m)]);
}

// Structured outputs → structured_output_results. Taken from the end-of-call
// report when it carries them (artifact.structuredOutputs = {id: {name, result}});
// otherwise the call is re-read from Vapi 20 s and 60 s later, since extraction
// can finish after the report. Upserts on (call_id, structured_output_id).
async function upsertStructuredOutputs(call, outputs, isSimulation) {
  const entries = Object.entries(outputs ?? {});
  if (!entries.length) return 0;
  const pool = await pgInit();
  if (!pool) return 0;
  for (const [soId, v] of entries) {
    await pool.query(`INSERT INTO structured_output_results (call_id, structured_output_id, name, result, assistant_id, is_simulation, call_ended_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (call_id, structured_output_id) DO UPDATE SET name = EXCLUDED.name, result = EXCLUDED.result, received_at = now()`,
      [call.id, soId, v?.name ?? null, JSON.stringify(v?.result ?? v ?? null), call.assistantId ?? null, !!isSimulation, call.endedAt ?? null]);
  }
  return entries.length;
}
// Post-call results also go to the live board (event 'call.structured'), once
// per call, for real calls only — the transcript shows them under the call.
const soAnnounced = new Set();
function announceStructuredOutputs(call, outputs, sim) {
  const list = Object.values(outputs ?? {}).map((v) => ({ name: v?.name ?? 'output', result: v?.result ?? v ?? null }));
  if (!list.length || sim || soAnnounced.has(call.id)) return;
  soAnnounced.add(call.id);
  if (soAnnounced.size > 500) soAnnounced.delete(soAnnounced.values().next().value);
  emitEvent('call.structured', { callId: call.id, outputs: list });
}
function storeStructuredOutputs(message) {
  const call = { ...(message.call ?? {}), assistantId: message.assistant?.id ?? message.call?.assistantId, endedAt: message.endedAt ?? message.call?.endedAt };
  if (!call.id) return;
  const sim = isTestCall(message.call);
  const fromReport = message.artifact?.structuredOutputs ?? message.call?.artifact?.structuredOutputs;
  announceStructuredOutputs(call, fromReport, sim);
  upsertStructuredOutputs(call, fromReport, sim).catch((err) => console.error('[db] so store failed', err.message));
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  if (!key) return;
  for (const delay of [20000, 60000]) setTimeout(async () => {
    try {
      const r = await fetch(`https://api.vapi.ai/call/${call.id}`, { headers: { authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const c = await r.json();
      announceStructuredOutputs(call, c.artifact?.structuredOutputs, sim);
      const n = await upsertStructuredOutputs({ ...call, endedAt: c.endedAt ?? call.endedAt }, c.artifact?.structuredOutputs, sim);
      if (n) console.log(`[db] ${n} structured outputs stored for ${call.id} (+${delay / 1000}s)`);
    } catch (err) { console.error('[db] so refetch failed', err.message); }
  }, delay);
}

// POST /webhooks/monitor?token=…  — Vapi monitor notifier → stored as source 'monitor'.
async function monitorWebhookHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  if (!process.env.WEBHOOK_TOKEN || token !== process.env.WEBHOOK_TOKEN) return send(401, { error: 'bad token' });
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2e6) return send(413, { error: 'too large' }); }
  let j; try { j = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad json' }); }
  const m = j.message ?? j;
  const callId = m.callId ?? m.call?.id ?? null;
  storeEvent({ source: 'monitor', eventType: m.type ?? m.event ?? m.severity ?? 'monitor',
    callId, assistantId: m.assistantId ?? m.call?.assistantId ?? null, payload: j });
  // A monitor alert about a specific call also shows in that call's transcript.
  if (callId) emitEvent('call.monitor', { callId, title: m.name ?? m.monitor?.name ?? m.title ?? 'Monitor alert',
    severity: m.severity ?? m.issue?.severity ?? null, detail: m.description ?? m.message ?? null });
  send(200, { ok: true });
}

// GET /monitoring — data for the "Monitoring & Structured Outputs" tab: this
// agent's monitors + issues from Vapi, and the latest stored webhook events.
let monitoringCache = null;
async function monitoringHandler(res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  if (monitoringCache && Date.now() - monitoringCache.at < 15000) return send(200, monitoringCache.body);
  const get = async (path) => {
    try { const r = await fetch('https://api.vapi.ai' + path, { headers: { authorization: `Bearer ${key}` } }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j) ? j : (j?.results ?? j); } catch { return null; }
  };
  const forThis = (x) => { const ids = x.assistantIds ?? x.filter?.assistantIds ?? x.assistants ?? null; return !ids || !ids.length || ids.includes(aid); };
  const [monitors, issues] = await Promise.all([get('/monitoring/monitor?limit=100'), get('/monitoring/issue?limit=50')]);
  let events = null, soRows = [], callLogs = [], stored = { enabled: !!process.env.DATABASE_URL, total: null, soTotal: null, logTotal: null };
  try {
    const pool = await pgInit();
    if (pool) {
      const r = await pool.query(`SELECT id, received_at, source, event_type, call_id, is_simulation,
        COALESCE(payload->>'name', payload->'monitor'->>'name', payload->>'title') AS title,
        COALESCE(payload->>'severity', payload->'issue'->>'severity') AS severity
        FROM monitors_webhook_events WHERE source <> 'end-of-call-report' ORDER BY received_at DESC LIMIT 25`);
      events = r.rows;
      stored.total = Number((await pool.query(`SELECT count(*) FROM monitors_webhook_events WHERE source <> 'end-of-call-report'`)).rows[0].count);
      const l = await pool.query(`SELECT call_id, call_type, is_simulation, ended_at, received_at, duration_seconds, ended_reason, cost, summary
        FROM end_of_call_reports ORDER BY received_at DESC LIMIT 15`);
      callLogs = l.rows;
      stored.logTotal = Number((await pool.query('SELECT count(*) FROM end_of_call_reports')).rows[0].count);
      const so = await pool.query(`SELECT call_id, name, result, is_simulation, received_at FROM structured_output_results
        ORDER BY received_at DESC, name LIMIT 60`);
      soRows = so.rows;
      stored.soTotal = Number((await pool.query('SELECT count(*) FROM structured_output_results')).rows[0].count);
    }
  } catch (err) { console.error('[db] read failed', err.message); }
  const body = {
    monitors: (monitors ?? []).filter(forThis).map((m) => ({ id: m.id, name: m.name ?? 'Monitor', category: m.category ?? m.type ?? null,
      description: m.description ?? m.evaluation?.description ?? m.prompt ?? null, enabled: m.enabled ?? m.active ?? true })),
    issues: (issues ?? []).slice(0, 25).map((i) => ({ id: i.id, title: i.title ?? i.name ?? i.monitorName ?? 'Issue', severity: i.severity ?? null,
      status: i.status ?? null, createdAt: i.createdAt ?? null, count: i.count ?? i.callCount ?? null })),
    stored, events: events ?? [], structuredOutputResults: soRows, callLogs,
    webhookPath: '/webhooks/monitor?token=<WEBHOOK_TOKEN>',
  };
  monitoringCache = { at: Date.now(), body };
  send(200, body);
}
