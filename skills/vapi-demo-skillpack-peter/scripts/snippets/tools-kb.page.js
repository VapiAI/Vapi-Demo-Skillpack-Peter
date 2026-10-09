
// ---- Tools & Knowledge Base tab -------------------------------------------------
// Lists every tool ACTIVE on the agent (from its Vapi config, not from calls),
// with type, description, parameters and recent usage, plus the knowledge-base
// documents behind any query tool. GET /tools-kb; refreshes every 30s while
// open and retries quickly if a load fails.
let tkbTimer = null;
let tkbLast = null;
const tkbOpen = new Set();
const TKB_TYPE = { query: 'Knowledge base', function: 'Function', apiRequest: 'API request', mcp: 'MCP', endCall: 'Built-in', transferCall: 'Built-in', dtmf: 'Built-in', voicemail: 'Built-in', handoff: 'Built-in' };
function tkbSize(b) { if (!b) return '—'; return b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1000)) + ' KB'; }
function tkbFileLabel(n) { return String(n ?? '').replace(/\.(txt|pdf|md|docx?|csv|json)$/i, '').replace(/[-_]+/g, ' ').trim(); }
function tkbStat(box, v, k) { const s = advEl('div', 'tkb-stat'); s.appendChild(advEl('div', 'v', v)); s.appendChild(advEl('div', 'k', k)); box.appendChild(s); }

function tkbToolItem(t, recentCalls) {
  const key = t.id ?? t.name;
  const it = advEl('div', 'adv-item row-click' + (tkbOpen.has(key) ? ' open' : ''));
  const top = advEl('div', 'adv-item-top');
  const caret = advEl('span', 'adv-caret', tkbOpen.has(key) ? '▾' : '▸');
  top.appendChild(caret);
  top.appendChild(advEl('span', 'adv-item-n', t.name));
  top.appendChild(advEl('span', 'tkb-type' + (t.type === 'query' ? ' query' : ''), TKB_TYPE[t.type] ?? t.type));
  top.appendChild(advEl('span', 'tkb-active', 'Active'));
  it.appendChild(top);
  if (t.description) it.appendChild(advEl('div', 'tkb-desc', t.description));
  if (t.params?.length) {
    const chips = advEl('div', 'tkb-chips');
    for (const p of t.params) chips.appendChild(advEl('span', 'tkb-chip' + (p.required ? ' req' : ''), p.name));
    it.appendChild(chips);
  }
  for (const kb of t.knowledgeBases ?? []) it.appendChild(advEl('div', 'tkb-meta', 'Searches “' + kb.name + '” · ' + (kb.fileIds?.length ?? 0) + ' documents'));
  const use = advEl('div', 'tkb-use');
  const n = t.usage?.count ?? 0;
  if (n) { use.innerHTML = 'Used <b></b> in the last ' + (recentCalls ?? '') + ' calls · last ' ; use.querySelector('b').textContent = n + '×'; use.append(advWhen(t.usage.lastAt)); }
  else use.textContent = recentCalls == null ? 'Ready on every call' : 'Ready on every call · not used in the last ' + recentCalls + ' calls';
  it.appendChild(use);
  const det = advEl('div', 'adv-detail');
  for (const p of t.params ?? []) {
    const row = advEl('div', 'tkb-param');
    const nm = advEl('span', 'n', p.name);
    if (p.required) nm.appendChild(advEl('i', null, ' *'));
    row.appendChild(nm);
    row.appendChild(advEl('span', 'd', [p.type, p.enum ? p.enum.join(' | ') : null, p.description].filter(Boolean).join(' · ')));
    det.appendChild(row);
  }
  if (t.params?.length) det.appendChild(advEl('div', 'tkb-meta', '* required — the model fills these from the conversation'));
  if (t.destinations?.length) det.appendChild(advEl('div', 'tkb-meta', 'Destinations: ' + t.destinations.join(', ')));
  if (t.server) det.appendChild(advEl('div', 'tkb-meta', 'Server: ' + t.server));
  if (TKB_TYPE[t.type] === 'Built-in') det.appendChild(advEl('div', 'tkb-meta', 'Runs inside Vapi — no external server.'));
  det.appendChild(advEl('div', 'tkb-meta', (t.source === 'saved tool' ? 'Saved tool ' + t.id : 'Inline on the assistant') + (t.async ? ' · async' : '')));
  it.appendChild(det);
  top.addEventListener('click', () => {
    if (tkbOpen.has(key)) tkbOpen.delete(key); else tkbOpen.add(key);
    it.classList.toggle('open'); caret.textContent = it.classList.contains('open') ? '▾' : '▸';
  });
  return it;
}

