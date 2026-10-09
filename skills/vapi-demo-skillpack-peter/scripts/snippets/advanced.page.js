// ---- Advanced tab (2nd page) ------------------------------------------------------
// In-line tabs under the header: "Live" (the board) and "Advanced"
// (simulations + evaluations for this agent). Read-only; loads on open
// and refreshes every 30s while visible.
let advTimer = null;
const advOpen = new Set(); // expanded rows survive the 30s refresh

// A row: clicking it RUNS the simulation / eval; the caret expands details.
// `status` is the latest run state for this item: {label, cls}.
const advPending = new Map(); // key -> local "starting…" / error text until the API catches up
function advExpandable(key, title, fillDetail, run, status) {
  const it = advEl('div', 'adv-item adv-click' + (advOpen.has(key) ? ' open' : ''));
  const top = advEl('div', 'adv-item-top');
  const caret = advEl('span', 'adv-caret', advOpen.has(key) ? '▾' : '▸');
  caret.title = 'Show details';
  top.appendChild(caret);
  top.appendChild(advEl('span', 'adv-item-n', title));
  const pend = advPending.get(key);
  const st = pend ?? status;
  const pill = advEl('span', 'adv-run-btn' + (st ? ' ' + st.cls : ''), st ? st.label : '▶ Run');
  if (!pend && status?.open) {
    // Finished run: the pill opens its call / eval view; the row title still re-runs.
    pill.title = 'Open this run';
    pill.addEventListener('click', (ev) => { ev.stopPropagation(); status.open(); });
  }
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
  if (run) top.addEventListener('click', () => advRun(key, run));
  return it;
}

async function advRun(key, run) {
  if (advPending.get(key)?.cls === 'busy') return;
  advPending.set(key, { label: 'Starting…', cls: 'busy' });
  advLoadSoon(0);
  try {
    const r = await fetch('/advanced/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { advPending.set(key, { label: j.error || 'Run failed', cls: 'fail' }); setTimeout(() => { advPending.delete(key); advLoadSoon(0); }, 6000); }
    else { advPending.set(key, { label: 'Queued', cls: 'busy' }); if (!key.startsWith('suite:')) advAutoOpen.add(key); }
  } catch { advPending.set(key, { label: 'Run failed', cls: 'fail' }); }
  advLoadSoon(1500);
}
let advSoon = null;
const advAutoOpen = new Set(); // runs started here: open their view once they finish
function advLoadSoon(ms) { clearTimeout(advSoon); advSoon = setTimeout(advLoad, ms); }

// Latest status per simulation / eval, from the recent runs in the payload.
function advRunState(statusText, passed, ended) {
  if (!ended) return { label: (statusText || 'running').replace(/-/g, ' ') + '…', cls: 'busy' };
  if (passed === true) return { label: 'PASS · view', cls: 'pass', done: true };
  if (passed === false) return { label: 'FAIL · view', cls: 'fail', done: true };
  return { label: (statusText || 'done') + ' · view', cls: '', done: true };
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
      simState[it.simulationId] = advRunState(it.status, it.passed, done);
      if (it.callId && done) { const cid = it.callId; simState[it.simulationId].open = () => openCallViewer(cid); }
    }
    for (const sid of r.simulationIds ?? []) if (!simState[sid]) simState[sid] = advRunState(r.status, null, runDone);
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
    if ((kind === 'sim' && simState[id]) || (kind === 'eval' && evalState[id])) advPending.delete(k);
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

  // Suites whose name contains "· evaluations" are the VOICE evaluations
  // (scripted caller line + pass criterion, run as voice simulations);
  // everything else is the scenario/personality simulation suite.
  const isEvalSuite = (su) => /·\s*evaluations/i.test(su.name);
  const simSuites = (sim.suites ?? []).filter((su) => !isEvalSuite(su));
  const evalSuites = (sim.suites ?? []).filter(isEvalSuite);
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
  const [simCard, sb] = advCard('Simulations', 'AI callers with different personalities phone this agent (voice) and score the result.');
  advRow(sb, 'Scenarios', String(simSuites.reduce((n, su) => n + su.simulations.length, 0)));
  const chips = advEl('div', 'adv-chips');
  for (const p of sim.personalities ?? []) chips.appendChild(advEl('span', 'adv-chip', p));
  if ((sim.personalities ?? []).length) { sb.appendChild(advEl('div', 'prompt-k adv-k', 'Tester personalities')); sb.appendChild(chips); }
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

  // 2. Evaluations (voice): a caller says one scripted line; the spoken reply is judged.
  const [evCard, eb] = advCard('Evaluations', 'Voice checks: an AI caller phones the agent, says a scripted line, and the spoken reply is judged against a pass criterion.');
  if (evalSuites.length) {
    advRow(eb, 'Evaluations', String(evalSuites.reduce((n, su) => n + su.simulations.length, 0)));
    for (const su of evalSuites) {
      suiteBlock(eb, su, 'Suite · ' + su.name.replace(/\s*·\s*evaluations.*$/i, '') + ' · voice', {
        title: (sm) => (sm.scenario ?? sm.name).replace(/^Eval · /, ''),
        fill: (d, sm) => {
          const said = (sm.instructions ?? '').match(/say exactly:\s*"([^"]+)"/i);
          if (said) { d.appendChild(advEl('div', 'prompt-k adv-k', 'Caller says')); d.appendChild(advEl('div', 'adv-quote', '“' + said[1] + '”')); }
          d.appendChild(advEl('div', 'prompt-k adv-k', 'Passes when'));
          for (const c of sm.checks) d.appendChild(advEl('div', 'adv-quote', (c.description ?? c.name).replace(/^True only if:\s*/i, '')));
        },
      });
    }
    runsBlock(eb, idsOf(evalSuites), 'No evaluation runs for this agent yet.');
  } else {
    // Fallback: chat evals (Vapi's chat.mockConversation) when no voice eval suite exists.
    advRow(eb, 'Eval definitions (chat)', String((ev.definitions ?? []).length));
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
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  clearInterval(advTimer);
  if (typeof logsTimer !== 'undefined') clearInterval(logsTimer);
  if (name === 'advanced') { advLoad(); advTimer = setInterval(advLoad, 30000); }
  if (name === 'logs') { logsLoad(); logsTimer = setInterval(logsLoad, 30000); }
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => tabShow(b.dataset.tab)));

