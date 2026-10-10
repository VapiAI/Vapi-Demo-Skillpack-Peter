
// ---- Call DB & Tables tab -----------------------------------------------------------
// GET /db-tables: for each demo table, its columns (information_schema), row
// count and latest rows. Long text / JSON is shortened so the page stays light.
const DB_TABLES = ['end_of_call_reports', 'transcripts', 'human_in_the_loop', 'monitors_webhook_events', 'structured_output_results'];
let dbTablesCache = null;
async function dbTablesHandler(res) {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (dbTablesCache && Date.now() - dbTablesCache.at < 10000) return send(200, dbTablesCache.body);
  const pool = await pgInit();
  if (!pool) return send(200, { enabled: false, tables: [] });
  const short = (v) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') { const j = JSON.stringify(v); return j.length > 80 ? j.slice(0, 77) + '…' : j; }
    const t = String(v); return t.length > 120 ? t.slice(0, 117) + '…' : t;
  };
  const tables = [];
  for (const name of DB_TABLES) {
    try {
      const cols = (await pool.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [name])).rows;
      if (!cols.length) { tables.push({ name, exists: false, columns: [], count: 0, rows: [] }); continue; }
      const count = Number((await pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count);
      const order = cols.some((c) => c.column_name === 'received_at') ? 'received_at DESC' : 'id DESC';
      const rows = (await pool.query(`SELECT * FROM ${name} ORDER BY ${order} LIMIT 20`)).rows
        .map((r) => Object.fromEntries(cols.map((c) => [c.column_name, short(r[c.column_name])])));
      tables.push({ name, exists: true, columns: cols.map((c) => ({ name: c.column_name, type: c.data_type })), count, rows });
    } catch (err) { tables.push({ name, exists: false, error: err.message, columns: [], count: 0, rows: [] }); }
  }
  const body = { enabled: true, tables };
  dbTablesCache = { at: Date.now(), body };
  send(200, body);
}
