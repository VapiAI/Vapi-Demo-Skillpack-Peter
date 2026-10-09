// TEMPLATE — background knowledge lookup for a demo agent (copy to <project>/kb-search.mjs).
// Fill the CONFIG block, put the documents as .txt in <project>/data/kb/, then:
//   - case-tools.mjs /tools handler: if (name === CONFIG.toolName) result = startManualLookup(args, message?.call, tc.id, emitEvent);
//   - server.mjs: import { localKnowledgeBase } from './kb-search.mjs';  (Tools & Knowledge Base tab hook)
//   - Vapi: function tool CONFIG.toolName (args query + model, both required, server.url = <demo>/tools),
//     assistant monitorPlan.controlEnabled = true, prompt section from SKILL.md (say + ONE clarifying question).
//   - .railwayignore: anchor root-only folders (/kb/), never a bare kb/ (it also matches data/kb/).
const CONFIG = {
  toolName: 'search_manuals',
  kbName: 'product-manuals',
  description: 'Owner\'s manuals plus support FAQ. Searched in the background while the agent asks clarifying questions; results are added to the live call.',
  // Model -> manual file prefix (files are data/kb/<prefix>-*.txt). First match wins.
  manuals: [
    // [/regex on the caller's model/i, 'FILE-PREFIX'],
  ],
  faq: /faq|support/i,          // small always-searched file(s)
  extraStopWords: [],           // brand words that appear everywhere (e.g. the brand name)
};

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, 'data', 'kb');
const STOP = new Set(['the','a','an','and','or','of','to','in','on','for','is','are','be','with','your','you','it','this','that','at','by','as','from','if','not','do','does','can','will','my','our','me','i','we','what','how','why','when','which', ...CONFIG.extraStopWords]);
const tok = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

