
// ---- Advanced tab ---------------------------------------------------------------
// One aggregate for the "Advanced" page: Vapi Simulations (scenarios x
// personalities, runs + per-item results) and Evals (+ runs) targeting this
// assistant. Read-only; nothing
// here creates or runs anything. Cached 15s so tab flips don't hammer the API.
let advancedCache = null;
async function advancedHandler(res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  if (advancedCache && Date.now() - advancedCache.at < 15000) return send(200, advancedCache.body);
  const get = async (path) => {
    try {
      const r = await fetch('https://api.vapi.ai' + path, { headers: { authorization: `Bearer ${key}` } });
      if (!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j) ? j : (j?.results ?? j);
    } catch { return null; }
  };
  const forThis = (t) => t && (t.assistantId === aid || t.assistant?.id === aid);
  const [scenarios, simulations, personalities, runsAll, evals, evalRunsAll, suitesAll, soAll, lastCalls] = await Promise.all([
    get('/eval/simulation/scenario?limit=100'), get('/eval/simulation?limit=100'),
    get('/eval/simulation/personality?limit=100'), get('/eval/simulation/run?limit=25'),
    get('/eval?limit=100'), get('/eval/run?limit=25'), get('/eval/simulation/suite?limit=100'),
    get('/structured-output?limit=100'), get(`/call?assistantId=${aid}&limit=1`),
  ]);
  const runs = (runsAll ?? []).filter((r) => forThis(r.target)).slice(0, 5);
  const runItems = await Promise.all(runs.map((r) => get(`/eval/simulation/run/${r.id}/item?limit=50`)));
  const scenarioName = Object.fromEntries((scenarios ?? []).map((s) => [s.id, s.name]));
  const personalityName = Object.fromEntries((personalities ?? []).map((p) => [p.id, p.name]));
  // Structured outputs linked to this assistant, each with the value extracted
  // on the most recent call (artifact.structuredOutputs is keyed by output id).
  const lastCall = (lastCalls ?? [])[0] ?? null;
  const soResults = lastCall?.artifact?.structuredOutputs ?? {};
  const fmtVal = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const structuredOutputs = {
    lastCallId: lastCall?.id ?? null,
    lastCallAt: lastCall?.endedAt ?? lastCall?.createdAt ?? null,
    items: (soAll ?? []).filter((so) => (so.assistantIds ?? []).includes(aid)).map((so) => ({
      id: so.id, name: so.name, type: so.type ?? 'ai', description: so.description ?? so.schema?.description ?? null,
      schemaType: so.schema?.type ?? null,
      fields: so.schema?.type === 'object' ? Object.keys(so.schema?.properties ?? {}) : [],
      lastValue: soResults[so.id] ? fmtVal(soResults[so.id].result) : null,
    })),
  };
  const body = {
    structuredOutputs,
    simulations: {
      scenarioCount: (scenarios ?? []).length,
      simulationCount: (simulations ?? []).length,
      personalities: (personalities ?? []).map((p) => p.name),
      // Suites assigned to this assistant, with their simulations by name.
      suites: (suitesAll ?? [])
        .filter((su) => (su.targetAssignments ?? []).some((t) => t.targetId === aid))
        .map((su) => ({
          id: su.id, name: su.name,
          // Full detail per simulation, so the page can expand a row on click.
          simulations: (su.simulationIds ?? []).map((id) => {
            const sm = (simulations ?? []).find((x) => x.id === id);
            if (!sm) return { id, name: id, personality: null, instructions: null, checks: [] };
            const sc = (scenarios ?? []).find((x) => x.id === sm.scenarioId) ?? {};
            return {
              id,
              name: sm.name ?? `${sc.name ?? 'Scenario'}${sm.personalityId ? ' · ' + (personalityName[sm.personalityId] ?? '') : ''}`,
              scenario: sc.name ?? null,
              personality: personalityName[sm.personalityId] ?? null,
              instructions: sc.instructions ?? null,
              checks: (sc.evaluations ?? []).map((e) => ({
                name: e.structuredOutput?.name ?? e.structuredOutputId ?? 'check',
                description: e.structuredOutput?.schema?.description ?? e.structuredOutput?.description ?? null,
                expect: `${e.comparator ?? '='} ${JSON.stringify(e.value)}`,
                required: e.required !== false,
              })),
            };
          }),
        })),
      runs: runs.map((r, i) => ({
        id: r.id, status: r.status, createdAt: r.createdAt, endedAt: r.endedAt ?? null,
        simulationIds: (r.simulations ?? []).map((s) => s.simulationId).filter(Boolean),
        counts: r.itemCounts ?? null,
        items: (runItems[i] ?? []).map((it) => ({
          simulationId: it.simulationId ?? null,
          callId: it.callId ?? null,
          status: it.status,
          scenario: it.metadata?.scenario?.name ?? scenarioName[it.scenarioId] ?? 'Scenario',
          personality: it.metadata?.personality?.name ?? personalityName[it.personalityId] ?? null,
          passed: it.results?.passed ?? null,
          evaluations: (it.results?.evaluations ?? []).map((e) => ({
            name: e.name ?? e.structuredOutput?.name ?? e.structuredOutputId ?? 'Evaluation',
            passed: e.passed ?? (typeof e.result === 'boolean' ? e.result : null),
            result: typeof e.result === 'object' ? JSON.stringify(e.result) : (e.result ?? null),
            reasoning: e.reasoning ?? e.message ?? null,
          })),
          suggestions: (it.improvementSuggestions?.systemPromptSuggestions ?? it.improvementSuggestions ?? [])
            .slice?.(0, 3)?.map((s) => (typeof s === 'string' ? s : s.suggestion ?? s.issue)) ?? [],
          failureReason: it.failureReason ?? null,
        })),
      })),
    },
    evals: {
      definitions: (evals ?? []).map((e) => ({
        id: e.id, name: e.name ?? 'Eval', type: e.type ?? null, description: e.description ?? null,
        // The scripted caller turns, and the judge's pass criterion (from the
        // LLM-judge system prompt; falls back to regex/exact content).
        turns: (e.messages ?? []).filter((m) => m.role === 'user' && m.content).map((m) => m.content),
        criterion: (() => {
          const j = (e.messages ?? []).find((m) => m.judgePlan)?.judgePlan;
          if (!j) return null;
          if (j.type === 'ai') {
            const sys = (j.model?.messages ?? []).find((m) => m.role === 'system')?.content ?? '';
            const m = sys.match(/Criterion:\s*([\s\S]*?)(?:\n\s*\n|$)/);
            return (m ? m[1] : sys).trim() || null;
          }
          return `${j.type} match: ${j.content ?? ''}`;
        })(),
      })),
      runs: (evalRunsAll ?? []).filter((r) => forThis(r.target)).slice(0, 10).map((r) => ({
        id: r.id, status: r.status, name: r.eval?.name ?? null, evalId: r.evalId ?? null, createdAt: r.createdAt,
        cost: r.cost ?? null, endedReason: r.endedReason ?? null,
        results: (r.results ?? []).map((x) => x.status),
      })),
    },
  };
  advancedCache = { at: Date.now(), body };
  send(200, body);
}

