"""Add the red End call button next to Talk to the agent (snippets/end-call.*).

Used by apply-defaults.py and runnable on an existing demo:
    python3 end_call_patch.py <project_dir>
Idempotent.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
snip = lambda f: open(os.path.join(HERE, 'snippets', f)).read()

def must(s, a):
    if a not in s:
        raise SystemExit(f'end-call patch: anchor not found: {a[:70]!r}')

def patch_page(s):
    if 'id="end-btn"' in s:
        return s
    talk = '<button class="talk-btn" id="talk-btn">&#127897; Talk to the agent</button>'
    btn = '\n  <button class="end-btn" id="end-btn" hidden>&#9632; End call</button>'
    if talk in s:
        s = s.replace(talk, talk + btn, 1)
        # Talk button shows "On call" while live; the red button ends it.
        a = "    talkBtn.classList.add('live');\n    talkBtn.textContent = '⏹ End call';"
        must(s, a)
        s = s.replace(a, "    talkBtn.classList.add('live');\n    talkBtn.disabled = true;\n    talkBtn.textContent = '● On call';", 1)
        a = "  talkBtn.addEventListener('click', () => {"
        must(s, a)
        s = s.replace(a, "  window.__webCall = { active: () => callActive, stop: () => vapi?.stop() };\n" + a, 1)
    else:
        a = '</a>\n'
        i = s.index('<a class="phone"')
        j = s.index('</a>', i) + 4
        s = s[:j] + btn + s[j:]
    a = '</style>'
    must(s, a)
    s = s.replace(a, snip('end-call.css').strip() + '\n' + a, 1)
    a = '\n$(\'assemblyToggle\')'
    must(s, a)
    s = s.replace(a, '\n' + snip('end-call.page.js').strip() + '\n' + a, 1)
    return s

def patch_server(s):
    if 'async function endCallHandler' in s:
        return s
    a = '\n// ---- Static + routing'
    must(s, a)
    s = s.replace(a, snip('end-call.server.js') + a, 1)
    a = "  if (req.method === 'GET' && req.url === '/agent-prompt') return agentPromptHandler(res);"
    must(s, a)
    s = s.replace(a, a + "\n  if (req.method === 'POST' && req.url === '/end-call') return endCallHandler(req, res);", 1)
    return s

SERVER_MARKS = ['async function endCallHandler', "req.url === '/end-call'"]

def apply(project):
    pp, sp = os.path.join(project, 'public', 'index.html'), os.path.join(project, 'server.mjs')
    page, srv = patch_page(open(pp).read()), patch_server(open(sp).read())
    missing = [m for m in ['id="end-btn"', '.end-btn {', "getElementById('end-btn')"] if m not in page] + [m for m in SERVER_MARKS if m not in srv]
    if missing:
        raise SystemExit(f'end-call patch FAILED, missing: {missing}')
    open(pp, 'w').write(page); open(sp, 'w').write(srv)

if __name__ == '__main__':
    apply(sys.argv[1])
    print('ok: end call button applied')
