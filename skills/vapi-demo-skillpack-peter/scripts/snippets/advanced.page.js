// ---- Advanced tab (2nd page) ------------------------------------------------------
// In-line tabs under the header: "Live" (the board) and "Advanced"
// (simulations + evaluations for this agent). Read-only; loads on open
// and refreshes every 30s while visible.
let advTimer = null;
const advOpen = new Set(); // expanded rows survive the 30s refresh
let advPersonaOpen = null; // tester personality whose behavior is expanded

// A row: clicking it RUNS the simulation / eval; the caret expands details.
// The row button is only "▶ Run", or "■ Stop" while a run is in progress
// (simulations; evals show "Running…" — Vapi has no eval cancel). Results and
// "View" live only under Recent runs. `status` = latest run state for the item.
const advPending = new Map(); // key -> local "starting…" / error text until the API catches up
function advExpandable(key, title, fillDetail, run, status) {
  const it = advEl('div', 'adv-item row-click' + (advOpen.has(key) ? ' open' : ''));
  const top = advEl('div', 'adv-item-top');
  const caret = advEl('span', 'adv-caret', advOpen.has(key) ? '▾' : '▸');
  caret.title = 'Show details';
  top.appendChild(caret);
  top.appendChild(advEl('span', 'adv-item-n', title));
  const pend = advPending.get(key);
  const running = !!status?.running;
  let pill;
  if (pend) pill = advEl('span', 'adv-run-btn ' + pend.cls, pend.label);
  else if (running && status.runId) {
    pill = advEl('span', 'adv-run-btn stop', '■ Stop');
    pill.title = 'Stop this run';
    pill.addEventListener('click', (ev) => { ev.stopPropagation(); advStop(key, status.runId, status.itemId); });
  } else if (running) pill = advEl('span', 'adv-run-btn busy', 'Running…');
  else pill = advEl('span', 'adv-run-btn', '▶ Run');
  top.appendChild(pill);
  it.appendChild(top);
  const detail = advEl('div', 'adv-detail');
  fillDetail(detail);
  it.appendChild(detail);
  caret.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = !advOpen.has(key);
    if (open) advOpen.add(key); else advOpen.delete(key);
    it.classList.toggle('open', open);
    caret.textContent = open ? '▾' : '▸';
  });
  if (run) top.addEventListener('click', () => { if (!running && !pend) advRun(key, run); });
  return it;
}

