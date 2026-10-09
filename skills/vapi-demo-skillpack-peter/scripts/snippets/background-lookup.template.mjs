// TEMPLATE — background knowledge lookup + mid-sentence pre-fetch for a demo agent
// (copy to <project>/kb-search.mjs). Fill CONFIG, put the documents as .txt in
// <project>/data/kb/ (named <PREFIX>-*.txt per manual, plus a small FAQ file), then:
//   - case-tools.mjs /tools handler: if (name === CONFIG.toolName) result = startManualLookup(args, message?.call, tc.id, emitEvent);
//   - server.mjs: import { localKnowledgeBase, prefetchFromTranscript } from './kb-search.mjs';
//       in the /vapi handler BEFORE the test-call drop:
//       if (message?.type === 'transcript') prefetchFromTranscript(message, emitEvent).catch(() => {});
//   - Vapi: function tool CONFIG.toolName (args query + model, both required, async: true,
//     server.url = <demo>/tools — when PATCHing a tool send the FULL definition, a partial PATCH drops server),
//     assistant monitorPlan.controlEnabled = true, transcriber with turn detection (Deepgram flux-general-en),
//     prompt: "FIRST check for a [Background lookup result] (often pre-fetched while the caller speaks) and answer
//     from it; call the tool only when none covers the model + issue".
//   - .railwayignore: anchor root-only folders (/kb/), never a bare kb/ (it also matches data/kb/).
const CONFIG = {
  toolName: 'search_manuals',
  kbName: 'product-manuals',
  description: 'Owner\'s manuals plus support FAQ. Pre-fetched while the caller speaks and searched in the background; results are added to the live call.',
  // Caller's model -> manual file prefix. First match wins.
  manuals: [
    // [/x-?3\d\d/i, 'Brand-X-300'],
  ],
  faq: /faq|support/i,
  extraStopWords: [],
  // Pre-fetch triggers: a model mention AND a symptom/code mention in the caller's live transcript
  // (spoken numbers are converted first: "three thirty five" -> 335, "code sixteen" -> code 16).
  modelPattern: /\b(model\s?[a-z]?\d{2,4})\b/i,
  normalizeModel: (m) => m.replace(/\s+/g, ' ').trim(),
  symptomPattern: /\b(code \d{1,3}|error|not working|won'?t|leak|noise|display|reset|warranty|serial)\b/i,
  // Section headings that are troubleshooting procedures (boosted for problem questions).
  troubleshootPattern: /troubleshoot|not working|does not operate|error/i,
  // Caller words -> manual words (edit per product).
  synonyms: { error: ['code', 'message'], code: ['error'], serial: ['serial', 'number'], register: ['registration', 'warranty'], broken: ['troubleshooting'] },
};

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, 'data', 'kb');
const STOP = new Set(['the','a','an','and','or','of','to','in','on','for','is','are','be','with','your','you','it','this','that','at','by','as','from','if','not','do','does','can','will','my','our','me','i','we','what','how','why','when','which', ...CONFIG.extraStopWords]);
const tok = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

