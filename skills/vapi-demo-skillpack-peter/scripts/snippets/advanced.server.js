
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
          simulations: (su.simulationIds ?? []).map((id) => {
            const sm = (simulations ?? []).find((x) => x.id === id);
            return sm ? (sm.name ?? `${scenarioName[sm.scenarioId] ?? 'Scenario'}${sm.personalityId ? ' · ' + (personalityName[sm.personalityId] ?? '') : ''}`) : id;
          }),
        })),
      runs: runs.map((r, i) => ({
        id: r.id, status: r.status, createdAt: r.createdAt, endedAt: r.endedAt ?? null,
        counts: r.itemCounts ?? null,
        items: (runItems[i] ?? []).map((it) => ({
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
      definitions: (evals ?? []).map((e) => ({ id: e.id, name: e.name ?? 'Eval', type: e.type ?? null, description: e.description ?? null })),
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
