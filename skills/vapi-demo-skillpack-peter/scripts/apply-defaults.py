#!/usr/bin/env python3
"""Apply Peter's default edits to a freshly scaffolded /vapi-demo project.

Run AFTER /vapi-demo Default path step 3 (server-skeleton.mjs -> server.mjs,
examples/demo-dashboard.html -> public/index.html). It does, in one pass:

  1. Rebrands the ride-booking example: <title>, header agent label, "Sarah"
     speaker labels -> "Assistant".
  2. Swaps the ride panel for an "Agent prompt" panel: the assistant's live
     first message + system prompt, fetched from Vapi via GET /agent-prompt.
     (Peter's standing preference — NOT the report/"Call outcome" panel.)
  2b. Splits the middle column: "Config setup" on top (LLM, transcriber and
     voice — provider, model, voice id — read live from the same route) and a
     smaller "Tool calls" panel below it. Panels are numbered 01-04.
  3. Replaces the header phone pill with the web-call button
     (templates/webcall-button.html markup + script + a mint button style).
     Pass --phone "+1 (555) 010-0000" to keep a phone pill instead.
  3b. With --logo <file.svg|.png>, inlines the customer logo (data URI, so the
     page stays self-contained) to the LEFT of the header agent label, after
     the Vapi wordmark and divider.
  3c. Replaces the live transcript renderer with a TURN-BY-TURN one: one
     bubble per speaker turn. Fragments, partials and whole-utterance finals
     from the same speaker merge into the current bubble; history from
     conversation-update is merged the same way. (Peter: "just show it turn
     by turn" — the stock renderer split one greeting into six bubbles.)
  4. Adds GET /last-call to server.mjs and a page loader, so a freshly opened
     board shows the assistant's most recent REAL call from the Vapi API
     instead of an empty board or replayed try-it.sh dummy data.

Every edit asserts its anchor exists, and the script ends by grepping for a
marker unique to each edit, so a partial apply fails loudly.

Usage:
  python3 apply-defaults.py <project_dir> --brand "After-hours lending assistant" \
      --title "Vapi after-hours lending demo" [--skill-dir <vapi-demo skill dir>] [--phone "..."]
"""
import argparse
import base64
import glob
import json
import os
import re
import sys


def find_skill_dir():
    # Prefer the base skill bundled in this plugin (../base), so the skillpack
    # works on its own; fall back to an installed vapi-demo plugin.
    bundled = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'base')
    if os.path.isfile(os.path.join(bundled, 'templates', 'report-panel.html')):
        return bundled
    cands = sorted(glob.glob(os.path.expanduser(
        '~/.claude/plugins/cache/vapi-demo-marketplace/vapi-demo/*/skills/vapi-demo')))
    cands.append(os.path.expanduser('~/Desktop/Claude Plugins/Vapi-Demo-Builder/skills/vapi-demo'))
    for c in reversed(cands):
        if os.path.isfile(os.path.join(c, 'templates', 'report-panel.html')):
            return c
    sys.exit('could not find the vapi-demo skill dir; pass --skill-dir')


class Doc:
    def __init__(self, path):
        self.path = path
        self.s = open(path).read()

    def rep(self, old, new, all_=False):
        if old not in self.s:
            sys.exit(f'{self.path}: anchor missing: {old[:70]!r}')
        self.s = self.s.replace(old, new) if all_ else self.s.replace(old, new, 1)

    def sub(self, pattern, new):
        s2, n = re.subn(pattern, new, self.s, count=1, flags=re.S)
        if not n:
            sys.exit(f'{self.path}: pattern missing: {pattern[:70]!r}')
        self.s = s2

    def save(self):
        open(self.path, 'w').write(self.s)


LAST_CALL_ROUTE = r'''
// ---- Last real call ----------------------------------------------------------
// A freshly opened page with nothing in the replay buffer shows the assistant's
// most recent real call, pulled from Vapi, instead of an empty board.
async function lastCallHandler(res) {
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!key || !process.env.ASSISTANT_ID) return send(503, { error: 'not configured' });
  if (buffer.length) return send(200, { buffered: true });
  try {
    const r = await fetch(`https://api.vapi.ai/call?assistantId=${process.env.ASSISTANT_ID}&limit=1`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const [call] = await r.json();
    if (!call) return send(200, { call: null });
    const messages = [call.artifact?.messages, call.messages].find(Array.isArray) ?? [];
    const tools = [];
    for (const m of messages) {
      if (m.role === 'tool_calls') for (const tc of m.toolCalls ?? []) {
        let args = tc.function?.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        tools.push({ id: tc.id, name: tc.function?.name ?? tc.type ?? 'tool', args });
      }
    }
    send(200, {
      call: {
        callId: call.id,
        status: call.status,
        endedReason: call.endedReason ?? null,
        startedAt: call.startedAt ?? call.createdAt,
        structuredOutputs: call.artifact?.structuredOutputs ?? null,
        turns: messages
          .filter((m) => (m.role === 'bot' || m.role === 'user') && typeof m.message === 'string' && m.message.trim())
          .map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'user', name: 'Assistant', text: m.message })),
        tools,
      },
    });
  } catch (err) {
    console.error('last-call fetch failed', err);
    send(502, { error: 'fetch failed' });
  }
}
'''

