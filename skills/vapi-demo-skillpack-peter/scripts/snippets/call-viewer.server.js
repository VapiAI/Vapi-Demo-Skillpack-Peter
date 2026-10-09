
// ---- Call viewer ---------------------------------------------------------------
// GET /call-detail?id=   one call (live, logged or simulation) as a timeline:
//                        speech segments per speaker, tool-call marks, transcript.
// GET /recording?id=     302 to a short-lived signed URL for the mono recording
//                        (Vapi's /call/{id}/mono-recording), so the key never
//                        reaches the browser.
// GET /eval-run-detail?id=  one eval run's scripted conversation + verdict.
// All three only serve calls/runs that target THIS assistant.
async function callViewerHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id') ?? '';
  const auth = { authorization: `Bearer ${key}` };
  try {
    if (url.pathname === '/eval-run-detail') {
      if (!/^[\w.-]{8,200}$/.test(id)) return send(400, { error: 'bad id' });
      const r = await fetch(`https://api.vapi.ai/eval/run/${encodeURIComponent(id)}`, { headers: auth });
      if (!r.ok) return send(r.status, { error: 'vapi ' + r.status });
      const run = await r.json();
      if (run.target?.assistantId && run.target.assistantId !== aid) return send(404, { error: 'not this assistant' });
      let evalName = run.eval?.name ?? null;
      if (!evalName && run.evalId) {
        const e = await fetch(`https://api.vapi.ai/eval/${run.evalId}`, { headers: auth }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        evalName = e?.name ?? null;
      }
      return send(200, {
        id: run.id, kind: 'eval', name: evalName, status: run.status, endedReason: run.endedReason ?? null,
        createdAt: run.createdAt, startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null, cost: run.cost ?? null,
        results: (run.results ?? []).map((x) => ({
          status: x.status,
          messages: (x.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') })),
        })),
      });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return send(400, { error: 'bad id' });
    const r = await fetch(`https://api.vapi.ai/call/${id}`, { headers: auth });
    if (!r.ok) return send(r.status, { error: 'vapi ' + r.status });
    const c = await r.json();
    if (c.assistantId && c.assistantId !== aid) return send(404, { error: 'not this assistant' });
    if (url.pathname === '/recording') {
      const rec = await fetch(`https://api.vapi.ai/call/${id}/mono-recording`, { headers: auth, redirect: 'manual' });
      const loc = rec.headers.get('location');
      if (!loc) return send(404, { error: 'no recording' });
      res.writeHead(302, { location: loc, 'cache-control': 'no-store' });
      return res.end();
    }
    const msgs = [c.artifact?.messages, c.messages].find(Array.isArray) ?? [];
    const t0 = c.startedAt ? Date.parse(c.startedAt) : null;
    const t1 = c.endedAt ? Date.parse(c.endedAt) : null;
    const segments = [];
    const tools = [];
    for (const m of msgs) {
      const at = typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null;
      if (at == null) continue;
      if ((m.role === 'bot' || m.role === 'user') && m.message) {
        segments.push({ role: m.role === 'bot' ? 'assistant' : 'user', start: at, dur: Math.max(0.2, (m.duration ?? 0) / 1000), text: m.message });
      }
      for (const tc of m.toolCalls ?? m.tool_calls ?? []) tools.push({ at, name: tc.function?.name ?? tc.type ?? 'tool' });
    }
    const lastEnd = segments.reduce((mx, s) => Math.max(mx, s.start + s.dur), 0);
    send(200, {
      id: c.id, kind: 'call', type: c.type ?? null, createdAt: c.createdAt, startedAt: c.startedAt ?? null,
      endedReason: c.endedReason ?? null, cost: typeof c.cost === 'number' ? c.cost : null,
      assistantId: c.assistantId ?? aid, assistantName: c.assistant?.name ?? null,
      duration: t0 && t1 ? (t1 - t0) / 1000 : lastEnd,
      hasRecording: !!(c.artifact?.recording?.mono?.combinedUrl || c.artifact?.recordingUrl || c.recordingUrl),
      segments, tools,
    });
  } catch (err) {
    console.error('call viewer failed', err);
    send(502, { error: 'fetch failed' });
  }
}