// ---- Run a simulation / suite / eval from the Advanced tab ------------------
// POST /advanced/run {kind: 'simulation'|'suite'|'eval', id}. Only ids that
// belong to THIS assistant's suite (or this org's evals) are accepted, and the
// page is public, so runs are rate-limited: 60s cooldown per item, 20/hour total.
const runGuard = { last: new Map(), hour: [] };
async function advancedRunHandler(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const aid = process.env.ASSISTANT_ID;
  if (!key || !aid) return send(503, { error: 'not configured' });
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2000) return send(413, { error: 'too large' }); }
  let kind, id;
  try { ({ kind, id } = JSON.parse(body || '{}')); } catch { return send(400, { error: 'bad json' }); }
  if (!['simulation', 'suite', 'eval'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return send(400, { error: 'bad request' });
  const now = Date.now();
  runGuard.hour = runGuard.hour.filter((t) => now - t < 3600000);
  if (runGuard.hour.length >= 20) return send(429, { error: 'Run limit reached (20 per hour). Try again later.' });
  const lastAt = runGuard.last.get(kind + ':' + id) ?? 0;
  if (now - lastAt < 60000) return send(429, { error: `Already started — wait ${Math.ceil((60000 - (now - lastAt)) / 1000)}s before re-running.` });
  const vapi = async (method, path, payload) => {
    const r = await fetch('https://api.vapi.ai' + path, {
      method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j?.message ? [].concat(j.message).join('; ') : 'vapi ' + r.status), { status: r.status });
    return Array.isArray(j) ? j : (j?.results ?? j);
  };
  try {
    // Ownership check: the id must be part of this agent's assigned suite(s) / the org's evals.
    if (kind === 'eval') {
      const evals = await vapi('GET', '/eval?limit=100');
      if (!(evals ?? []).some((e) => e.id === id)) return send(404, { error: 'unknown eval' });
    } else {
      const suites = (await vapi('GET', '/eval/simulation/suite?limit=100') ?? [])
        .filter((su) => (su.targetAssignments ?? []).some((t) => t.targetId === aid));
      const ok = kind === 'suite' ? suites.some((su) => su.id === id) : suites.some((su) => (su.simulationIds ?? []).includes(id));
      if (!ok) return send(404, { error: 'not part of this agent\'s suite' });
    }
    const run = kind === 'eval'
      ? await vapi('POST', '/eval/run', { type: 'eval', evalId: id, target: { type: 'assistant', assistantId: aid } })
      : await vapi('POST', '/eval/simulation/run', {
          simulations: [kind === 'suite' ? { type: 'simulationSuite', simulationSuiteId: id } : { type: 'simulation', simulationId: id }],
          target: { type: 'assistant', assistantId: aid },
          transport: { provider: 'vapi.websocket' }, // VOICE simulations by default (not vapi.webchat)
        });
    runGuard.last.set(kind + ':' + id, now);
    runGuard.hour.push(now);
    advancedCache = null; // next /advanced read shows the new run
    send(200, { ok: true, runId: run?.id ?? run?.workflowId ?? null, status: run?.status ?? 'queued' });
  } catch (err) {
    console.error('advanced run failed', err);
    send(err.status === 402 ? 402 : 502, { error: err.message || 'run failed' });
  }
}