LAST_CALL_PAGE = '''// Before any live call, show the assistant's most recent real call (from the
// Vapi call record). Skipped when the server's replay buffer already holds a
// call, because the replay below draws that one.
async function lastCallShow() {
  try {
    const res = await fetch('/last-call');
    if (!res.ok) return;
    const { call } = await res.json();
    if (!call || activeCallId) return;
    activeCallId = call.callId;
    callEnded = call.status === 'ended';
    if (callEnded) endedCallMark(call.callId);
    $('callId').textContent = 'Last call ' + call.callId.slice(0, 8);
    setStatus(callEnded ? 'Last call' : call.status, false);
    if (call.turns.length) transcriptHistoryRender(call.turns);
    for (const t of call.tools) { addToolCall(t.name, t.args, t.id); completeToolCall(t.name, '', null, t.id); }
  } catch (err) {
    console.error('last call load failed', err);
  }
}
lastCallShow();

'''

PROMPT_ROUTE = r'''
// ---- Agent prompt --------------------------------------------------------------
// Voice ids are opaque, so resolve the human name + description the Vapi
// dashboard shows ("Clementine - Hospitable Host") from Vapi's voice library.
// The library pages at most 1000 per request; cache per voice id.
const voiceCache = new Map();
async function voiceLookup(provider, voiceId, key) {
  if (!provider || !voiceId) return null;
  const cacheKey = provider + ':' + voiceId;
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey);
  let found = null;
  try {
    for (let page = 1; page <= 20 && !found; page++) {
      const r = await fetch(`https://api.vapi.ai/voice-library/${provider}?limit=1000&page=${page}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (!r.ok) break;
      const list = await r.json();
      if (!Array.isArray(list) || !list.length) break;
      const v = list.find((x) => x.providerId === voiceId || x.slug === voiceId || x.id === voiceId);
      if (v) found = { name: v.name ?? null, description: v.description ?? null };
      if (list.length < 1000) break;
    }
  } catch (err) {
    console.error('voice lookup failed', err);
    return null; // don't cache a transient failure
  }
  voiceCache.set(cacheKey, found);
  return found;
}

// The right panel shows what the agent was told: its first message and system
// prompt, read live from Vapi so edits on the assistant show on the next load.
async function agentPromptHandler(res) {
  const key = process.env.VAPI_API_KEY ?? process.env.VAPI_PRIVATE_KEY;
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!key || !process.env.ASSISTANT_ID) return send(503, { error: 'not configured' });
  try {
    const r = await fetch(`https://api.vapi.ai/assistant/${process.env.ASSISTANT_ID}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const a = await r.json();
    const voiceInfo = await voiceLookup(a.voice?.provider, a.voice?.voiceId, key);
    const system = (a.model?.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    send(200, {
      name: a.name ?? null,
      firstMessage: a.firstMessage ?? null,
      prompt: system || null,
      config: {
        llm: { provider: a.model?.provider ?? null, model: a.model?.model ?? null },
        transcriber: { provider: a.transcriber?.provider ?? null, model: a.transcriber?.model ?? null, language: a.transcriber?.language ?? null },
        voice: {
          provider: a.voice?.provider ?? null, model: a.voice?.model ?? null, voice: a.voice?.voiceId ?? null,
          name: voiceInfo?.name ?? null, description: voiceInfo?.description ?? null,
        },
        // Unset plan = Vapi's defaults (dashboard: 0 words, 0.2s voice, 1s back-off).
        stopSpeaking: {
          numWords: a.stopSpeakingPlan?.numWords ?? 0,
          voiceSeconds: a.stopSpeakingPlan?.voiceSeconds ?? 0.2,
          backoffSeconds: a.stopSpeakingPlan?.backoffSeconds ?? 1,
          isDefault: {
            numWords: a.stopSpeakingPlan?.numWords == null,
            voiceSeconds: a.stopSpeakingPlan?.voiceSeconds == null,
            backoffSeconds: a.stopSpeakingPlan?.backoffSeconds == null,
          },
        },
        // Unset plan = Vapi's defaults (dashboard: 0.4s wait, smart endpointing
        // off, 0.1s / 1.5s / 0.5s on punctuation / no punctuation / number).
        startSpeaking: (() => {
          const p = a.startSpeakingPlan ?? {};
          const t = p.transcriptionEndpointingPlan ?? {};
          const smart = p.smartEndpointingPlan?.provider ?? (p.smartEndpointingEnabled ? 'on' : null);
          return {
            waitSeconds: p.waitSeconds ?? 0.4,
            smartEndpointing: smart ?? 'off',
            onPunctuationSeconds: t.onPunctuationSeconds ?? 0.1,
            onNoPunctuationSeconds: t.onNoPunctuationSeconds ?? 1.5,
            onNumberSeconds: t.onNumberSeconds ?? 0.5,
            allDefault: p.waitSeconds == null && smart == null && t.onPunctuationSeconds == null
              && t.onNoPunctuationSeconds == null && t.onNumberSeconds == null,
          };
        })(),
      },
    });
  } catch (err) {
    console.error('agent-prompt fetch failed', err);
    send(502, { error: 'fetch failed' });
  }
}
'''

