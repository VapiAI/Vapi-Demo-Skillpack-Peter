// ---- Logs tab (3rd page) -------------------------------------------------------
// Call log for this agent: one row per call (time, duration, type, ended reason,
// cost, turns, tools, structured outputs); click a row to expand its transcript.
let logsTimer = null;
const logsOpen = new Set();
const logsTurnCache = new Map();
function logsDur(s) { return s == null ? '—' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

async function logsTranscript(id, box) {
  box.innerHTML = '';
  box.appendChild(advEl('div', 'adv-empty', 'Loading transcript…'));
  try {
    let turns = logsTurnCache.get(id);
    if (!turns) {
      const r = await fetch('/logs?id=' + encodeURIComponent(id));
      if (!r.ok) throw new Error('logs ' + r.status);
      turns = (await r.json()).turns ?? [];
      logsTurnCache.set(id, turns);
    }
    box.innerHTML = '';
    if (!turns.length) box.appendChild(advEl('div', 'adv-empty', 'No transcript on this call.'));
    for (const t of turns) {
      if (t.role === 'tool') {
        const el = advEl('div', 'logs-tool', 'Tool call · ' + t.name + (t.result ? ' → ' + t.result : ''));
        box.appendChild(el);
        continue;
      }
      const line = advEl('div', 'logs-line ' + (t.role === 'user' ? 'user' : 'assistant'));
      line.appendChild(advEl('span', 'who', t.role === 'user' ? 'Caller' : (t.name || 'Assistant')));
      line.appendChild(advEl('span', 'txt', displayText(t.text)));
      box.appendChild(line);
    }
  } catch (err) {
    box.innerHTML = '';
    box.appendChild(advEl('div', 'adv-empty', 'Could not load this transcript.'));
  }
}

function logsRender(d) {
  const list = $('logsList');
  list.innerHTML = '';
  const calls = d.calls ?? [];
  const head = advEl('div', 'logs-sum', calls.length + ' most recent calls · click a call to see its transcript');
  list.appendChild(head);
  if (!calls.length) { list.appendChild(advEl('div', 'adv-empty', 'No calls for this agent yet.')); return; }
  for (const c of calls) {
    const row = advEl('div', 'logs-row' + (logsOpen.has(c.id) ? ' open' : ''));
    const top = advEl('div', 'logs-top');
    top.appendChild(advEl('span', 'logs-when', advWhen(c.createdAt)));
    top.appendChild(advEl('span', 'logs-chip', (c.type ?? 'call').replace(/Call$/, '').replace(/^webCall$/, 'web') || 'call'));
    top.appendChild(advEl('span', 'logs-dur', logsDur(c.durationSec)));
    top.appendChild(advEl('span', 'logs-reason', (c.endedReason ?? c.status ?? '').replace(/-/g, ' ')));
    top.appendChild(advEl('span', 'logs-meta', c.turns + ' turns · ' + c.toolCalls + ' tools'));
    top.appendChild(advEl('span', 'logs-cost', c.cost != null ? '$' + c.cost.toFixed(4) : '—'));
    row.appendChild(top);
    if (c.firstCaller) row.appendChild(advEl('div', 'logs-first', '“' + displayText(c.firstCaller) + '”'));
    if ((c.outputs ?? []).length) {
      const chips = advEl('div', 'adv-chips');
      for (const o of c.outputs) chips.appendChild(advEl('span', 'adv-chip', o.name + ': ' + (o.value ?? '—')));
      row.appendChild(chips);
    }
    const tx = advEl('div', 'logs-tx');
    row.appendChild(tx);
    if (logsOpen.has(c.id)) logsTranscript(c.id, tx);
    top.addEventListener('click', () => {
      if (logsOpen.has(c.id)) { logsOpen.delete(c.id); row.classList.remove('open'); tx.innerHTML = ''; }
      else { logsOpen.add(c.id); row.classList.add('open'); logsTranscript(c.id, tx); }
    });
    list.appendChild(row);
  }
}

async function logsLoad() {
  const list = $('logsList');
  if (!list.children.length) list.appendChild(advEl('div', 'adv-empty', 'Loading…'));
  try {
    const r = await fetch('/logs');
    if (!r.ok) throw new Error('logs ' + r.status);
    logsRender(await r.json());
  } catch (err) {
    console.error('logs load failed', err);
    list.innerHTML = '';
    list.appendChild(advEl('div', 'adv-empty', 'Could not load call logs.'));
  }
}

