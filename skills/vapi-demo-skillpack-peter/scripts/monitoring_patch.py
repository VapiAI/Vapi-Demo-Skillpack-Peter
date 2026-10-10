"""Rename the "Advanced" tab to "Simulations & Test" and add a "Monitoring &
Structured Outputs" tab (snippets/monitoring.*), with the webhook store
(Postgres table webhook_events) on the server.

Used by apply-defaults.py and runnable on an existing demo:
    python3 monitoring_patch.py <project_dir>
Idempotent. Also adds "pg" to package.json dependencies.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
snip = lambda f: open(os.path.join(HERE, 'snippets', f)).read()

def must(s, a):
    if a not in s:
        raise SystemExit(f'monitoring patch: anchor not found: {a[:80]!r}')

def resync(s, start_marker, end_marker, snippet):
    # Already-patched project: replace the old snippet block with the current one.
    a = s.index(start_marker)
    b = s.index(end_marker, a)
    return s[:a] + snippet.strip() + '\n\n' + s[b:]

def patch_page(s):
    s = s.replace('<button class="tab-btn" data-tab="advanced" role="tab">Advanced</button>',
                  '<button class="tab-btn" data-tab="advanced" role="tab">Simulations &amp; Test</button>')
    if 'id="monsoGrid"' in s:
        return resync(s, '// ---- Monitoring & Structured Outputs tab', 'function tabShow(name) {', snip('monitoring.page.js'))
    a = '  <button class="tab-btn" data-tab="logs" role="tab">Logs</button>\n'
    must(s, a)
    s = s.replace(a, a + '  <button class="tab-btn" data-tab="monso" role="tab">Monitoring &amp; Structured Outputs</button>\n', 1)
    a = '<section class="logs" id="logs" hidden>'
    must(s, a)
    s = s.replace(a, '<section class="advanced" id="monso" hidden>\n  <div class="adv-grid" id="monsoGrid"></div>\n</section>\n\n' + a, 1)
    # Structured outputs card moves to the new tab.
    a = "    advRenderSO(data, $('advGrid'));\n"
    must(s, a)
    s = s.replace(a, '', 1)
    a = "  if ($('toolskb')) $('toolskb').hidden = name !== 'toolskb';\n"
    must(s, a)
    s = s.replace(a, a + "  if ($('monso')) $('monso').hidden = name !== 'monso';\n", 1)
    a = "  if (typeof tkbTimer !== 'undefined') clearInterval(tkbTimer);\n"
    must(s, a)
    s = s.replace(a, a + "  if (typeof monsoTimer !== 'undefined') clearInterval(monsoTimer);\n", 1)
    a = "  if (name === 'toolskb' && typeof tkbLoad === 'function') { tkbLoad(); tkbTimer = setInterval(tkbLoad, 30000); }\n"
    must(s, a)
    s = s.replace(a, a + "  if (name === 'monso' && typeof monsoLoad === 'function') { monsoLoad(); monsoTimer = setInterval(monsoLoad, 30000); }\n", 1)
    a = 'function tabShow(name) {'
    must(s, a)
    s = s.replace(a, snip('monitoring.page.js').strip() + '\n\n' + a, 1)
    return s

def patch_server(s):
    if 'async function monitoringHandler' in s:
        return resync(s, '// ---- Webhook store (Postgres)', '\n// ---- Static + routing', snip('monitoring.server.js'))
    a = '\n// ---- Static + routing'
    must(s, a)
    s = s.replace(a, snip('monitoring.server.js') + a, 1)
    a = "  if (req.method === 'GET' && req.url === '/agent-prompt') return agentPromptHandler(res);"
    must(s, a)
    s = s.replace(a, a + "\n  if (req.method === 'GET' && req.url === '/monitoring') return monitoringHandler(res);"
                     "\n  if (req.method === 'POST' && req.url.startsWith('/webhooks/monitor')) return monitorWebhookHandler(req, res);", 1)
    # Store end-of-call reports (real AND simulation calls) before the test-call drop.
    a = "  if (isTestCall(message?.call)) {"
    must(s, a)
    s = s.replace(a, "  storeEndOfCall(message);  // webhook_events table (no-op without DATABASE_URL)\n" + a, 1)
    return s

def patch_package(project):
    p = os.path.join(project, 'package.json')
    if not os.path.exists(p):
        return
    j = json.load(open(p))
    j.setdefault('dependencies', {}).setdefault('pg', '^8.13.0')
    json.dump(j, open(p, 'w'), indent=2)

def apply(project):
    pp, sp = os.path.join(project, 'public', 'index.html'), os.path.join(project, 'server.mjs')
    page, srv = patch_page(open(pp).read()), patch_server(open(sp).read())
    marks = ["'End-of-call logs'", "'Stored structured outputs'", 'data-tab="monso"', 'id="monsoGrid"', 'function monsoLoad', 'Simulations &amp; Test']
    smarks = ['CREATE TABLE IF NOT EXISTS end_of_call_reports', 'async function storeCallLog', 'CREATE TABLE IF NOT EXISTS structured_output_results', 'function storeStructuredOutputs', 'async function monitoringHandler', 'async function monitorWebhookHandler', 'storeEndOfCall(message);', "req.url === '/monitoring'"]
    missing = [m for m in marks if m not in page] + [m for m in smarks if m not in srv]
    if missing or "advRenderSO(data, $('advGrid'))" in page:
        raise SystemExit(f'monitoring patch FAILED, missing: {missing}')
    open(pp, 'w').write(page); open(sp, 'w').write(srv)
    patch_package(project)

if __name__ == '__main__':
    apply(sys.argv[1])
    print('ok: monitoring tab + webhook store applied')
