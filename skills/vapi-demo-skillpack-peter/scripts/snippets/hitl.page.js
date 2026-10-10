// ---- Human in the Loop tab + live flag ------------------------------------------------
// Calls whose caller used words matching the swear/anger regex (table
// human_in_the_loop). Live: 'hitl.flag' adds an entry to the transcript and
// refreshes the tab. "Mark handled" → POST /hitl/handled.
let hitlTimer = null;
const hitlShown = new Set();
function hitlFlagShow(d) {
  if (!d?.callId || (typeof activeCallId !== 'undefined' && activeCallId && d.callId !== activeCallId)) return;
  panelReady('transcript');
  const box = $('transcript');
  const el = document.createElement('div');
  el.className = 'tool-card tool-inline tool-log hitl-flag done flash';
  const row = toolLogLine('hitl', toolLogNow(), d.first === false ? 'Human in the loop · more flagged words' : 'Human in the loop · call flagged', 'HUMAN', 'alert');
  el.appendChild(row);
  const chips = document.createElement('div');
  chips.className = 'tl-args pc-chips';
  for (const t of d.terms ?? []) { const c = document.createElement('span'); c.className = 'pc-chip hit'; c.textContent = t; chips.appendChild(c); }
  el.appendChild(chips);
  const q = document.createElement('div');
  q.className = 'result tl-result';
  q.textContent = '“' + (d.text || '') + '”';
  el.appendChild(q);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  if (!$('hitl')?.hidden) hitlLoad();
}
async function hitlLoad() {
  const grid = $('hitlGrid');
  if (!grid.children.length) grid.appendChild(advEl('div', 'adv-empty', 'Loading…'));
  try {
    const r = await fetch('/hitl');
    if (!r.ok) throw new Error('hitl ' + r.status);
    const d = await r.json();
    grid.innerHTML = '';
    const [card, b] = advCard('Human in the loop', "Calls where the caller used words matching the swear-word / anger filter. Saved to the table human_in_the_loop; every final transcript line is saved to transcripts.");
    if (!d.enabled) { advEmpty(b, 'No database connected (set DATABASE_URL).'); grid.appendChild(card); return; }
    advRow(b, 'Open', String(d.open));
    advRow(b, 'Flagged calls', String(d.total));
    advRow(b, 'Outbound webhook', d.webhook ? 'on (HITL_WEBHOOK_URL)' : 'off (set HITL_WEBHOOK_URL)');
    if (!d.items.length) advEmpty(b, 'No calls flagged yet.');
    for (const it of d.items) {
      const item = advEl('div', 'adv-item' + (it.status === 'open' ? ' hitl-open' : ''));
      const top = advEl('div', 'adv-item-top');
      top.appendChild(advEl('span', 'tkb-type ' + (it.status === 'open' ? 'hitl-st-open' : ''), it.status === 'open' ? 'Open' : 'Handled'));
      top.appendChild(advEl('span', 'adv-item-n', 'Call ' + it.call_id.slice(0, 8) + (it.is_simulation ? ' · simulation' : '')));
      top.appendChild(advEl('span', 'tkb-use', advWhen(it.flagged_at) + ' · ' + it.match_count + ' match' + (it.match_count === 1 ? '' : 'es')));
      if (it.status === 'open') {
        const btn = advEl('span', 'adv-run-btn', '✓ Mark handled');
        btn.addEventListener('click', async () => {
          btn.textContent = 'Saving…';
          await fetch('/hitl/handled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: Number(it.id) }) }).catch(() => {});
          hitlLoad();
        });
        top.appendChild(btn);
      }
      item.appendChild(top);
      const chips = advEl('div', 'tkb-chips');
      for (const t of it.matched_terms ?? []) chips.appendChild(advEl('span', 'tkb-chip hitl-term', t));
      item.appendChild(chips);
      item.appendChild(advEl('div', 'adv-quote', '“' + (it.last_text || it.first_text || '') + '”'));
      b.appendChild(item);
    }
    grid.appendChild(card);
    const [rc, rb] = advCard('Filter', 'Regex run on every FINAL caller line (agent lines are never checked). Override with HITL_REGEX.');
    rb.appendChild(advEl('div', 'hitl-re', d.regex));
    grid.appendChild(rc);
  } catch (err) {
    console.error('hitl load failed', err);
    grid.innerHTML = '';
    grid.appendChild(advEl('div', 'adv-empty', 'Could not load human-in-the-loop data.'));
  }
}
// ---- end hitl
