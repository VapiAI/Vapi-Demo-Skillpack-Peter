
// ---- Live call stats ------------------------------------------------------------
// Cost + LLM tokens for one call, read from Vapi's call record. The page polls
// this every second during a call; a 1s server-side cache keeps that to at most
// one Vapi request per second per call no matter how many viewers are open.
const statsCache = new Map();
async function callStatsHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const id = new URL(req.url, 'http://x').searchParams.get('id') ?? '';
  if (!key) return send(503, { error: 'not configured' });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send(400, { error: 'bad id' });
  const hit = statsCache.get(id);
  if (hit && Date.now() - hit.at < 1000) return send(200, hit.body);
  try {
    const r = await fetch(`https://api.vapi.ai/call/${id}`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return send(r.status, { error: 'vapi ' + r.status });
    const c = await r.json();
    const b = c.costBreakdown ?? {};
    const body = {
      status: c.status ?? null,
      cost: typeof c.cost === 'number' ? c.cost : (typeof b.total === 'number' ? b.total : null),
      promptTokens: b.llmPromptTokens ?? null,
      completionTokens: b.llmCompletionTokens ?? null,
      startedAt: c.startedAt ?? null,
      endedAt: c.endedAt ?? null,
      endedReason: c.endedReason ?? null,
    };
    statsCache.set(id, { at: Date.now(), body });
    if (statsCache.size > 200) statsCache.delete(statsCache.keys().next().value);
    send(200, body);
  } catch (err) {
    console.error('call-stats fetch failed', err);
    send(502, { error: 'fetch failed' });
  }
}
