
// ---- Webhook store (Postgres) ------------------------------------------------------
// Stores every end-of-call report (POST /vapi) and every monitor alert
// (POST /webhooks/monitor?token=WEBHOOK_TOKEN) in one table, webhook_events.
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
    await pgPool.query(`CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT NOT NULL,              -- 'end-of-call-report' | 'monitor'
      event_type TEXT,
      call_id TEXT,
      assistant_id TEXT,
      is_simulation BOOLEAN NOT NULL DEFAULT false,
      payload JSONB NOT NULL)`);
    await pgPool.query('CREATE INDEX IF NOT EXISTS webhook_events_received_idx ON webhook_events (received_at DESC)');
    await pgPool.query('CREATE INDEX IF NOT EXISTS webhook_events_call_idx ON webhook_events (call_id)');
    console.log('[db] webhook_events ready');
    return pgPool;
  })().catch((err) => { console.error('[db] init failed', err.message); pgReady = null; return null; });
  return pgReady;
}
async function storeEvent(ev) {
  try {
    const pool = await pgInit();
    if (!pool) return;
    await pool.query('INSERT INTO webhook_events (source, event_type, call_id, assistant_id, is_simulation, payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [ev.source, ev.eventType ?? null, ev.callId ?? null, ev.assistantId ?? null, !!ev.isSimulation, JSON.stringify(ev.payload ?? {})]);
  } catch (err) { console.error('[db] store failed', err.message); }
}
function storeEndOfCall(message) {
  if (message?.type !== 'end-of-call-report') return;
  storeEvent({ source: 'end-of-call-report', eventType: message.endedReason ?? null, callId: message.call?.id,
    assistantId: message.assistant?.id ?? message.call?.assistantId, isSimulation: isTestCall(message.call), payload: message });
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
  storeEvent({ source: 'monitor', eventType: m.type ?? m.event ?? m.severity ?? 'monitor',
    callId: m.callId ?? m.call?.id ?? null, assistantId: m.assistantId ?? m.call?.assistantId ?? null, payload: j });
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
  let events = null, stored = { enabled: !!process.env.DATABASE_URL, total: null };
  try {
    const pool = await pgInit();
    if (pool) {
      const r = await pool.query(`SELECT id, received_at, source, event_type, call_id, is_simulation,
        payload->'analysis'->>'summary' AS summary, payload->>'endedReason' AS ended_reason,
        COALESCE(payload->>'name', payload->'monitor'->>'name', payload->>'title') AS title,
        COALESCE(payload->>'severity', payload->'issue'->>'severity') AS severity
        FROM webhook_events ORDER BY received_at DESC LIMIT 25`);
      events = r.rows;
      stored.total = Number((await pool.query('SELECT count(*) FROM webhook_events')).rows[0].count);
    }
  } catch (err) { console.error('[db] read failed', err.message); }
  const body = {
    monitors: (monitors ?? []).filter(forThis).map((m) => ({ id: m.id, name: m.name ?? 'Monitor', category: m.category ?? m.type ?? null,
      description: m.description ?? m.evaluation?.description ?? m.prompt ?? null, enabled: m.enabled ?? m.active ?? true })),
    issues: (issues ?? []).slice(0, 25).map((i) => ({ id: i.id, title: i.title ?? i.name ?? i.monitorName ?? 'Issue', severity: i.severity ?? null,
      status: i.status ?? null, createdAt: i.createdAt ?? null, count: i.count ?? i.callCount ?? null })),
    stored, events: events ?? [],
    webhookPath: '/webhooks/monitor?token=<WEBHOOK_TOKEN>',
  };
  monitoringCache = { at: Date.now(), body };
  send(200, body);
}