PROMPT_PAGE = '''// Right panel: the agent's first message and system prompt, read live from the
// assistant. It describes the agent, not a call, so call resets leave it alone.
async function agentPromptShow() {
  try {
    const res = await fetch('/agent-prompt');
    if (!res.ok) return;
    const a = await res.json();
    if (a.config) configRender(a.config);
    if (!a.prompt && !a.firstMessage) return;
    panelReady('prompt');
    const box = $('prompt');
    box.innerHTML = '';
    for (const [label, text] of [['First message', a.firstMessage], ['System prompt', a.prompt]]) {
      if (!text) continue;
      const block = document.createElement('div');
      block.className = 'prompt-block';
      block.innerHTML = '<div class="prompt-k"></div><div class="prompt-text"></div>';
      block.querySelector('.prompt-k').textContent = label;
      block.querySelector('.prompt-text').textContent = text;
      box.appendChild(block);
    }
  } catch (err) {
    console.error('agent prompt load failed', err);
  }
}
agentPromptShow();

// Middle panel: which LLM, transcriber and voice the agent runs on. One
// compact row each so it fits above the tool calls panel on a laptop screen.
function configRender(cfg) {
  panelReady('config');
  const box = $('config');
  box.innerHTML = '';
  const join = (...xs) => xs.filter(Boolean).join(' · ');
  const voice = cfg.voice ?? {};
  const rows = [
    ['LLM', join(cfg.llm?.provider, cfg.llm?.model), []],
    ['Transcriber', join(cfg.transcriber?.provider, cfg.transcriber?.model, cfg.transcriber?.language), []],
    // Named like the Vapi dashboard voice picker; the raw id only if the
    // voice library lookup came back empty.
    voice.name
      ? ['Voice', voice.name, [join(voice.provider, voice.model), voice.description]]
      : ['Voice', join(voice.provider, voice.model), [voice.voice ? 'Voice ' + voice.voice : null]],
  ];
  for (const [k, v, subs] of rows) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'cfg-row';
    row.innerHTML = '<div class="prompt-k"></div><div class="v"></div>';
    row.querySelector('.prompt-k').textContent = k;
    row.querySelector('.v').textContent = v;
    for (const sub of subs.filter(Boolean)) {
      const el = document.createElement('div');
      el.className = 'sub';
      el.textContent = sub;
      row.appendChild(el);
    }
    box.appendChild(row);
  }
  // Stop speaking plan, one small line: when the caller can interrupt the agent.
  const sp = cfg.stopSpeaking;
  if (sp) {
    const allDefault = sp.isDefault && Object.values(sp.isDefault).every(Boolean);
    const row = document.createElement('div');
    row.className = 'cfg-row cfg-small';
    row.innerHTML = '<div class="prompt-k">Stop speaking plan</div><div class="sub"></div>';
    row.querySelector('.sub').textContent =
      'Words ' + sp.numWords + ' · Voice ' + sp.voiceSeconds + 's · Back off ' + sp.backoffSeconds + 's'
      + (allDefault ? ' · defaults' : '');
    box.appendChild(row);
  }
  // Start speaking plan, same small format: when the agent starts replying.
  const ss = cfg.startSpeaking;
  if (ss) {
    const row = document.createElement('div');
    row.className = 'cfg-row cfg-small';
    row.innerHTML = '<div class="prompt-k">Start speaking plan</div><div class="sub"></div>';
    row.querySelector('.sub').textContent =
      'Wait ' + ss.waitSeconds + 's · Smart endpointing ' + ss.smartEndpointing
      + ' · Punctuation ' + ss.onPunctuationSeconds + 's · No punctuation ' + ss.onNoPunctuationSeconds + 's'
      + ' · Number ' + ss.onNumberSeconds + 's' + (ss.allDefault ? ' · defaults' : '');
    box.appendChild(row);
  }
}

'''