const docs = [];
const chunks = [];
// Sections: a heading line ("15.6 No Heat", "Locating Your Serial Number")
// plus the text under it, split at ~1400 chars. Headings carry extra weight.
const HEAD = /^(\d+(\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9®™'’()/&,\- ]{2,58}$/;
function isHeading(line) {
  const l = line.trim();
  if (!HEAD.test(l) || /[.,:;]$/.test(l) || /\s\d+$/.test(l)) return false;
  const words = l.replace(/^\d+(\.\d+)*\.?\s+/, '').split(/\s+/);
  return words.length <= 8 && words.filter((w) => /^[A-Z0-9(]/.test(w)).length >= Math.ceil(words.length * 0.6);
}
if (!existsSync(DIR)) console.error('[kb] missing', DIR, '- manual lookup disabled');
for (const f of (existsSync(DIR) ? readdirSync(DIR) : []).filter((n) => n.endsWith('.txt')).sort()) {
  const text = readFileSync(join(DIR, f), 'utf8');
  docs.push({ name: f, bytes: statSync(join(DIR, f)).size });
  let head = '', body = [];
  const flush = () => {
    const t = body.join('\n').trim();
    if (t.length < 30) { body = []; return; }
    for (let i = 0; i < t.length; i += 1300) chunks.push({ doc: f, head, text: (head ? head + '\n' : '') + t.slice(Math.max(0, i - 100), i + 1400) });
    body = [];
  };
  for (const line of text.split('\n')) {
    if (isHeading(line)) { flush(); head = line.trim(); } else body.push(line);
  }
  flush();
}
const words = (s) => (s.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w));
const df = new Map();
for (const c of chunks) {
  c.tf = new Map(); const t = words(c.text); c.len = t.length;
  for (const w of t) c.tf.set(w, (c.tf.get(w) ?? 0) + 1);
  for (const w of c.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  c.hw = new Set(words(c.head));
}
const avg = chunks.reduce((n, c) => n + c.len, 0) / Math.max(1, chunks.length);
// Per-manual index: a lookup only scans the caller's manual (+ the support FAQ).
const byDoc = new Map();
for (const c of chunks) { if (!byDoc.has(c.doc)) byDoc.set(c.doc, []); byDoc.get(c.doc).push(c); }
const FAQ = [...byDoc.keys()].find((d) => CONFIG.faq.test(d));
function manualFor(model) {
  const key = docFor(model);
  return key ? [...byDoc.keys()].find((d) => d.includes(key + '-')) ?? null : null;
}

// Caller's model -> which manual to search.
function docFor(model = '') {
  for (const [re, prefix] of CONFIG.manuals) if (re.test(model)) return prefix;
  return null;
}

// Caller words -> manual words.
const SYN = { cold: ['heat', 'temperature'], heating: ['heat'], warm: ['heat'], hot: ['heat', 'temperature'], temp: ['temperature'],
  jets: ['jet', 'pump'], jet: ['jets', 'pump'], weak: ['poor', 'flow'], flow: ['flow'], won: ['not'], broken: ['troubleshooting'],
  error: ['code', 'message'], code: ['error'], serial: ['serial', 'number'], register: ['registration', 'warranty'],
  light: ['lights', 'lighting'], lights: ['lighting'], power: ['breaker', 'gfci'], gfci: ['breaker'], dirty: ['filter', 'clean'] };
const PROBLEM = /cold|not|no|won|doesn|problem|issue|error|code|fault|broken|weak|low|stuck|trip/i;
function tocLike(text) {
  const t = text.match(/\S+/g) ?? [];
  return t.length ? t.filter((w) => /^\d+(\.\d+)?$/.test(w)).length / t.length : 0;
}
for (const c of chunks) c.toc = tocLike(c.text) > 0.12 || /table of contents/i.test(c.text) || /^\S.*\s\d+$/m.test(c.head);

export function search(query, model, k = 3) {
  const manual = manualFor(model || query);
  // Only the caller's manual plus the support FAQ; without a known model, the FAQ alone.
  const pool = [...(manual ? byDoc.get(manual) : []), ...(FAQ ? byDoc.get(FAQ) : [])];
  const base = words(query);
  const q = [...new Set([...base, ...base.flatMap((w) => SYN[w] ?? [])])];
  const problem = PROBLEM.test(query);
  const code = (query.match(/code\s*(\d{1,3})/i) ?? [])[1];
  const scored = [];
  for (const c of pool) {
    let s = 0;
    for (const w of q) {
      const f = c.tf.get(w); if (!f) continue;
      const idf = Math.log(1 + (chunks.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.len / avg));
      if (c.hw.has(w)) s += idf * 2.5;
    }
    if (!s) continue;
    if (code && new RegExp('\\(code ' + code + '\\)', 'i').test(c.text)) s += 12;
    if (c.doc === FAQ && manual) s *= 0.8;
    if (c.toc) s *= 0.2;
    if (problem && /troubleshoot|error condition|error message|flow issues|no heat/i.test(c.text)) s *= 1.6;
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const out = [], seen = new Set();
  for (const { c } of scored) { const key = c.doc + c.head; if (seen.has(key)) continue; seen.add(key); out.push(c); if (out.length >= k) break; }
  return {
    manual: manual ? manual.replace(/\.txt$/, '') : null,
    scanned: pool.length,
    hits: out.map((c) => ({ source: c.doc.replace(/\.txt$/, ''), section: c.head, text: c.text.slice(0, 1000) })),
  };
}

export function localKnowledgeBase() {
  return {
    tool: CONFIG.toolName,
    name: CONFIG.kbName,
    provider: 'demo server · background search',
    description: CONFIG.description,
    files: docs.map((d) => ({ id: 'local:' + d.name, name: d.name, bytes: d.bytes, status: 'done' })),
  };
}

async function controlUrlFor(call) {
  if (call?.monitor?.controlUrl) return call.monitor.controlUrl;
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  if (!key || !call?.id) return null;
  try {
    const r = await fetch(`https://api.vapi.ai/call/${call.id}`, { headers: { authorization: `Bearer ${key}` } });
    return r.ok ? (await r.json()).monitor?.controlUrl ?? null : null;
  } catch { return null; }
}

// Called from the /tools handler. Returns the immediate tool result; the
// lookup continues in the background.
export function startManualLookup(args, call, toolCallId, emitEvent) {
  const started = Date.now();
  const query = String(args.query ?? '').trim();
  const model = String(args.model ?? '').trim();
  // No live call (Evals API chat runs, or a direct POST): nothing to push a
  // background result into, so answer synchronously with the passages.
  if (!call?.id) {
    const { manual, hits } = search(query, model);
    return { status: 'results', searched: manual ? manual + ' + FAQ' : 'FAQ only',
      results: hits.length ? hits.map((h) => ({ source: h.source, section: h.section, text: h.text })) : 'No matching passage. Do not guess; offer to open a case.' };
  }
  (async () => {
    const t0 = performance.now();
    const { manual, scanned, hits } = search(query, model);
    const searchMs = Math.round(performance.now() - t0);
    const body = hits.length
      ? hits.map((h, i) => `(${i + 1}) ${h.source} · ${h.section || 'section'}: ${h.text}`).join('\n\n')
      : 'No matching passage in the manuals. Do not guess; offer to open a case.';
    const scope = manual ? `${manual} manual + FAQ` : 'FAQ only (model not recognized: ask the caller which model they have)';
    const content = `[Background lookup result] ${CONFIG.toolName} for "${query}"${model ? ` (model ${model})` : ''} · searched: ${scope}\n${body}`;
    const url = await controlUrlFor(call);
    let injected = false;
    if (url) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'add-message', message: { role: 'system', content }, triggerResponseEnabled: false }) });
        injected = r.ok;
        if (!r.ok) console.error('[kb] add-message', r.status, (await r.text()).slice(0, 200));
      } catch (err) { console.error('[kb] add-message failed', err.message); }
    } else console.error('[kb] no controlUrl for call', call?.id);
    console.log(`[kb] lookup "${query}" model=${model || '-'} manual=${manual ?? 'none'} scanned=${scanned} hits=${hits.length} search=${searchMs}ms injected=${injected} total=${Date.now() - started}ms`);
    emitEvent?.('tool.background', { callId: call?.id, toolCallId, name: CONFIG.toolName, query, model: model ? `${model} → ${scope}` : scope,
      result: hits.map((h) => `${h.source} · ${h.section}: ${h.text.slice(0, 300)}`).join('\n\n') || 'No matching passage.',
      ms: Date.now() - started, injected });
  })();
  return { status: 'lookup_started', note: 'The manual search is running in the background. Its result will arrive shortly as a system message starting with [Background lookup result]. Meanwhile, tell the caller you are pulling up the manual and ask one clarifying question. Do not give troubleshooting steps until the result arrives.' };
}
