
// ---- Call viewer ---------------------------------------------------------------
// GET /call-detail?id=   one call (live, logged or simulation) as a timeline:
//                        speech segments per speaker, tool-call marks, transcript.
// GET /recording?id=     302 to a short-lived signed URL for the mono recording
//                        (Vapi's /call/{id}/mono-recording), so the key never
//                        reaches the browser.
// GET /eval-run-detail?id=  one eval run's scripted conversation + verdict.
// All three only serve calls/runs that target THIS assistant.
// Speaker lanes from the AUDIO, not transcript timings: transcript message
// durations can end seconds early (verified: a caller still talking for 4 s
// after their message "ended" showed as silence). Reads the stereo recording
// (left = caller, right = assistant), 50 ms RMS windows; pauses under 0.7 s count as the same speech.
// Cached per call; skipped for recordings over ~60 MB.
const laneCache = new Map();
async function audioLanes(c) {
  if (laneCache.has(c.id)) return laneCache.get(c.id);
  const a = c.artifact ?? {};
  const url = a.presignedStereoUrl ?? a.stereoRecordingUrl ?? a.recording?.stereoUrl ?? null;
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok || Number(r.headers.get('content-length') ?? 0) > 60e6) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let off = 12, fmt = null, data = null;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
      if (id === 'data') { data = [off + 8, Math.min(buf.length, off + 8 + size)]; break; }
      off += 8 + size + (size % 2);
    }
    if (!fmt || !data || fmt.ch !== 2 || fmt.bits !== 16) return null;
    const win = Math.round(fmt.sr * 0.05), frame = 4, step = 4;
    const frames = Math.floor((data[1] - data[0]) / frame);
    const lanes = { user: [], assistant: [] };
    for (const [ch, role] of [[0, 'user'], [1, 'assistant']]) {
      let on = null, lastLoud = -1;
      for (let w = 0; w * win < frames; w++) {
        let sum = 0, n = 0;
        for (let f = w * win; f < Math.min(frames, (w + 1) * win); f += step) { const v = buf.readInt16LE(data[0] + f * frame + ch * 2); sum += v * v; n++; }
        const t = (w * win) / fmt.sr, loud = n && Math.sqrt(sum / n) > 350;
        if (loud) { if (on == null) on = t; lastLoud = t + 0.05; }
        else if (on != null && t - lastLoud > 0.7) { if (lastLoud - on >= 0.15) lanes[role].push([on, lastLoud - on]); on = null; }
      }
      if (on != null && lastLoud - on >= 0.15) lanes[role].push([on, lastLoud - on]);
    }
    laneCache.set(c.id, lanes);
    if (laneCache.size > 50) laneCache.delete(laneCache.keys().next().value);
    return lanes;
  } catch (err) { console.error('[call-viewer] audio lanes failed', err.message); return null; }
}

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
      lanes: await audioLanes(c),  // null -> the page falls back to transcript timings
    });
  } catch (err) {
    console.error('call viewer failed', err);
    send(502, { error: 'fetch failed' });
  }
}