async function advStop(key, runId, itemId) {
  advPending.set(key, { label: 'Stopping…', cls: 'busy' });
  advLoadSoon(0);
  try {
    const r = await fetch('/advanced/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, itemId }) });
    const j = await r.json().catch(() => ({}));
    advAutoOpen.delete(key);
    if (!r.ok) advPending.set(key, { label: j.error || 'Stop failed', cls: 'fail' });
  } catch { advPending.set(key, { label: 'Stop failed', cls: 'fail' }); }
  setTimeout(() => { advPending.delete(key); advLoadSoon(0); }, 2500);
}

async function advRun(key, run) {
  if (advPending.get(key)?.cls === 'busy') return;
  advPending.set(key, { label: 'Starting…', cls: 'busy', at: Date.now() });
  advLoadSoon(0);
  try {
    const r = await fetch('/advanced/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { advPending.set(key, { label: j.error || 'Run failed', cls: 'fail' }); setTimeout(() => { advPending.delete(key); advLoadSoon(0); }, 6000); }
    else { advPending.set(key, { label: 'Queued', cls: 'busy', at: Date.now() }); if (!key.startsWith('suite:')) advAutoOpen.add(key); }
  } catch { advPending.set(key, { label: 'Run failed', cls: 'fail' }); }
  advLoadSoon(1500);
}
let advSoon = null;
const advAutoOpen = new Set(); // runs started here: open their view once they finish
function advLoadSoon(ms) { clearTimeout(advSoon); advSoon = setTimeout(advLoad, ms); }

// Latest status per simulation / eval, from the recent runs in the payload.
function advRunState(statusText, passed, ended, runId, itemId) {
  if (!ended) return { running: true, runId: runId ?? null, itemId: itemId ?? null };
  return { done: true, passed };
}
const ADV_DONE = /^(completed|ended|done|passed|failed|canceled|cancelled|error)$/i;
function advEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function advCard(title, subtitle) {
  const card = advEl('section', 'panel adv-card');
  const h = advEl('h2');
  h.innerHTML = '<span class="label"></span>';
  h.querySelector('.label').textContent = title;
  card.appendChild(h);
  const body = advEl('div', 'body');
  if (subtitle) body.appendChild(advEl('div', 'adv-sub', subtitle));
  card.appendChild(body);
  return [card, body];
}
function advRow(box, k, v, cls) {
  const row = advEl('div', 'live-row' + (cls ? ' ' + cls : ''));
  row.appendChild(advEl('span', 'k', k));
  row.appendChild(advEl('span', 'v', v));
  box.appendChild(row);
}
function advEmpty(box, text) { box.appendChild(advEl('div', 'adv-empty', text)); }
function advBadge(passed) {
  if (passed === true) return advEl('span', 'adv-badge pass', 'PASS');
  if (passed === false) return advEl('span', 'adv-badge fail', 'FAIL');
  return advEl('span', 'adv-badge', '—');
}
function advWhen(iso) { return iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }

// Condensed agent settings for the Simulations card: [label, text] lines.
function advAgentSettings(cfg) {
  if (!cfg) return [];
  const j = (...xs) => xs.filter((x) => x != null && x !== '').join(' · ');
  const v = cfg.voice ?? {};
  const out = [
    ['LLM', j(cfg.llm?.provider, cfg.llm?.model)],
    ['Transcriber', j(cfg.transcriber?.provider, cfg.transcriber?.model, cfg.transcriber?.language)],
    ['Voice', j(v.name || (v.voice ? 'Voice ' + v.voice : null), v.provider, v.model)],
  ];
  const sp = cfg.stopSpeaking;
  if (sp) out.push(['Stop speaking', j('Words ' + sp.numWords, 'Voice ' + sp.voiceSeconds + 's', 'Back off ' + sp.backoffSeconds + 's')
    + (sp.isDefault && Object.values(sp.isDefault).every(Boolean) ? ' · defaults' : '')]);
  const ss = cfg.startSpeaking;
  if (ss) out.push(['Start speaking', j('Wait ' + ss.waitSeconds + 's', 'Smart endpointing ' + ss.smartEndpointing, 'Punctuation ' + ss.onPunctuationSeconds + 's',
    'No punctuation ' + ss.onNoPunctuationSeconds + 's', 'Number ' + ss.onNumberSeconds + 's') + (ss.allDefault ? ' · defaults' : '')]);
  return out.filter(([, t]) => t);
}

function advRender(d) {
  const grid = $('advGrid');
  grid.innerHTML = '';
  const sim = d.simulations ?? {};
  const ev = d.evals ?? {};
  // Latest state per simulation id (runs are newest first) and per eval id.
  const simState = {};
  let anyActive = false;
  for (const r of sim.runs ?? []) {
    const runDone = !!r.endedAt || ADV_DONE.test(r.status ?? '');
    if (!runDone) anyActive = true;
    for (const it of r.items ?? []) {
      if (!it.simulationId || simState[it.simulationId]) continue;
      const done = runDone || ADV_DONE.test(it.status ?? '');
      simState[it.simulationId] = advRunState(it.status, it.passed, done, r.id, it.id);
      if (it.callId && done) { const cid = it.callId; simState[it.simulationId].open = () => openCallViewer(cid); }
    }
    for (const sid of r.simulationIds ?? []) if (!simState[sid]) simState[sid] = advRunState(r.status, null, runDone, r.id, null);
  }
  const evalState = {};
  for (const r of ev.runs ?? []) {
    if (!r.evalId || evalState[r.evalId]) continue;
    const done = ADV_DONE.test(r.status ?? '') || r.endedReason != null;
    if (!done) anyActive = true;
    evalState[r.evalId] = advRunState(r.status, r.results.length ? r.results.every((s) => s === 'pass') : null, done);
    if (done) { const rid = r.id; evalState[r.evalId].open = () => openEvalViewer(rid); }
  }
  // Once the API shows a real state for an item, drop the local "Starting…" placeholder.
  for (const k of [...advPending.keys()]) {
    const [kind, id] = k.split(':');
    const st = kind === 'sim' ? simState[id] : kind === 'eval' ? evalState[id] : null;
    const pend = advPending.get(k);
    // Clear "Starting…/Queued" once the new run shows as running (or, for very
    // fast runs, once it has finished — an older finished run doesn't count).
    if (pend.at && st && (st.running || (st.done && Date.now() - pend.at > 8000))) advPending.delete(k);
    else if (advPending.get(k).cls === 'busy') anyActive = true;
  }
  // Auto-open the view for a run started from this page once it finishes.
  for (const k of [...advAutoOpen]) {
    const [kind, id] = k.split(':');
    const st = kind === 'sim' ? simState[id] : kind === 'eval' ? evalState[id] : null;
    if (st?.done && st.open && !advPending.has(k)) { advAutoOpen.delete(k); st.open(); }
  }
  clearInterval(advTimer);
  advTimer = setInterval(advLoad, anyActive ? 5000 : 30000);

  // Simulations card = Simulations API only (/eval/simulation*). Evaluations
  // card = Evals API only (/eval, /eval/run). Legacy "· evaluations" suites
  // (evals once run as voice simulations) are not shown anywhere.
  const isLegacyEvalSuite = (su) => /·\s*evaluations/i.test(su.name);
  const simSuites = (sim.suites ?? []).filter((su) => !isLegacyEvalSuite(su));
  const idsOf = (suites) => new Set(suites.flatMap((su) => su.simulations.map((x) => x.id)));

  function suiteBlock(box, su, label, detailFor) {
    const head = advEl('div', 'adv-suite-head');
    head.appendChild(advEl('span', 'prompt-k adv-k', label));
    const pendSuite = advPending.get('suite:' + su.id);
    const all = advEl('span', 'adv-run-btn' + (pendSuite ? ' ' + pendSuite.cls : ''), pendSuite ? pendSuite.label : '▶ Run all');
    all.addEventListener('click', () => advRun('suite:' + su.id, { kind: 'suite', id: su.id }));
    head.appendChild(all);
    box.appendChild(head);
    for (const sm of su.simulations) {
      box.appendChild(advExpandable('sim:' + sm.id, detailFor.title(sm), (d) => detailFor.fill(d, sm), { kind: 'simulation', id: sm.id }, simState[sm.id]));
    }
  }
  function runsBlock(box, ids, emptyText) {
    box.appendChild(advEl('div', 'prompt-k adv-k', 'Recent runs'));
    let shown = 0;
    for (const r of sim.runs ?? []) {
      const items = (r.items ?? []).filter((it) => ids.has(it.simulationId));
      const queuedHere = (r.simulationIds ?? []).some((x) => ids.has(x));
      if (!items.length && !queuedHere) continue;
      shown++;
      const head = advEl('div', 'adv-run');
      const passed = items.filter((it) => it.passed === true).length;
      const failed = items.filter((it) => it.passed === false).length;
      head.appendChild(advEl('span', 'adv-run-t', advWhen(r.createdAt) + ' · ' + (r.status ?? '')));
      head.appendChild(advEl('span', 'adv-run-c', passed + ' passed · ' + failed + ' failed · ' + (items.length || (r.counts?.total ?? 0)) + ' total'));
      box.appendChild(head);
      for (const it of items) {
        const item = advEl('div', 'adv-item');
        const top = advEl('div', 'adv-item-top');
        top.appendChild(advBadge(it.passed));
        top.appendChild(advEl('span', 'adv-item-n', it.scenario.replace(/^Eval · /, '') + (it.personality && !/^Eval · /.test(it.scenario) ? ' · ' + it.personality : '')));
        if (it.callId) {
          const v = advEl('span', 'adv-run-btn', '▶ View');
          v.addEventListener('click', () => openCallViewer(it.callId));
          top.appendChild(v);
        }
        item.appendChild(top);
        for (const e of it.evaluations ?? []) {
          const line = advEl('div', 'adv-eval');
          line.appendChild(advBadge(e.passed));
          line.appendChild(advEl('span', null, e.name + (e.reasoning ? ' — ' + e.reasoning : '')));
          item.appendChild(line);
        }
        if (it.failureReason) item.appendChild(advEl('div', 'adv-sub', 'Failure: ' + it.failureReason));
        for (const sg of it.suggestions ?? []) if (sg) item.appendChild(advEl('div', 'adv-sugg', '💡 ' + sg));
        box.appendChild(item);
      }
    }
    if (!shown) advEmpty(box, emptyText);
  }
  const checksFill = (d, sm, intro) => {
    if (intro) intro(d);
    if (sm.checks.length) d.appendChild(advEl('div', 'prompt-k adv-k', 'Pass checks'));
    for (const c of sm.checks) {
      const line = advEl('div', 'adv-eval');
      line.appendChild(advEl('span', 'adv-badge', c.required ? 'REQUIRED' : 'INFO'));
      line.appendChild(advEl('span', null, c.name + (c.description ? ' — ' + c.description : '')));
      d.appendChild(line);
    }
  };

  // 1. Simulations (voice)
  const [simCard, sb] = advCard('Simulations');
  // Simulator Settings (top of the card): what the AI caller sounds like, read
  // from the latest simulation.
  sb.appendChild(advEl('div', 'prompt-k adv-k adv-k-first', 'Simulator Settings'));
  const sv = sim.simulatorVoice;
  advRow(sb, 'Simulator voice', sv ? sv.name + ' · ' + sv.provider + (sv.model ? ' · ' + sv.model : '') : 'Vapi default (no simulation run yet)');
  if (sv?.description) sb.appendChild(advEl('div', 'adv-sub', sv.description));
  // Agent settings, condensed to text (same live data as the Config setup panel).
  sb.appendChild(advEl('div', 'prompt-k adv-k', 'Agent settings'));
  const cfgBox = advEl('div', 'adv-cfg');
  const cfgLines = advAgentSettings(typeof agentCfg !== 'undefined' ? agentCfg : null);
  if (!cfgLines.length) cfgBox.textContent = 'Loading…';
  for (const [k, v] of cfgLines) {
    const line = advEl('div');
    line.appendChild(advEl('b', null, k + ' '));
    line.appendChild(document.createTextNode(v));
    cfgBox.appendChild(line);
  }
  sb.appendChild(cfgBox);
  advRow(sb, 'Scenarios', String(simSuites.reduce((n, su) => n + su.simulations.length, 0)));
  const chips = advEl('div', 'adv-chips');
  // Click a personality to expand its behavior (the tester's instructions);
  // click again to collapse. The open one survives the 30 s refresh.
  const pDetails = new Map((sim.personalityDetails ?? []).map((x) => [x.name, x]));
  const pBox = advEl('div', 'adv-persona');
  const pShow = () => {
    pBox.innerHTML = '';
    const d = pDetails.get(advPersonaOpen);
    pBox.hidden = !d;
    chips.querySelectorAll('.adv-chip').forEach((c) => c.classList.toggle('on', c.textContent === advPersonaOpen));
    if (!d) return;
    const head = advEl('div', 'adv-persona-h');
    head.appendChild(advEl('b', null, d.name));
    head.appendChild(document.createTextNode(' · Behavior' + (d.model ? ' · ' + d.model : '') + (d.builtIn ? ' · built-in' : '')));
    pBox.appendChild(head);
    pBox.appendChild(advEl('div', 'adv-quote', d.behavior || 'No behavior text on this personality.'));
  };
  for (const p of sim.personalities ?? []) {
    const chip = advEl('span', 'adv-chip adv-chip-click', p);
    chip.title = 'Show behavior';
    chip.addEventListener('click', () => { advPersonaOpen = advPersonaOpen === p ? null : p; pShow(); });
    chips.appendChild(chip);
  }
  if ((sim.personalities ?? []).length) { sb.appendChild(advEl('div', 'prompt-k adv-k', 'Tester personalities')); sb.appendChild(chips); sb.appendChild(pBox); pShow(); }
  for (const su of simSuites) {
    suiteBlock(sb, su, 'Suite · ' + su.name + ' · voice', {
      title: (sm) => sm.name,
      fill: (d, sm) => checksFill(d, sm, (dd) => {
        if (sm.personality) advRow(dd, 'Tester personality', sm.personality);
        if (sm.instructions) { dd.appendChild(advEl('div', 'prompt-k adv-k', 'What the AI caller does')); dd.appendChild(advEl('div', 'adv-quote', sm.instructions)); }
      }),
    });
  }
  if (!simSuites.length) advEmpty(sb, 'No simulation suite is assigned to this agent yet.');
  runsBlock(sb, idsOf(simSuites), 'No simulation runs for this agent yet.');
  grid.appendChild(simCard);

  // 2. Evaluations: Vapi Evals API only. Definitions from GET /eval, runs from
  // GET /eval/run, started with POST /eval/run — never a simulation.
  const [evCard, eb] = advCard('Evaluations', 'Vapi Evals API: a scripted conversation is sent to the agent and an LLM judge scores its reply against a pass criterion. Click an eval to run it.');
  advRow(eb, 'Evaluations', String((ev.definitions ?? []).length));
  if (!(ev.definitions ?? []).length) advEmpty(eb, 'No evaluations defined yet.');
  for (const e of ev.definitions ?? []) {
    eb.appendChild(advExpandable('eval:' + e.id, e.name, (d) => {
      if (e.description) d.appendChild(advEl('div', 'adv-sub', e.description));
      if ((e.turns ?? []).length) d.appendChild(advEl('div', 'prompt-k adv-k', 'Caller says'));
      for (const t of e.turns ?? []) d.appendChild(advEl('div', 'adv-quote', '“' + t + '”'));
      if (e.criterion) { d.appendChild(advEl('div', 'prompt-k adv-k', 'Passes when')); d.appendChild(advEl('div', 'adv-quote', e.criterion)); }
    }, { kind: 'eval', id: e.id }, evalState[e.id]));
  }
  eb.appendChild(advEl('div', 'prompt-k adv-k', 'Recent eval runs'));
  if (!(ev.runs ?? []).length) advEmpty(eb, 'No eval runs for this agent yet.');
  for (const r of ev.runs ?? []) {
    const pass = r.results.length ? r.results.every((x) => x === 'pass') : null;
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advBadge(pass));
    top.appendChild(advEl('span', 'adv-item-n', (r.name ?? (ev.definitions ?? []).find((x) => x.id === r.evalId)?.name ?? 'Eval run') + ' · ' + advWhen(r.createdAt)));
    const v = advEl('span', 'adv-run-btn', '▶ View');
    v.addEventListener('click', () => openEvalViewer(r.id));
    top.appendChild(v);
    it.appendChild(top);
    it.appendChild(advEl('div', 'adv-sub', r.status + (r.endedReason ? ' · ' + r.endedReason : '') + (r.cost != null ? ' · $' + Number(r.cost).toFixed(4) : '')));
    eb.appendChild(it);
  }
  grid.appendChild(evCard);

}

// Structured outputs: what the platform extracts from every call for this
// agent, with the value it pulled from the most recent call.
function advRenderSO(d, grid) {
  const so = d.structuredOutputs ?? {};
  const [card, b] = advCard('Structured outputs', 'Data Vapi extracts from every call after it ends: definitions linked to this agent, with the value from the latest call.');
  advRow(b, 'Linked outputs', String((so.items ?? []).length));
  if (so.lastCallId) advRow(b, 'Latest call', advWhen(so.lastCallAt) + ' · ' + so.lastCallId.slice(0, 8));
  if (!(so.items ?? []).length) advEmpty(b, 'No structured outputs are linked to this agent yet.');
  for (const it of so.items ?? []) {
    const item = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'adv-badge', (it.schemaType ?? 'value').toUpperCase()));
    top.appendChild(advEl('span', 'adv-item-n', it.name));
    item.appendChild(top);
    if (it.description) item.appendChild(advEl('div', 'adv-sub', it.description));
    if (it.fields.length) item.appendChild(advEl('div', 'adv-sub', 'Fields: ' + it.fields.join(', ')));
    item.appendChild(advEl('div', 'adv-so-val', it.lastValue != null ? 'Latest: ' + it.lastValue : 'Latest: — (not extracted on the last call)'));
    b.appendChild(item);
  }
  grid.appendChild(card);
}

