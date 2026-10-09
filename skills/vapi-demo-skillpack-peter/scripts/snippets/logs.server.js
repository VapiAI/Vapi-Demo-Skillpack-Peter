
// ---- Logs tab -------------------------------------------------------------------
// Call log for this assistant (newest first): GET /logs lists recent calls,
// GET /logs?id=<callId> returns one call's turn-by-turn transcript (speech +
// inline tool calls, via historyTurns). Read-only; list cached 10s.
let logsCache = null;
async function logsHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const get = async (path) => {
    const r = await fetch('https://api.vapi.ai' + path, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error('vapi ' + r.status);
    return r.json();
  };
  try {
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return send(400, { error: 'bad id' });
      const c = await get(`/call/${id}`);
      if (c.assistantId && c.assistantId !== aid) return send(404, { error: 'not this assistant' });
      return send(200, { id: c.id, turns: historyTurns(c.artifact?.messages ?? c.messages ?? []) });
    }
    if (logsCache && Date.now() - logsCache.at < 10000) return send(200, logsCache.body);
    const so = await get('/structured-output?limit=100').catch(() => ({}));
    const soName = Object.fromEntries((so.results ?? so ?? []).map?.((s) => [s.id, s.name]) ?? []);
    const calls = await get(`/call?assistantId=${aid}&limit=25`);
    const body = {
      calls: (calls ?? []).map((c) => {
        const msgs = c.artifact?.messages ?? c.messages ?? [];
        const start = c.startedAt ? Date.parse(c.startedAt) : null;
        const end = c.endedAt ? Date.parse(c.endedAt) : null;
        return {
          id: c.id, createdAt: c.createdAt, status: c.status, type: c.type ?? null,
          endedReason: c.endedReason ?? null,
          durationSec: start && end ? Math.round((end - start) / 1000) : null,
          cost: typeof c.cost === 'number' ? c.cost : null,
          turns: msgs.filter((m) => (m.role === 'bot' || m.role === 'user') && m.message).length,
          toolCalls: msgs.reduce((n, m) => n + (m.toolCalls ?? m.tool_calls ?? []).length, 0),
          firstCaller: (msgs.find((m) => m.role === 'user' && m.message) ?? {}).message ?? null,
          outputs: Object.entries(c.artifact?.structuredOutputs ?? {}).map(([sid, v]) => ({
            name: v?.name ?? soName[sid] ?? sid.slice(0, 8),
            value: v?.result == null ? null : typeof v.result === 'object' ? JSON.stringify(v.result) : String(v.result),
          })),
        };
      }),
    };
    logsCache = { at: Date.now(), body };
    send(200, body);
  } catch (err) {
    console.error('logs fetch failed', err);
    send(502, { error: 'fetch failed' });
  }
}
