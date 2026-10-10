
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
  // End-of-call logs (table end_of_call_reports): one row per call.
  const [lc, lb] = advCard('End-of-call logs', 'One row per call from the end-of-call report, saved to the database table end_of_call_reports.');
  advRow(lb, 'Calls stored', st.enabled ? String(st.logTotal ?? 0) : 'not connected (set DATABASE_URL)');
  if (st.enabled && !(d.callLogs ?? []).length) advEmpty(lb, 'No calls stored yet. They appear when the next call ends.');
  for (const c of d.callLogs ?? []) {
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'tkb-type', c.is_simulation ? 'Simulation' : (c.call_type || 'call').replace(/Call$/, '').replace(/^webCall$/, 'web')));
    top.appendChild(advEl('span', 'adv-item-n', (c.ended_reason || 'ended').replace(/-/g, ' ')));
    const dur = c.duration_seconds != null ? Math.round(Number(c.duration_seconds)) + 's' : null;
    top.appendChild(advEl('span', 'tkb-use', [advWhen(c.ended_at || c.received_at), dur, c.cost != null ? '$' + Number(c.cost).toFixed(4) : null].filter(Boolean).join(' · ')));
    it.appendChild(top);
    it.appendChild(advEl('div', 'tkb-meta', 'Call ' + c.call_id));
    if (c.summary) it.appendChild(advEl('div', 'tkb-desc', c.summary));
    lb.appendChild(it);
  }
  grid.appendChild(lc);

  // Webhooks (table monitors_webhook_events): monitor alerts and other webhooks.
  const [wc, wb] = advCard('Monitor webhooks', 'Monitor alerts sent to this demo, saved to the database table monitors_webhook_events.');
  advRow(wb, 'Webhooks stored', st.enabled ? String(st.total ?? 0) : 'not connected (set DATABASE_URL)');
  if (st.enabled && !(d.events ?? []).length) advEmpty(wb, 'No webhooks stored yet. They appear when a monitor alert is sent here.');
  for (const e of d.events ?? []) {
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'tkb-type query', e.source === 'monitor' ? 'Monitor' : e.source));
    top.appendChild(advEl('span', 'adv-item-n', [e.severity ? e.severity.toUpperCase() : null, e.title || e.event_type].filter(Boolean).join(' · ')));
    top.appendChild(advEl('span', 'tkb-use', advWhen(e.received_at)));
    it.appendChild(top);
    if (e.call_id) it.appendChild(advEl('div', 'tkb-meta', 'Call ' + e.call_id));
    wb.appendChild(it);
  }
  grid.appendChild(wc);

  // Structured output results (their own table), grouped by call.
  const [sc, sb2] = advCard('Stored structured outputs', 'Every structured output result, per call, saved to the database table structured_output_results.');
  advRow(sb2, 'Rows stored', st.enabled ? String(st.soTotal ?? 0) : 'not connected (set DATABASE_URL)');
  const byCall = new Map();
  for (const r of d.structuredOutputResults ?? []) { if (!byCall.has(r.call_id)) byCall.set(r.call_id, []); byCall.get(r.call_id).push(r); }
  if (st.enabled && !byCall.size) advEmpty(sb2, 'No results stored yet. They appear shortly after the next call ends.');
  for (const [callId, rows] of [...byCall].slice(0, 8)) {
    const it = advEl('div', 'adv-item');
    const top = advEl('div', 'adv-item-top');
    top.appendChild(advEl('span', 'adv-item-n', 'Call ' + callId.slice(0, 8)));
    top.appendChild(advEl('span', 'tkb-use', advWhen(rows[0].received_at) + (rows[0].is_simulation ? ' · simulation' : '')));
    it.appendChild(top);
    const chips = advEl('div', 'tkb-chips');
    for (const r of rows) {
      const v = typeof r.result === 'object' ? JSON.stringify(r.result) : String(r.result);
      chips.appendChild(advEl('span', 'tkb-chip' + (r.result === true ? ' req' : ''), r.name + ': ' + v));
    }
    it.appendChild(chips);
    sb2.appendChild(it);
  }
  grid.appendChild(sc);
}
