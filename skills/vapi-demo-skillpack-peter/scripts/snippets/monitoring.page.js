
// ---- Monitoring & Structured Outputs tab -------------------------------------------
// Structured outputs (moved here from Simulations & Test), this agent's Vapi
// monitors + issues, and the latest webhooks stored in the database
// (end-of-call reports + monitor alerts). GET /advanced + GET /monitoring.
let monsoTimer = null;
async function monsoLoad() {
  const grid = $('monsoGrid');
  if (!grid.children.length) grid.appendChild(advEl('div', 'adv-empty', 'Loading…'));
  try {
    const [a, m] = await Promise.all([
      fetch('/advanced').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/monitoring').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    grid.innerHTML = '';
    if (a) advRenderSO(a, grid);
    monsoRender(m ?? {}, grid);
  } catch (err) {
    console.error('monitoring load failed', err);
    grid.innerHTML = '';
    grid.appendChild(advEl('div', 'adv-empty', 'Could not load monitoring data.'));
  }
}
function monsoRender(d, grid) {
  const [mc, mb] = advCard('Monitors', 'Vapi monitors on this agent: a true/false check run on calls; when enough calls match, Vapi raises an issue and notifies.');
  advRow(mb, 'Active monitors', String((d.monitors ?? []).length));
  if (!(d.monitors ?? []).length) advEmpty(mb, 'No monitors on this agent yet.');
  for (const m of d.monitors ?? []) {
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'adv-item-n', m.name));
    if (m.category) top.appendChild(advEl('span', 'tkb-type', m.category));
    top.appendChild(advEl('span', 'tkb-active', m.enabled === false ? 'Off' : 'Active'));
    it.appendChild(top);
    if (m.description) it.appendChild(advEl('div', 'tkb-desc', m.description));
    mb.appendChild(it);
  }
  mb.appendChild(advEl('div', 'prompt-k adv-k', 'Issues raised'));
  if (!(d.issues ?? []).length) advEmpty(mb, 'No issues raised.');
  for (const i of d.issues ?? []) {
    const row = advEl('div', 'adv-run');
    row.appendChild(advEl('span', 'adv-run-t', (i.severity ? i.severity.toUpperCase() + ' · ' : '') + i.title));
    row.appendChild(advEl('span', 'adv-run-c', [i.status, i.count != null ? i.count + ' calls' : null, advWhen(i.createdAt)].filter(Boolean).join(' · ')));
    mb.appendChild(row);
  }
  grid.appendChild(mc);

  const st = d.stored ?? {};
  const [wc, wb] = advCard('Stored webhooks', 'End-of-call reports and monitor alerts, saved to the database table webhook_events.');
  advRow(wb, 'Database', st.enabled ? (st.total != null ? st.total + ' events stored' : 'connected') : 'not connected (set DATABASE_URL)');
  if (st.enabled && !(d.events ?? []).length) advEmpty(wb, 'No webhooks stored yet. They appear after the next call ends or a monitor fires.');
  for (const e of d.events ?? []) {
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'tkb-type' + (e.source === 'monitor' ? ' query' : ''), e.source === 'monitor' ? 'Monitor' : 'End of call'));
    top.appendChild(advEl('span', 'adv-item-n', e.source === 'monitor'
      ? [e.severity ? e.severity.toUpperCase() : null, e.title || e.event_type].filter(Boolean).join(' · ')
      : (e.ended_reason || e.event_type || 'call ended').replace(/-/g, ' ')));
    top.appendChild(advEl('span', 'tkb-use', advWhen(e.received_at) + (e.is_simulation ? ' · simulation' : '')));
    it.appendChild(top);
    if (e.call_id) it.appendChild(advEl('div', 'tkb-meta', 'Call ' + e.call_id));
    if (e.summary) it.appendChild(advEl('div', 'tkb-desc', e.summary));
    wb.appendChild(it);
  }
  grid.appendChild(wc);
}
