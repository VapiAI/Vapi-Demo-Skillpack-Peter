// ---- Advanced tab (2nd page) ------------------------------------------------------
// In-line tabs under the header: "Live" (the board) and "Advanced"
// (simulations + evaluations for this agent). Read-only; loads on open
// and refreshes every 30s while visible.
let advTimer = null;
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

  // 1. Simulations
  const [simCard, sb] = advCard('Simulations', 'AI callers run scripted scenarios against this agent and score the result.');
  advRow(sb, 'Scenarios', String(sim.scenarioCount ?? 0));
  advRow(sb, 'Simulations', String(sim.simulationCount ?? 0));
  const chips = advEl('div', 'adv-chips');
  for (const p of sim.personalities ?? []) chips.appendChild(advEl('span', 'adv-chip', p));
  if ((sim.personalities ?? []).length) { sb.appendChild(advEl('div', 'prompt-k adv-k', 'Tester personalities')); sb.appendChild(chips); }
  for (const su of sim.suites ?? []) {
    sb.appendChild(advEl('div', 'prompt-k adv-k', 'Suite · ' + su.name));
    for (const n of su.simulations) {
      const it = advEl('div', 'adv-item');
      it.appendChild(advEl('div', 'adv-item-n', n));
      sb.appendChild(it);
    }
  }
  if (!(sim.suites ?? []).length) advEmpty(sb, 'No simulation suite is assigned to this agent yet.');
  sb.appendChild(advEl('div', 'prompt-k adv-k', 'Recent runs'));
  if (!(sim.runs ?? []).length) advEmpty(sb, 'No simulation runs for this agent yet.');
  for (const r of sim.runs ?? []) {
    const head = advEl('div', 'adv-run');
    const c = r.counts ?? {};
    head.appendChild(advEl('span', 'adv-run-t', advWhen(r.createdAt) + ' · ' + (r.status ?? '')));
    head.appendChild(advEl('span', 'adv-run-c', (c.passed ?? 0) + ' passed · ' + (c.failed ?? 0) + ' failed · ' + (c.total ?? (r.items ?? []).length) + ' total'));
    sb.appendChild(head);
    for (const it of r.items ?? []) {
      const item = advEl('div', 'adv-item');
      const top = advEl('div', 'adv-item-top');
      top.appendChild(advBadge(it.passed));
      top.appendChild(advEl('span', 'adv-item-n', it.scenario + (it.personality ? ' · ' + it.personality : '')));
      item.appendChild(top);
      for (const e of it.evaluations ?? []) {
        const line = advEl('div', 'adv-eval');
        line.appendChild(advBadge(e.passed));
        line.appendChild(advEl('span', null, e.name + (e.reasoning ? ' — ' + e.reasoning : '')));
        item.appendChild(line);
      }
      if (it.failureReason) item.appendChild(advEl('div', 'adv-sub', 'Failure: ' + it.failureReason));
      for (const s of it.suggestions ?? []) if (s) item.appendChild(advEl('div', 'adv-sugg', '💡 ' + s));
      sb.appendChild(item);
    }
  }
  grid.appendChild(simCard);

  // 2. Evaluations
  const [evCard, eb] = advCard('Evaluations', 'Scripted conversation checks: the agent must reply as expected at each step.');
  advRow(eb, 'Eval definitions', String((ev.definitions ?? []).length));
  for (const e of (ev.definitions ?? []).slice(0, 8)) {
    const it = advEl('div', 'adv-item');
    it.appendChild(advEl('div', 'adv-item-n', e.name));
    if (e.description) it.appendChild(advEl('div', 'adv-sub', e.description));
    eb.appendChild(it);
  }
  eb.appendChild(advEl('div', 'prompt-k adv-k', 'Recent eval runs'));
  if (!(ev.runs ?? []).length) advEmpty(eb, 'No eval runs for this agent yet.');
  for (const r of ev.runs ?? []) {
    const pass = r.results.length ? r.results.every((s) => s === 'pass') : null;
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advBadge(pass));
    top.appendChild(advEl('span', 'adv-item-n', (r.name ?? 'Eval run') + ' · ' + advWhen(r.createdAt)));
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
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  clearInterval(advTimer);
  if (typeof logsTimer !== 'undefined') clearInterval(logsTimer);
  if (name === 'advanced') { advLoad(); advTimer = setInterval(advLoad, 30000); }
  if (name === 'logs') { logsLoad(); logsTimer = setInterval(logsLoad, 30000); }
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => tabShow(b.dataset.tab)));

