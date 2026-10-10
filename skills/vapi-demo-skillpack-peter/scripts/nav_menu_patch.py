"""Add the ⋮ menu (tabs + quick actions) to the header, right of Reset.
Used by apply-defaults.py and runnable on an existing demo:
    python3 nav_menu_patch.py <project_dir>
Idempotent (re-syncs the snippet if already present).
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
snip = lambda f: open(os.path.join(HERE, 'snippets', f)).read()

BTN = ('\n  <div class="nav-wrap">\n'
       '    <button class="nav-menu-btn" id="navMenuBtn" type="button" aria-haspopup="menu" aria-expanded="false" title="Menu">'
       '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>\n'
       '    <div class="nav-menu" id="navMenu" role="menu" hidden></div>\n'
       '  </div>')

def must(s, a):
    if a not in s:
        raise SystemExit(f'nav menu patch: anchor not found: {a[:80]!r}')

def patch_page(s):
    # Logs is menu-only (not in the tab row); the ⋮ menu lists only menu-only pages.
    s = s.replace('<button class="tab-btn" data-tab="logs" role="tab">Logs</button>', '<button class="tab-btn tab-menu-only" data-tab="logs" role="tab">Logs</button>')
    if 'id="navMenuBtn"' in s:
        a = s.index('// ---- ⋮ menu (header, right of Reset)'); b = s.index('})();', a) + 5
        s = s[:a] + snip('nav-menu.page.js').strip() + s[b:]
        if '/* ⋮ menu in the header */' in s:
            a = s.index('/* ⋮ menu in the header */'); b = s.index('.nav-sep {', a); b = s.index('\n', b) + 1
            return s[:a] + snip('nav-menu.css').strip() + '\n' + s[b:]
        # Styles missing (an older re-sync wiped them): add them back.
        return s.replace('</style>', snip('nav-menu.css').strip() + '\n</style>', 1)
    a = '    Reset\n  </button>\n</header>'
    must(s, a)
    s = s.replace(a, '    Reset\n  </button>' + BTN + '\n</header>', 1)
    a = '</style>'
    must(s, a)
    s = s.replace(a, snip('nav-menu.css').strip() + '\n' + a, 1)
    a = "\n$('assemblyToggle')"
    must(s, a)
    s = s.replace(a, '\n' + snip('nav-menu.page.js').strip() + '\n' + a, 1)
    return s

def patch_server(s):
    if "id: a.id ?? null,\n      name: a.name ?? null," in s:
        return s
    a = '      name: a.name ?? null,\n      firstMessage: a.firstMessage ?? null,'
    must(s, a)
    return s.replace(a, '      id: a.id ?? null,\n' + a, 1)

def apply(project):
    pp, sp = os.path.join(project, 'public', 'index.html'), os.path.join(project, 'server.mjs')
    page, srv = patch_page(open(pp).read()), patch_server(open(sp).read())
    missing = [m for m in ('id="navMenuBtn"', 'id="navMenu"', '.nav-menu {', "getElementById('navMenuBtn')", 'tab-menu-only" data-tab="logs"', ".tab-btn.tab-menu-only')") if m not in page]
    missing += [m for m in ('id: a.id ?? null,',) if m not in srv]
    if missing:
        raise SystemExit(f'nav menu patch FAILED, missing: {missing}')
    open(pp, 'w').write(page); open(sp, 'w').write(srv)

if __name__ == '__main__':
    apply(sys.argv[1])
    print('ok: ⋮ menu applied')