const docs = [];
const chunks = [];
// Sections: a heading line ("12.3 Pump Not Running", "Locating Your Serial Number")
// plus the text under it, split at ~1400 chars. Headings carry extra weight.
const HEAD = /^(\d+(\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9®™'’()/&,\- ]{2,58}$/;
function isHeading(line) {
  const l = line.trim();
  if (!HEAD.test(l) || /[.,:;]$/.test(l) || /\s\d+$/.test(l)) return false;
  if (/^\d+\.\d+\.?\s+[A-Z]/.test(l) && l.length <= 60) return true; // "12.1 Pump issues"
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

function docFor(model = '') {
  for (const [re, prefix] of CONFIG.manuals) if (re.test(model)) return prefix;
  return null;
}

const SYN = CONFIG.synonyms;
const PROBLEM = /cold|not|no|won|doesn|problem|issue|error|code|fault|broken|weak|low|stuck|trip/i;
function tocLike(text) {
  const t = text.match(/\S+/g) ?? [];
  return t.length ? t.filter((w) => /^\d+(\.\d+)?$/.test(w)).length / t.length : 0;
}
for (const c of chunks) c.toc = tocLike(c.text) > 0.12 || /table of contents/i.test(c.text) || /^\S.*\s\d+$/m.test(c.head);

// "Code 16" -> its definition line in this manual, e.g.
// "Low Pressure (Code 16): The water pressure is low."
function codeDefinition(manual, code) {
  const re = new RegExp('([A-Z][A-Za-z /-]{2,40}) \\(Code ' + code + '\\):\\s*([^\\n]+?\\.)', 'i');
  for (const c of byDoc.get(manual) ?? []) { const m = c.text.replace(/\s+/g, ' ').match(re); if (m) return { name: m[1].trim(), meaning: m[2].trim(), chunk: c }; }
  return null;
}

export function search(query, model, k = 3) {
  const manual = manualFor(model || query);
  const code = (query.match(/code\s*(\d{1,3})/i) ?? [])[1];
  const def = manual && code ? codeDefinition(manual, code) : null;
  if (def) {
    // Search the troubleshooting sections for what the code MEANS, not the caller's words.
    const rest = searchWords(manual, def.meaning + ' ' + def.name, 3, true)
      .filter((c) => c !== def.chunk).slice(0, 1);
    const fmt = (c) => ({ source: c.doc.replace(/\.txt$/, ''), section: c.head, text: c.text.slice(0, 900) });
    return { manual: manual.replace(/\.txt$/, ''), scanned: (byDoc.get(manual) ?? []).length,
      hits: [{ source: manual.replace(/\.txt$/, ''), section: 'Error code ' + code, text: `${def.name} (Code ${code}): ${def.meaning}` }, ...rest.map(fmt)] };
  }
  return searchGeneral(query, model, k);
}

function searchWords(manual, text, k, problem) {
  const base = words(text);
  const q = [...new Set([...base, ...base.flatMap((w) => SYN[w] ?? [])])];
  const scored = [];
  for (const c of byDoc.get(manual) ?? []) {
    let s = 0;
    for (const w of q) {
      const f = c.tf.get(w); if (!f) continue;
      const idf = Math.log(1 + (chunks.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.len / avg));
      if (c.hw.has(w)) s += idf * 2.5;
    }
    if (!s) continue;
    if (c.toc) s *= 0.2;
    if (problem && CONFIG.troubleshootPattern.test(c.head + ' ' + c.text.slice(0, 200))) s *= 2;
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const out = [], seen = new Set();
  for (const { c } of scored) { if (seen.has(c.head)) continue; seen.add(c.head); out.push(c); if (out.length >= k) break; }
  return out;
}

function searchGeneral(query, model, k = 3) {
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
    if (problem && CONFIG.troubleshootPattern.test(c.text)) s *= 1.6;
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
      results: hits.length ? hits.map((h) => ({ source: h.source, section: h.section, text: h.text })) : 'No matching passage. Do not guess.' };
  }
  (async () => {
    const t0 = performance.now();
    const { manual, scanned, hits } = search(query, model);
    const searchMs = Math.round(performance.now() - t0);
    const body = hits.length
      ? hits.map((h, i) => `(${i + 1}) ${h.source} · ${h.section || 'section'}: ${h.text}`).join('\n\n')
      : 'No matching passage in the manuals. Do not guess.';
    const scope = manual ? `${manual} manual + FAQ` : 'FAQ only (model not recognized: ask the caller which model they have)';
    const content = `[Background lookup result] ${CONFIG.toolName} for "${query}"${model ? ` (model ${model})` : ''} · searched: ${scope}\n${body}\n\nReply rule: give only the NEXT single step from this (about 25 words), then stop and wait for the caller. Don't read the whole procedure.`;
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

// ---- Pre-fetch from the caller's live transcript ------------------------------------
// The LLM only runs when the caller's turn ends. To have the manual ready by
// then, watch the caller's live transcript (partials included) and start the
// lookup as soon as it names a model AND a symptom or code — mid-sentence. The
// result is added to the call the same way as the tool's. Re-fires when a new
// code / symptom appears; never twice for the same (manual, issue).
const NUM = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// "three thirty five" -> 335, "three hundred" -> 300, "code sixteen" -> 16, "four eighty-five" -> 485
export function spokenNumbers(text) {
  const toks = text.replace(/-/g, ' ').split(/(\s+)/);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].toLowerCase().replace(/[^a-z]/g, '');
    if (!(w in NUM) && w !== 'hundred') { out.push(toks[i]); continue; }
    // collect a run of number words
    const run = []; let j = i;
    while (j < toks.length) {
      const x = toks[j].toLowerCase().replace(/[^a-z]/g, '');
      if (/^\s+$/.test(toks[j])) { j++; continue; }
      if (x in NUM || x === 'hundred') { run.push(x); j++; } else break;
    }
    let digits = '';
    if (run.includes('hundred')) { const h = NUM[run[0]] ?? 1; const rest = run.slice(run.indexOf('hundred') + 1).reduce((n, x) => n + (NUM[x] ?? 0), 0); digits = String(h * 100 + rest); }
    else if (run.length >= 2 && NUM[run[0]] < 10 && NUM[run[1]] >= 10) { digits = String(NUM[run[0]]) + String(run.slice(1).reduce((n, x) => n + NUM[x], 0)).padStart(2, '0'); }
    else digits = run.reduce((acc, x) => { const v = NUM[x]; if (v >= 20 && v % 10 === 0) return acc + '|' + v; const last = acc.split('|').pop(); if (last && Number(last) >= 20 && Number(last) % 10 === 0 && v < 10) return acc.slice(0, acc.length - last.length) + (Number(last) + v); return acc + '|' + v; }, '').split('|').filter(Boolean).join(' ');
    out.push(digits);
    // keep the whitespace that followed the run
    i = j - 1;
    if (/^\s+$/.test(toks[j - 1] ?? '')) out.push(' ');
  }
  return out.join('').replace(/\s+/g, ' ');
}
const SYMPTOM = CONFIG.symptomPattern;
const prefetchState = new Map(); // callId -> { keys:Set, url }
export async function prefetchFromTranscript(message, emitEvent) {
  if (message?.type !== 'transcript' || !message.call?.id) return;
  const callId = message.call.id;
  const st = prefetchState.get(callId) ?? { keys: new Set(), turn: '', model: null };
  prefetchState.set(callId, st);
  if (prefetchState.size > 200) prefetchState.delete(prefetchState.keys().next().value);
  // Transcribers differ: Flux resends the whole turn so far, nova-3 sends each
  // piece separately ("…a model X 300" / "that is showing low pressure" /
  // "code 16."). Accumulate the caller's turn from its finals (+ the live
  // partial), reset when the agent speaks, and remember the model all call.
  if (message.role !== 'user') { if (message.transcriptType === 'final') st.turn = ''; return; }
  const piece = String(message.transcript ?? '').trim();
  const cumulative = st.turn && piece.toLowerCase().startsWith(st.turn.toLowerCase().slice(0, 40));
  const raw = cumulative ? piece : (st.turn ? st.turn + ' ' + piece : piece);
  if (message.transcriptType === 'final') st.turn = raw;
  const text = spokenNumbers(raw);
  const modelMatch = text.match(CONFIG.modelPattern);
  if (modelMatch) {
    const m = CONFIG.normalizeModel(modelMatch[0]);
    if (manualFor(m)) st.model = m;
  }
  const symptom = text.match(SYMPTOM);
  const model = st.model;
  if (!model || !symptom) return;
  const manual = manualFor(model);
  if (!manual) return;
  // A code at the very end of a PARTIAL may still be growing ("code six" -> "sixteen"): wait.
  const codeM = text.match(/code (\d{1,3})(\W*)$/i) && message.transcriptType !== 'final' ? null : text.match(/code (\d{1,3})/i);
  const code = codeM?.[1];
  const key = manual + '|' + (code ? 'code' + code : symptom[0].toLowerCase().replace(/s$/, ''));
  if (st.keys.has(key)) return;
  st.keys.add(key);
  const started = Date.now();
  const query = code ? `code ${code}` : text.slice(Math.max(0, symptom.index - 40), symptom.index + 60).replace(/^\S*\s/, '').trim();
  const { hits } = search(query, model);
  if (!hits.length) return;
  const scope = `${manual.replace(/\.txt$/, '')} manual + FAQ`;
  const body = hits.map((h, i) => `(${i + 1}) ${h.source} · ${h.section || 'section'}: ${h.text}`).join('\n\n');
  const supersede = st.keys.size > 1 ? ' · SUPERSEDES earlier lookup results in this call (the caller gave more detail)' : '';
  const content = `[Background lookup result] ${CONFIG.toolName} (pre-fetched while the caller was speaking) for "${query.trim()}" (model ${model}) · searched: ${scope}${supersede}\n${body}\n\nReply rule: give only the NEXT single step from this (about 25 words), then stop and wait for the caller. Don't read the whole procedure.`;
  st.url ??= await controlUrlFor(message.call);
  let injected = false;
  if (st.url) {
    try {
      const r = await fetch(st.url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'add-message', message: { role: 'system', content }, triggerResponseEnabled: false }) });
      injected = r.ok;
    } catch (err) { console.error('[kb] prefetch add-message failed', err.message); }
  }
  console.log(`[kb] prefetch call=${callId} model=${model} key=${key} hits=${hits.length} injected=${injected} ${Date.now() - started}ms (${message.transcriptType})`);
  emitEvent?.('tool.background', { callId, name: CONFIG.toolName, query: query.trim(), model: `${model} → ${scope} · pre-fetched mid-sentence`,
    result: hits.map((h) => `${h.source} · ${h.section}: ${h.text.slice(0, 300)}`).join('\n\n'), ms: Date.now() - started, injected });
}