PROMPT_CSS = """.turn-marker {
  align-self: center; margin: 2px 0; padding: 3px 12px; border-radius: 999px;
  border: 1px dashed var(--line); background: var(--bg); color: var(--text-muted);
  font-family: "Foundry Gridnik", "Tomorrow", sans-serif; text-transform: uppercase;
  font-size: 10px; letter-spacing: 0.08em; white-space: nowrap;
}
.prompt-block { margin-bottom: 16px; }
.mid-stack { display: flex; flex-direction: column; gap: 16px; min-height: 0; }
/* Config sizes to its content (never scrolls); tool calls take the rest. */
.mid-stack .cfg-panel { flex: 0 0 auto; }
.mid-stack .cfg-panel .body { max-height: none; overflow: visible; }
.mid-stack .tools-panel { flex: 1 1 0; min-height: 120px; }
.cfg-row {
  padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg);
}
.cfg-row .v { font-weight: 600; font-size: 14px; }
.cfg-row .sub { color: var(--text-muted); font-size: 12px; margin-top: 3px; line-height: 1.4; word-break: break-word; }
.cfg-small { padding: 8px 14px; }
.cfg-small .sub { font-size: 11px; margin-top: 1px; }
.prompt-k {
  font-family: "Foundry Gridnik", "Tomorrow", sans-serif; text-transform: uppercase;
  font-size: 11px; letter-spacing: 0.1em; color: var(--mint); margin-bottom: 8px;
}
.prompt-text {
  white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55;
  padding: 13px 15px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg);
}
.cfg-row .prompt-k { margin-bottom: 4px; }
"""

LOGO_CSS = """.brand { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
header .brand .customer-logo { height: 22px; width: auto; max-width: 160px; object-fit: contain; }
"""

TURN_TRANSCRIPT = r"""// Agents SAY web addresses ("e money u s a dot com"); the room should READ them.
// Display-only: "dot com" -> ".com" (common TLDs), and spelled-out letters
// right before it are joined ("u s a.com" -> "usa.com").
// Known demo domains (from --domain) are matched letter by letter with any
// spacing, so "e money u s a.com" reads as "emoneyusa.com".
const DEMO_DOMAINS = __DEMO_DOMAINS__;
const domainPatterns = DEMO_DOMAINS.map((d) => {
  const [label, ...rest] = d.split('.');
  const letters = label.replace(/[^a-z0-9]/gi, '').split('').join('[\\s-]*');
  return [new RegExp('\\b' + letters + '\\.' + rest.join('\\.') + '\\b', 'gi'), d];
});
function displayText(s) {
  let out = String(s ?? '')
    .replace(/\s+dot\s+(com|net|org|io|ai|co|us|gov|edu)\b/gi, (_, tld) => '.' + tld.toLowerCase());
  for (const [re, d] of domainPatterns) out = out.replace(re, d);
  return out.replace(/\b((?:[a-z]\s){1,}[a-z])(?=\.(?:com|net|org|io|ai|co|us|gov|edu)\b)/gi, (m) => m.replace(/\s/g, ''));
}

// A small centred marker between turns, so the room sees exactly where one
// speaker stopped and the other started.
function turnMarkerAppend(box, prevRole, nextRole) {
  const who = (r) => (r === 'user' ? 'Caller' : agentLabel);
  const el = document.createElement('div');
  el.className = 'turn-marker';
  el.textContent = prevRole
    ? who(prevRole) + ' turn ended \u00b7 ' + who(nextRole) + ' turn started'
    : who(nextRole) + ' turn started';
  box.appendChild(el);
}

function addTranscript(role, text, final) {
  text = displayText(text);
  // TURN-BY-TURN: one bubble per speaker turn. Everything the same speaker says
  // until the other side speaks lands in the current bubble. Each bubble keeps
  // its settled text in data-settled; a partial shows as settled + live tail.
  const norm = normText(text);
  if (!norm) return;
  if (callEnded && !final) return;
  if (handoverAbsorb(role, text)) return;
  panelReady('transcript');
  const box = $('transcript');
  const utts = box.querySelectorAll('.utterance');
  let bubble = utts[utts.length - 1] ?? null;
  if (!bubble || bubble.dataset.role !== role) {
    turnMarkerAppend(box, bubble ? bubble.dataset.role : null, role);
    bubble = document.createElement('div');
    bubble.className = 'utterance ' + (role === 'user' ? 'user' : 'assistant');
    bubble.dataset.role = role;
    bubble.dataset.seg = String(toolSegment);
    bubble.dataset.settled = '';
    bubble.innerHTML = '<div class="who"></div><div class="text"></div>';
    bubble.querySelector('.who').textContent = role === 'user' ? 'Caller' : agentLabel;
    box.appendChild(bubble);
  }
  const settled = bubble.dataset.settled || '';
  const settledNorm = normText(settled);
  if (final) {
    let next;
    if (!settled) next = text;
    else if (settledNorm.includes(norm)) next = settled;           // already shown (re-send / history race)
    else if (norm.startsWith(settledNorm)) next = text;            // whole-utterance final restating it
    else next = settled + ' ' + text;                              // next fragment of the same turn
    bubble.dataset.settled = next;
    bubble.querySelector('.text').textContent = next;
    bubble.classList.remove('partial');
  } else {
    let shown;
    if (!settled || norm.startsWith(settledNorm)) shown = text;
    else if (settledNorm.includes(norm)) shown = settled;
    else shown = settled + ' ' + text;
    bubble.querySelector('.text').textContent = shown;
  }
  box.scrollTop = box.scrollHeight;
}

"""

