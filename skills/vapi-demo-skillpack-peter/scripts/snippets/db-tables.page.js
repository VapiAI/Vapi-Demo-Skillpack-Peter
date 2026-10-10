
// ---- Call DB & Tables tab -----------------------------------------------------------
// The demo's Postgres tables: columns + types, row count, latest 20 rows.
let dbtTimer = null;
const DBT_ABOUT = {
  end_of_call_reports: 'One row per call, from the end-of-call report.',
  monitors_webhook_events: 'Monitor alerts sent to this demo (POST /webhooks/monitor).',
  structured_output_results: 'One row per call per structured output.',
  transcripts: 'Every final transcript line (caller and agent), from the transcript webhook.',
  human_in_the_loop: 'Calls flagged by the swear-word / anger regex on the caller\'s words.',
};
async function dbtLoad() {
  const grid = $('dbtGrid');
  if (!grid.children.length) grid.appendChild(advEl('div', 'adv-empty', 'Loading…'));
  try {
    const r = await fetch('/db-tables');
    if (!r.ok) throw new Error('db-tables ' + r.status);
    const d = await r.json();
    grid.innerHTML = '';
    if (!d.enabled) { grid.appendChild(advEl('div', 'adv-empty', 'No database connected (set DATABASE_URL).')); return; }
    for (const t of d.tables) {
      const [card, b] = advCard(t.name, DBT_ABOUT[t.name] ?? '');
      card.classList.add('dbt-card');
      advRow(b, 'Rows', t.exists ? String(t.count) : (t.error ? 'error: ' + t.error : 'table not created yet'));
      if (t.columns.length) {
        b.appendChild(advEl('div', 'prompt-k adv-k', 'Columns'));
        const chips = advEl('div', 'tkb-chips');
        for (const c of t.columns) chips.appendChild(advEl('span', 'tkb-chip', c.name + ' · ' + c.type.replace('timestamp with time zone', 'timestamptz')));
        b.appendChild(chips);
      }
      if (t.rows.length) {
        b.appendChild(advEl('div', 'prompt-k adv-k', 'Latest rows'));
        const wrap = advEl('div', 'dbt-wrap');
        const table = advEl('table', 'dbt');
        const head = advEl('tr');
        for (const c of t.columns) head.appendChild(advEl('th', null, c.name));
        table.appendChild(head);
        for (const row of t.rows) {
          const tr = advEl('tr');
          for (const c of t.columns) { const td = advEl('td', null, row[c.name] ?? ''); td.title = row[c.name] ?? ''; tr.appendChild(td); }
          table.appendChild(tr);
        }
        wrap.appendChild(table);
        b.appendChild(wrap);
      } else if (t.exists) advEmpty(b, 'No rows yet.');
      grid.appendChild(card);
    }
  } catch (err) {
    console.error('db tables load failed', err);
    grid.innerHTML = '';
    grid.appendChild(advEl('div', 'adv-empty', 'Could not load the database tables.'));
  }
}
