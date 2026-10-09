
// ---- Tools & Knowledge Base tab -----------------------------------------------
// Every tool ACTIVE on the assistant (saved tools from model.toolIds + inline
// model.tools, built-ins included), whether or not a call has used it yet, plus
// the knowledge-base files behind any query tool and how often each tool was
// called in recent REAL calls. Read live from Vapi, cached 30s.
let toolsKbCache = null;
async function toolsKbHandler(res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  if (toolsKbCache && Date.now() - toolsKbCache.at < 30000) return send(200, toolsKbCache.body);
  const get = async (path) => {
    const r = await fetch('https://api.vapi.ai' + path, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error('vapi ' + r.status + ' ' + path);
    return r.json();
  };
  const BUILTIN = {
    endCall: ['end_call', 'Built-in: lets the agent hang up when the conversation is done.'],
    transferCall: ['transfer_call', 'Built-in: transfers the caller to another number or assistant.'],
    dtmf: ['dtmf', 'Built-in: presses keypad digits (IVR navigation).'],
    voicemail: ['voicemail', 'Built-in: detects voicemail and leaves a message.'],
    handoff: ['handoff', 'Built-in: hands the call to another assistant.'],
  };
  try {
    const a = await get(`/assistant/${aid}`);
    const saved = await Promise.all((a.model?.toolIds ?? []).map((id) => get(`/tool/${id}`).catch(() => ({ id, type: 'unknown', function: { name: id } }))));
    const all = [...saved, ...(a.model?.tools ?? [])];
    // Usage across recent real calls, counted per tool name.
    const usage = {};
    try {
      const calls = (await get(`/call?assistantId=${aid}&limit=50`) ?? []).filter((c) => !isTestCall(c)).slice(0, 25);
      for (const c of calls) {
        for (const m of c.artifact?.messages ?? c.messages ?? []) {
          for (const tc of m.toolCalls ?? []) {
            const n = tc.function?.name; if (!n) continue;
            const u = usage[n] ??= { count: 0, lastAt: null };
            u.count++; if (!u.lastAt || c.createdAt > u.lastAt) u.lastAt = c.createdAt;
          }
        }
      }
      usage.__calls = calls.length;
    } catch { usage.__calls = null; }
    const fileIds = new Set();
    const tools = all.map((t) => {
      const kbs = (t.knowledgeBases ?? []).map((k) => {
        (k.fileIds ?? []).forEach((f) => fileIds.add(f));
        return { name: k.name, provider: k.provider, description: k.description ?? '', fileIds: k.fileIds ?? [] };
      });
      const props = t.function?.parameters?.properties ?? {};
      const req = new Set(t.function?.parameters?.required ?? []);
      let server = null;
      try { if (t.server?.url) { const u = new URL(t.server.url); server = u.host + u.pathname; } } catch {}
      const name = t.function?.name ?? BUILTIN[t.type]?.[0] ?? t.type;
      const destinations = (t.destinations ?? []).map((d) => d.number ?? d.assistantName ?? d.sipUri ?? d.type).filter(Boolean);
      return {
        id: t.id ?? null, type: t.type, name, source: t.id ? 'saved tool' : 'inline',
        description: t.function?.description ?? BUILTIN[t.type]?.[1] ?? '',
        params: Object.entries(props).map(([n, p]) => ({ name: n, type: p.type ?? '', enum: p.enum ?? null, description: p.description ?? '', required: req.has(n) })),
        server, destinations, knowledgeBases: kbs, async: !!t.async,
        usage: usage[name] ?? usage[t.type] ?? { count: 0, lastAt: null },
      };
    });
    const files = await Promise.all([...fileIds].map((id) => get(`/file/${id}`).then((f) => ({
      id: f.id, name: f.name ?? f.originalName, bytes: Number(f.bytes ?? 0) || null, status: f.status ?? null,
    })).catch(() => ({ id, name: id, bytes: null, status: 'unavailable' }))));
    // Optional hook: a demo that serves its own documents (e.g. a background
    // search on this server) exports localKnowledgeBase() -> {tool, name,
    // provider, description, files:[{id,name,bytes,status}]}.
    if (typeof localKnowledgeBase === 'function') {
      const lk = localKnowledgeBase();
      const t = tools.find((x) => x.name === lk.tool);
      if (t) {
        t.knowledgeBases.push({ name: lk.name, provider: lk.provider, description: lk.description ?? '', fileIds: lk.files.map((f) => f.id) });
        files.push(...lk.files);
      }
    }
    const body = { assistant: a.name ?? null, tools, files, recentCalls: usage.__calls };
    toolsKbCache = { at: Date.now(), body };
    return send(200, body);
  } catch (err) {
    console.error('[tools-kb]', err.message);
    return send(502, { error: 'vapi lookup failed' });
  }
}
