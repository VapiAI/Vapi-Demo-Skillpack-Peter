"""Swap the transcript's tool cards for event-log entries (snippets/tool-log.*).

Used by apply-defaults.py and runnable on an existing demo:
    python3 tool_log_patch.py <project_dir>
Idempotent: a page that already has toolLogCard is left alone.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
snip = lambda f: open(os.path.join(HERE, 'snippets', f)).read()

def drop_fn(s, name):
    m = re.search(r'\nfunction ' + name + r'\(.*?\n}\n', s, re.S)
    if not m:
        raise SystemExit(f'tool-log patch: function {name} not found')
    return s[:m.start()] + '\n' + s[m.end():]

def sync_snippets(s):
    # Page already patched: refresh the tool-log JS + CSS blocks to the current snippets.
    a = s.index('// Tool calls render INLINE in the live transcript as event-log entries')
    b = s.index('\nfunction toolCardInline(', a)
    b = s.index('\n}\n', b) + 3
    if 'function toolBackgroundShow(' in s[b:b + 4000]:
        b = s.index('\n}\n', s.index('function toolBackgroundShow(', b)) + 3
    s = s[:a] + snip('tool-log.page.js').lstrip('\n') + s[b:]
    a = s.index('/* Tool calls in the live transcript: event-log entries. */')
    b = s.index('#transcript .tool-inline .name', a)
    return s[:a] + snip('tool-log.css').strip() + '\n' + s[b:]

def patch_background_case(s):
    if "case 'tool.background':" in s:
        return s
    return s.replace("    case 'tool.completed':\n", "    case 'tool.background':\n      toolBackgroundShow(d);\n      break;\n    case 'tool.completed':\n", 1)

def patch_page(s):
    if 'function toolLogCard' in s:
        return patch_background_case(sync_snippets(s))
    for fn in ('addToolCall', 'completeToolCall', 'toolCardInline'):
        s = drop_fn(s, fn)
    # Comment header that introduced the old inline card, if present.
    s = s.replace('// Tool calls render INLINE in the transcript, where they happened in the\n'
                  '// conversation, as a compact card between the speech bubbles.\n', '')
    anchor = '\nfunction transcriptSettle() {'
    i = s.index('// Settle every in-flight bubble') if '// Settle every in-flight bubble' in s else s.index(anchor)
    s = s[:i] + snip('tool-log.page.js').lstrip('\n') + '\n' + s[i:]
    s = s.replace('      addToolCall(d.name, d.args, d.toolCallId);', '      addToolCall(d.name, d.args, d.toolCallId, d.sec);')
    s = s.replace('      completeToolCall(d.name, d.result, d.ms, d.toolCallId);', '      completeToolCall(d.name, d.result, d.ms, d.toolCallId, d.sec);')
    s = patch_background_case(s)
    css_anchor = '#transcript .tool-inline { margin: 2px 28px; font-size: 12.5px; }'
    s = s.replace(css_anchor, css_anchor + '\n' + snip('tool-log.css').strip())
    return s

def patch_server(s):
    if 'sec: typeof m.secondsFromStart' in s:
        return s
    s = s.replace("      emitEvent('tool.called', { callId, toolCallId: tc.id, name, args });",
                  "      emitEvent('tool.called', { callId, toolCallId: tc.id, name, args, sec: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null });")
    s = s.replace("        result: m.result ?? '',\n",
                  "        result: m.result ?? '',\n        sec: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null,\n")
    s = s.replace("      const t = { role: 'tool', id: tc.id ?? null, name: tc.function?.name ?? tc.name ?? tc.type ?? 'tool', args, result: null, done: false };",
                  "      const t = { role: 'tool', id: tc.id ?? null, name: tc.function?.name ?? tc.name ?? tc.type ?? 'tool', args, result: null, done: false, sec: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null };")
    s = s.replace("        t.done = true;\n      }",
                  "        t.done = true;\n        t.resultSec = typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null;\n"
                  "        if (t.sec != null && t.resultSec != null) t.ms = Math.round((t.resultSec - t.sec) * 1000);\n      }")
    return s

def patch_history(s):
    # Background results injected as system messages show up as their own turn.
    if '[Background lookup result]' in s:
        return s
    a = "    if (m.role === 'tool_call_result') {\n      const t = (open[m.name ?? '?'] ?? []).shift();"
    if a not in s:
        raise SystemExit('tool-log patch: historyTurns anchor not found')
    return s.replace(a, "    if (m.role === 'system' && typeof (m.message ?? m.content) === 'string' && (m.message ?? m.content).startsWith('[Background lookup result]')) {\n"
        "      const txt = (m.message ?? m.content);\n"
        "      const head = txt.split('\\n')[0];\n"
        "      turns.push({ role: 'tool', background: true, name: (head.match(/\\] (\\S+)/) ?? [])[1] ?? 'lookup', query: (head.match(/\"([^\"]*)\"/) ?? [])[1] ?? '', result: txt.slice(head.length + 1), sec: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null });\n"
        "    }\n" + a)

PAGE_MARKS = ["case 'tool.background':", 'function toolBackgroundShow', 'if (turn.background)', 'function toolLogCard', 'function toolLogResult', 'addToolCall(d.name, d.args, d.toolCallId, d.sec)',
              'completeToolCall(d.name, d.result, d.ms, d.toolCallId, d.sec)', '.tool-log .tl-chip.tool']
SERVER_MARKS = ["startsWith('[Background lookup result]')", "args, sec: typeof m.secondsFromStart", "        sec: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : null,",
                "done: false, sec: typeof m.secondsFromStart", 't.resultSec = typeof m.secondsFromStart']

def apply(project):
    pp, sp = os.path.join(project, 'public', 'index.html'), os.path.join(project, 'server.mjs')
    page, srv = patch_page(open(pp).read()), patch_history(patch_server(open(sp).read()))
    missing = [m for m in PAGE_MARKS if m not in page] + [m for m in SERVER_MARKS if m not in srv]
    if missing or page.count('function addToolCall(') != 1 or page.count('function toolCardInline(') != 1:
        raise SystemExit(f'tool-log patch FAILED, missing: {missing}')
    open(pp, 'w').write(page); open(sp, 'w').write(srv)

if __name__ == '__main__':
    apply(sys.argv[1])
    print('ok: tool-log transcript entries applied')