async function advLoad() {
  const grid = $('advGrid');
  if (!grid.children.length) grid.appendChild(advEl('div', 'adv-empty', 'Loading…'));
  try {
    const r = await fetch('/advanced');
    if (!r.ok) throw new Error('advanced ' + r.status);
    const data = await r.json();
    advRender(data);
    advRenderSO(data, $('advGrid'));
  } catch (err) {
    console.error('advanced load failed', err);
    grid.innerHTML = '';
    grid.appendChild(advEl('div', 'adv-empty', 'Could not load advanced data.'));
  }
}

function tabShow(name) {
  document.querySelector('main').hidden = name !== 'live';
  $('advanced').hidden = name !== 'advanced';
  if ($('logs')) $('logs').hidden = name !== 'logs';
  if ($('toolskb')) $('toolskb').hidden = name !== 'toolskb';
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  clearInterval(advTimer);
  if (typeof logsTimer !== 'undefined') clearInterval(logsTimer);
  if (typeof tkbTimer !== 'undefined') clearInterval(tkbTimer);
  if (name === 'advanced') { advLoad(); advTimer = setInterval(advLoad, 30000); }
  if (name === 'logs') { logsLoad(); logsTimer = setInterval(logsLoad, 30000); }
  if (name === 'toolskb' && typeof tkbLoad === 'function') { tkbLoad(); tkbTimer = setInterval(tkbLoad, 30000); }
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => tabShow(b.dataset.tab)));