function tkbRender(d) {
  const grid = $('tkbGrid');
  grid.innerHTML = '';
  const tools = d.tools ?? [];
  const [tc, tb] = advCard('Tools', 'Every tool active on this agent, read live from its Vapi configuration — available on every call, whether or not it has been used yet. Click a tool for its parameters.');
  const stats = advEl('div', 'tkb-stats');
  tkbStat(stats, String(tools.length), 'Active tools');
  tkbStat(stats, String(tools.filter((t) => t.type === 'query').length), 'Knowledge bases');
  tkbStat(stats, String(tools.filter((t) => TKB_TYPE[t.type] === 'Built-in').length), 'Built-in');
  tb.appendChild(stats);
  const list = advEl('div', 'tkb-list');
  if (!tools.length) advEmpty(list, 'No tools are attached to this agent.');
  for (const t of tools) list.appendChild(tkbToolItem(t, d.recentCalls));
  tb.appendChild(list);
  grid.appendChild(tc);

  const kbs = tools.flatMap((t) => t.knowledgeBases ?? []);
  const files = d.files ?? [];
  const [kc, kb] = advCard('Knowledge base', 'The documents the agent searches when it answers questions.');
  if (!kbs.length) advEmpty(kb, 'No knowledge base is attached to this agent.');
  for (const k of kbs) {
    const it = advEl('div', 'adv-item');
    it.style.marginTop = '10px';
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'adv-item-n', k.name));
    top.appendChild(advEl('span', 'tkb-type query', k.provider));
    top.appendChild(advEl('span', 'tkb-active', 'Active'));
    it.appendChild(top);
    if (k.description) it.appendChild(advEl('div', 'tkb-desc', k.description));
    const mine = files.filter((f) => k.fileIds.includes(f.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const st = advEl('div', 'tkb-stats');
    tkbStat(st, String(mine.length), 'Documents');
    tkbStat(st, tkbSize(mine.reduce((n, f) => n + (f.bytes ?? 0), 0)), 'Indexed text');
    tkbStat(st, mine.filter((f) => f.status === 'done').length + '/' + mine.length, 'Ready');
    it.appendChild(st);
    for (const f of mine) {
      const row = advEl('div', 'tkb-file');
      row.appendChild(advEl('span', 'ic', '▤'));
      const nm = advEl('span', 'nm', tkbFileLabel(f.name));
      nm.title = f.name;
      row.appendChild(nm);
      row.appendChild(advEl('span', 'sz', tkbSize(f.bytes)));
      const b = advBadge(f.status === 'done' ? true : f.status === 'failed' ? false : null);
      b.textContent = f.status === 'done' ? 'READY' : String(f.status ?? '—').toUpperCase();
      row.appendChild(b);
      it.appendChild(row);
    }
    kb.appendChild(it);
  }
  grid.appendChild(kc);
}

async function tkbLoad() {
  const grid = $('tkbGrid');
  if (!grid.children.length) grid.appendChild(advEl('div', 'adv-empty', 'Loading the agent’s tools…'));
  try {
    const r = await fetch('/tools-kb', { cache: 'no-store' });
    if (!r.ok) throw new Error('tools-kb ' + r.status);
    const d = await r.json();
    if (!Array.isArray(d.tools)) throw new Error('tools-kb: no tools array');
    tkbLast = d;
    tkbRender(d);
  } catch (err) {
    console.error('tools-kb load failed', err);
    if (tkbLast) return; // keep the last good render; the timer retries
    grid.innerHTML = '';
    grid.appendChild(advEl('div', 'adv-empty', 'Could not load the agent’s tools — retrying…'));
    clearTimeout(tkbLoad.retry);
    tkbLoad.retry = setTimeout(() => { if (!$('toolskb').hidden) tkbLoad(); }, 3000);
  }
}
