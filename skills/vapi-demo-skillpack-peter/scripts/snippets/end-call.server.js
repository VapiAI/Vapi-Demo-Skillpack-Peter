
// ---- End a live call (End call button) ---------------------------------------------
// POST /end-call {callId}: ends a LIVE call of this assistant via its
// monitor.controlUrl ({type:"end-call"}; needs monitorPlan.controlEnabled).
async function endCallHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  let body = '';
  for await (const chunk of req) body += chunk;
  let callId;
  try { ({ callId } = JSON.parse(body || '{}')); } catch { return send(400, { error: 'bad json' }); }
  if (!/^[0-9a-f-]{36}$/i.test(callId ?? '')) return send(400, { error: 'bad call id' });
  try {
    const r = await fetch(`https://api.vapi.ai/call/${callId}`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return send(r.status, { error: 'vapi ' + r.status });
    const c = await r.json();
    if (c.assistantId !== aid) return send(404, { error: 'not this agent\'s call' });
    if (c.status === 'ended') return send(200, { ok: true, already: 'ended' });
    const url = c.monitor?.controlUrl;
    if (!url) return send(409, { error: 'call has no controlUrl (enable assistant monitorPlan.controlEnabled)' });
    const e = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'end-call' }) });
    console.log(`[end-call] ${callId} -> ${e.status}`);
    send(e.ok ? 200 : 502, e.ok ? { ok: true } : { error: 'end-call ' + e.status });
  } catch (err) {
    console.error('[end-call] failed', err);
    send(502, { error: 'end call failed' });
  }
}