TALK_CSS = """.talk-btn {
  font-family: "Foundry Gridnik", "Tomorrow", sans-serif; text-transform: uppercase;
  font-size: 11px; letter-spacing: 0.1em; padding: 9px 16px; border-radius: 999px;
  border: 1px solid var(--mint); background: var(--mint); color: #111013;
  cursor: pointer; transition: opacity 0.15s ease; white-space: nowrap;
}
.talk-btn:hover { opacity: 0.85; }
.talk-btn:disabled { opacity: 0.6; cursor: progress; }
.talk-btn.live { background: var(--bg); color: var(--text); border-color: var(--line); }
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project_dir')
    ap.add_argument('--brand', required=True, help='header agent label')
    ap.add_argument('--customer', default=None,
                    help="customer display name, e.g. eMoneyUSA -> tab title 'eMoneyUSA x Vapi: Voice AI Demo'")
    ap.add_argument('--title', default=None,
                    help="override the browser tab title (default: '<customer> x Vapi: Voice AI Demo', or 'Vapi Voice AI Demo')")
    ap.add_argument('--skill-dir', default=None)
    ap.add_argument('--domain', action='append', default=[],
                    help='customer domain to recognise when spoken, e.g. emoneyusa.com (repeatable)')
    ap.add_argument('--logo', default=None, help='customer logo file (.svg/.png/.jpg) shown left of the agent label')
    ap.add_argument('--phone', default=None, help='keep a phone pill with this number instead of the web-call button')
    a = ap.parse_args()
    if not a.title:
        a.title = f'{a.customer} x Vapi: Voice AI Demo' if a.customer else 'Vapi Voice AI Demo'
    import html as _html
    a.title = _html.escape(a.title, quote=False)
    skill = a.skill_dir or find_skill_dir()
    wc = open(os.path.join(skill, 'templates', 'webcall-button.html')).read()

    page = Doc(os.path.join(a.project_dir, 'public', 'index.html'))
    page.rep('<title>Vapi ride booking demo</title>', f'<title>{a.title}</title>')
    logo_html = ''
    if a.logo:
        ext = os.path.splitext(a.logo)[1].lower()
        mime = {'.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}.get(ext)
        if not mime:
            sys.exit(f'unsupported logo type: {ext}')
        raw = open(a.logo, 'rb').read()
        if mime == 'image/svg+xml' and re.search(rb'<script|javascript:|\son\w+=', raw, re.I):
            sys.exit('logo SVG contains script/event handlers; refusing to inline it')
        uri = f'data:{mime};base64,' + base64.b64encode(raw).decode()
        logo_html = f'<img class="customer-logo" src="{uri}" alt="Customer logo">'
    page.rep('<div class="brand">Ride booking agent</div>', f'<div class="brand">{logo_html}{a.brand}</div>')
    pill = '<a class="phone" href="tel:+15550100000">&#128222; +1 (555) 010-0000</a>'
    if a.phone:
        digits = re.sub(r'\D', '', a.phone)
        page.rep(pill, f'<a class="phone" href="tel:+{digits}">&#128222; {a.phone}</a>')
    else:
        page.rep(pill, '<button class="talk-btn" id="talk-btn">&#127897; Talk to the agent</button>')
    page.rep("(d.agent?.persona || 'Sarah')", "(d.agent?.persona || 'Assistant')")
    page.rep("bubble.querySelector('.who').textContent = 'Sarah';", "bubble.querySelector('.who').textContent = 'Assistant';")
    page.rep("role === 'user' ? 'Caller' : 'Sarah'", "role === 'user' ? 'Caller' : 'Assistant'")
    page.rep("(turn.name || 'Agent')", "(turn.name || 'Assistant')")

    # Agent prompt panel (replaces the ride panel) + ride cleanup
    page.sub(r'<section class="panel">\s*<h2><span class="n">03</span>.*?</section>',
             '<section class="panel">\n    <h2><span class="n">04</span> &middot; <span class="label">Agent prompt</span></h2>\n'
             '    <div class="body" id="prompt"></div>\n  </section>')
    page.sub(r"  ride: \{\n    icon: '[^']*',\n  \},",
             "  prompt: {\n    icon: '<path d=\"M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z\"/><path d=\"M14 3v6h6\"/><path d=\"M8 13h8M8 17h5\"/>',\n  },")
    # Middle column: Config setup on top, smaller Tool calls below.
    page.sub(r'<section class="panel">\s*<h2><span class="n">02</span>.*?</section>',
             '<div class="mid-stack">\n  <section class="panel cfg-panel">\n'
             '    <h2><span class="n">02</span> &middot; <span class="label">Config setup</span></h2>\n'
             '    <div class="body" id="config"></div>\n  </section>\n'
             '  <section class="panel tools-panel">\n'
             '    <h2><span class="n">03</span> &middot; <span class="label">Tool calls</span></h2>\n'
             '    <div class="body" id="tools"></div>\n  </section>\n  </div>')
    page.rep("  tools: {\n", "  config: {\n    icon: '<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1\"/>',\n  },\n  tools: {\n")
    # Call resets clear transcript + tools only; prompt + config describe the agent, not the call.
    page.rep("['transcript', 'tools', 'ride']", "['transcript', 'tools']", all_=True)
    page.rep("  placeholderShow('ride');\n", "")
    page.sub(r'function renderRide\(ride\) \{.*?\n\}\n', '')
    page.sub(r"    case 'ride':.*?      break;\n", '')
    extra_css = PROMPT_CSS + ('' if a.phone else TALK_CSS) + (LOGO_CSS if a.logo else '')
    page.rep('/* Reset, so the board can be cleared before a screen share. */',
             extra_css + '\n/* Reset, so the board can be cleared before a screen share. */')
    wcjs = '' if a.phone else re.search(r'<script>\n(.*?)</script>', wc, re.S).group(1)
    page.rep("$('resetBtn').addEventListener('click', viewReset);",
             "$('resetBtn').addEventListener('click', viewReset);\n\n" + wcjs)

    # Turn-by-turn transcript: replace the live renderer, merge history turns.
    turn_js = TURN_TRANSCRIPT.replace('__DEMO_DOMAINS__', json.dumps([d.lower() for d in a.domain]))
    page.sub(r'function addTranscript\(role, text, final\) \{.*?\n\}\n\n', turn_js.replace('\\', '\\\\'))
    page.rep("  for (const turn of turns) historyBubbleAppend(box, turn);",
             "  turns.forEach((turn, i) => {\n"
             "    turnMarkerAppend(box, i ? turns[i - 1].role : null, turn.role);\n"
             "    historyBubbleAppend(box, turn);\n"
             "  });")
    page.rep("let historySig = '';", "let historySig = '';\nlet agentLabel = 'Assistant';")
    page.rep("  bubble.querySelector('.who').textContent = turn.role === 'user' ? 'Caller' : (turn.name || 'Assistant');\n  bubble.querySelector('.text').textContent = turn.text;",
             "  if (turn.role !== 'user' && turn.name) agentLabel = turn.name;\n"
             "  bubble.querySelector('.who').textContent = turn.role === 'user' ? 'Caller' : agentLabel;\n"
             "  bubble.dataset.settled = turn.text;\n"
             "  bubble.querySelector('.text').textContent = turn.text;")
    page.rep("  if (!turns || !turns.length) return;\n",
             "  if (!turns || !turns.length) return;\n"
             "  // One bubble per speaker turn: fold consecutive same-speaker messages together.\n"
             "  turns = turns.reduce((acc, t) => {\n"
             "    const last = acc[acc.length - 1];\n"
             "    if (last && last.role === t.role) last.text = last.text + ' ' + displayText(t.text);\n"
             "    else acc.push({ ...t, text: displayText(t.text) });\n"
             "    return acc;\n"
             "  }, []);\n")

    # Last real call loader
    anchor = "let serverVersion = null;\nconst source = new EventSource('/events/stream');"
    page.rep(anchor, "placeholderShow('prompt');\nplaceholderShow('config');\n" + PROMPT_PAGE + LAST_CALL_PAGE + anchor)
    page.save()

    srv = Doc(os.path.join(a.project_dir, 'server.mjs'))
    srv.rep('\n// ---- Static + routing', LAST_CALL_ROUTE + PROMPT_ROUTE + '\n// ---- Static + routing')
    srv.rep("  if (req.method === 'GET' && req.url === '/webcall-token') return webcallTokenHandler(res);",
            "  if (req.method === 'GET' && req.url === '/webcall-token') return webcallTokenHandler(res);\n"
            "  if (req.method === 'GET' && req.url === '/last-call') return lastCallHandler(res);\n"
            "  if (req.method === 'GET' && req.url === '/agent-prompt') return agentPromptHandler(res);")
    srv.save()

    # ---- Live call data panel + inline tool calls ---------------------------
    # Peter: "replace the tool calls section with live call data; when a tool
    # call happens mid call, show it in the transcript" + duration, turns,
    # cost and tokens, updated every second. JS lives in snippets/ (no escaping).
    snip = lambda name: open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'snippets', name)).read()
    page = Doc(page.path)
    page.rep('  <section class="panel tools-panel">\n'
             '    <h2><span class="n">03</span> &middot; <span class="label">Tool calls</span></h2>\n'
             '    <div class="body" id="tools"></div>\n  </section>',
             '  <section class="panel live-panel">\n'
             '    <h2><span class="n">03</span> &middot; <span class="label">Live call data</span></h2>\n'
             '    <div class="body" id="live"></div>\n  </section>')
    page.rep('.mid-stack .tools-panel { flex: 1 1 0; min-height: 120px; }',
             '.mid-stack .live-panel { flex: 1 1 0; min-height: 120px; }\n'
             '.live-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 2px;\n'
             '  border-bottom: 1px dashed var(--line); font-size: 12.5px; }\n'
             '.live-row:last-child { border-bottom: none; }\n'
             '.live-row .k { color: var(--text-muted); white-space: nowrap; }\n'
             '.live-row .v { font-weight: 600; text-align: right; word-break: break-all; font-variant-numeric: tabular-nums; }\n'
             '#transcript .tool-inline { margin: 2px 28px; font-size: 12.5px; }\n'
             '#transcript .tool-inline .name { font-size: 12.5px; }')
    page.rep("  tools: {\n", "  live: {\n    icon: '<path d=\"M3 12h4l3-8 4 16 3-8h4\"/>',\n  },\n  tools: {\n")
    page.rep("['transcript', 'tools']", "['transcript', 'live']", all_=True)
    page.rep("placeholderShow('tools');", "placeholderShow('live');")
    page.rep("  panelReady('tools');\n  const box = $('tools');", "  panelReady('transcript');\n  const box = $('transcript');", all_=True)
    page.rep("$('tools').scrollTop = $('tools').scrollHeight;", "$('transcript').scrollTop = $('transcript').scrollHeight;")
    page.rep("    $('tools').innerHTML = '';", "    placeholderShow('live');")
    page.rep("  el.className = 'tool-card flash';", "  el.className = 'tool-card tool-inline flash';")
    page.rep("  el.querySelector('.name').textContent = name;", "  el.querySelector('.name').textContent = 'Tool call · ' + name;")
    # Speech after a tool card starts a new bubble (no turn marker if same speaker).
    page.rep("  let bubble = utts[utts.length - 1] ?? null;\n  if (!bubble || bubble.dataset.role !== role) {\n"
             "    turnMarkerAppend(box, bubble ? bubble.dataset.role : null, role);",
             "  let bubble = utts[utts.length - 1] ?? null;\n"
             "  const afterTool = bubble && box.lastElementChild !== bubble;\n"
             "  if (!bubble || bubble.dataset.role !== role || afterTool) {\n"
             "    if (!bubble || bubble.dataset.role !== role) turnMarkerAppend(box, bubble ? bubble.dataset.role : null, role);")
    # History: tool turns render inline cards; markers only on speaker change.
    page.rep("  turns.forEach((turn, i) => {\n"
             "    turnMarkerAppend(box, i ? turns[i - 1].role : null, turn.role);\n"
             "    historyBubbleAppend(box, turn);\n"
             "  });",
             "  let lastSpeaker = null;\n"
             "  turns.forEach((turn) => {\n"
             "    if (turn.role === 'tool') { toolCardInline(box, turn); return; }\n"
             "    if (turn.role !== lastSpeaker) turnMarkerAppend(box, lastSpeaker, turn.role);\n"
             "    lastSpeaker = turn.role;\n"
             "    historyBubbleAppend(box, turn);\n"
             "  });")
    page.rep("    if (last && last.role === t.role) last.text",
             "    if (last && last.role === t.role && t.role !== 'tool') last.text")
    page.rep("    else acc.push({ ...t, text: displayText(t.text) });",
             "    else acc.push(t.role === 'tool' ? { ...t } : { ...t, text: displayText(t.text) });")
    page.rep("  const sig = turns.map(t => t.role + '\\u0001' + t.text).join('\\u0002');",
             "  const sig = turns.map(t => t.role + '\\u0001' + (t.role === 'tool' ? t.name + (t.done ? '+' : '-') : t.text)).join('\\u0002');")
    page.rep("    for (const t of call.tools) { addToolCall(t.name, t.args, t.id); completeToolCall(t.name, '', null, t.id); }\n", "")
    page.rep("    case 'call.report':\n", "    case 'call.report':\n      liveEndedReason = d.endedReason ?? liveEndedReason;\n")
    # Never rebuild the transcript from a history that has no speech in it
    # (a tool-only update would wipe the live bubbles); live tool cards cover it.
    page.rep("    return acc;\n  }, []);\n",
             "    return acc;\n  }, []);\n"
             "  if (!turns.some((t) => t.role !== 'tool')) return;\n")
    page.rep(anchor, snip('tool-inline.page.js') + snip('live-panel.page.js') + anchor)

    # ---- In-line 2nd page: "Advanced" (simulations + evaluations) ----------
    page.rep('</header>\n',
             '</header>\n\n<nav class="tabs" role="tablist">\n'
             '  <button class="tab-btn on" data-tab="live" role="tab">Live</button>\n'
             '  <button class="tab-btn" data-tab="advanced" role="tab">Advanced</button>\n'
             '  <button class="tab-btn" data-tab="logs" role="tab">Logs</button>\n'
             '</nav>\n')
    page.rep('</main>\n',
             '</main>\n\n<section class="advanced" id="advanced" hidden>\n'
             '  <div class="adv-grid" id="advGrid"></div>\n</section>\n\n'
             '<section class="logs" id="logs" hidden>\n  <div class="logs-list" id="logsList"></div>\n</section>\n')
    page.rep('/* Reset, so the board can be cleared before a screen share. */',
             open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'snippets', 'advanced.css')).read()
             + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'snippets', 'logs.css')).read()
             + '\n/* Reset, so the board can be cleared before a screen share. */')
    page.rep(anchor, snip('logs.page.js') + snip('advanced.page.js') + anchor)
    page.save()

    srv = Doc(srv.path)
    srv.rep('\n// ---- Static + routing', snip('history-turns.server.js') + snip('call-stats.server.js') + snip('advanced.server.js') + snip('logs.server.js') + '\n// ---- Static + routing')
    srv.rep("  if (req.method === 'GET' && req.url === '/last-call') return lastCallHandler(res);",
            "  if (req.method === 'GET' && req.url === '/last-call') return lastCallHandler(res);\n"
            "  if (req.method === 'GET' && req.url.startsWith('/call-stats?')) return callStatsHandler(req, res);\n"
            "  if (req.method === 'GET' && req.url === '/advanced') return advancedHandler(res);\n"
            "  if (req.method === 'GET' && (req.url === '/logs' || req.url.startsWith('/logs?'))) return logsHandler(req, res);")
    srv.sub(r"        turns: \(message\.messages \?\? \[\]\)\n.*?\.map\(\(m\) => \(\{ role: m\.role === 'bot'.*?\}\)\),\n",
            "        turns: historyTurns(message.messages),\n")
    srv.sub(r"        turns: messages\n.*?\.map\(\(m\) => \(\{ role: m\.role === 'bot'.*?\}\)\),\n",
            "        turns: historyTurns(messages),\n        endedAt: call.endedAt ?? null,\n")
    srv.save()

    # Verify every part landed (a marker unique to each edit).
    checks = {
        page.path: ['id="prompt"', 'prompt: {', 'agentPromptShow();', '.prompt-text {',
                    "placeholderShow('prompt');", 'lastCallShow();', 'id="config"', 'function configRender',
                    'class="mid-stack"', 'TURN-BY-TURN', 'Stop speaking plan', 'Start speaking plan', '.cfg-small {', 'function displayText', 'const DEMO_DOMAINS = [', 'text = displayText(text);', "displayText(t.text)", 'function turnMarkerAppend', '.turn-marker {', 'let lastSpeaker = null;', "if (!turns.some((t) => t.role !== 'tool')) return;", 'function toolCardInline', 'function liveTick', 'class="tabs"', 'id="advanced"', 'function tabShow', 'data-tab="logs"', 'id="logsList"', 'function logsLoad', '.logs-row {', 'function advRenderSO', '.adv-grid {', "['Cost per hour'", 'Live call data', 'id="live"', '.live-row {', 'tool-card tool-inline flash', 'const afterTool', 'liveEndedReason = d.endedReason', 'let agentLabel', 'fold consecutive same-speaker', 'Config setup', '.cfg-row {', '<span class="n">04</span>', f'<title>{a.title}</title>']
                   + ([] if a.phone else ['id="talk-btn"', 'webCallStart', '.talk-btn {']),
        srv.path: ['async function lastCallHandler', "req.url === '/last-call'",
                   'async function agentPromptHandler', "req.url === '/agent-prompt'", 'async function voiceLookup', 'stopSpeaking: {', 'startSpeaking: (() =>', 'function historyTurns', 'turns: historyTurns(message.messages)', 'turns: historyTurns(messages)', 'async function callStatsHandler', 'async function advancedHandler', 'async function logsHandler', "req.url.startsWith('/logs?')", 'const structuredOutputs = {', "req.url === '/advanced'", "startsWith('/call-stats?')"],
    }
    if a.logo:
        checks[page.path] += ['class="customer-logo"', '.customer-logo {']
    bad = []
    for path, marks in checks.items():
        text = open(path).read()
        bad += [f'{os.path.basename(path)}: {m}' for m in marks if m not in text]
    leftovers = [w for w in ('Sarah', 'renderRide', 'id="ride"', "case 'ride'", "'ride'", 'outcomeRender', 'id="tools"', "$('tools')")
                 if w in open(page.path).read()]
    if bad or leftovers:
        sys.exit(f'FAILED. missing: {bad} leftovers: {leftovers}')
    print('ok: all default edits applied and verified')


if __name__ == '__main__':
    main()
