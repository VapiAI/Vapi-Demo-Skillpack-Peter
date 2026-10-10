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

def patch_page_dbt(s):
    # "Call DB & Tables" tab: the Postgres tables (columns, row count, latest rows).
    # Not in the tab row (menu-only): opened from the ⋮ menu.
    s = s.replace('<button class="tab-btn" data-tab="dbt" role="tab">', '<button class="tab-btn tab-menu-only" data-tab="dbt" role="tab">')
    if 'id="dbtGrid"' in s:
        s = resync(s, '// ---- Call DB & Tables tab', '// ---- Monitoring & Structured Outputs tab', snip('db-tables.page.js'))
        a = s.index('/* Call DB & Tables tab */'); b = s.index('.dbt tr:last-child td', a); b = s.index('\n', b) + 1
        return s[:a] + snip('db-tables.css').strip() + '\n' + s[b:]
    a = '  <button class="tab-btn" data-tab="toolskb" role="tab">Tools &amp; Knowledge Base</button>\n'
    must(s, a)
    s = s.replace(a, a + '  <button class="tab-btn tab-menu-only" data-tab="dbt" role="tab">Call DB &amp; Tables</button>\n', 1)
    a = '<section class="logs" id="logs" hidden>'
    must(s, a)
    s = s.replace(a, '<section class="advanced" id="dbt" hidden>\n  <div class="adv-grid" id="dbtGrid"></div>\n</section>\n\n' + a, 1)
    a = "  if ($('monso')) $('monso').hidden = name !== 'monso';\n"
    must(s, a)
    s = s.replace(a, a + "  if ($('dbt')) $('dbt').hidden = name !== 'dbt';\n", 1)
    a = "  if (typeof monsoTimer !== 'undefined') clearInterval(monsoTimer);\n"
    must(s, a)
    s = s.replace(a, a + "  if (typeof dbtTimer !== 'undefined') clearInterval(dbtTimer);\n", 1)
    a = "  if (name === 'monso' && typeof monsoLoad === 'function') { monsoLoad(); monsoTimer = setInterval(monsoLoad, 30000); }\n"
    must(s, a)
    s = s.replace(a, a + "  if (name === 'dbt' && typeof dbtLoad === 'function') { dbtLoad(); dbtTimer = setInterval(dbtLoad, 30000); }\n", 1)
    a = '// ---- Monitoring & Structured Outputs tab'
    must(s, a)
    s = s.replace(a, snip('db-tables.page.js').strip() + '\n\n' + a, 1)
    a = '</style>'
    must(s, a)
    s = s.replace(a, snip('db-tables.css').strip() + '\n' + a, 1)
    return s

def patch_page_postcall(s):
    # Post-call results (structured outputs, monitor alerts) in the transcript.
    if '// ---- Post-call results in the transcript' in s:
        s = resync(s, '// ---- Post-call results in the transcript', '// ---- end post-call', snip('postcall.page.js').replace('// ---- end post-call', '').rstrip())
        a = s.index('/* Post-call results in the transcript */'); b = s.index('.pc-chip.hit {', a); b = s.index('\n', b) + 1
        return s[:a] + snip('postcall.css').strip() + '\n' + s[b:]
    a = '// ---- Call DB & Tables tab'
    must(s, a)
    s = s.replace(a, snip('postcall.page.js').strip() + '\n\n' + a, 1)
    a = '</style>'
    must(s, a)
    s = s.replace(a, snip('postcall.css').strip() + '\n' + a, 1)
    a = "    case 'tool.completed':\n"
    must(s, a)
    s = s.replace(a, "    case 'call.structured':\n      postCallStructured(d);\n      break;\n    case 'call.monitor':\n      postCallMonitor(d);\n      break;\n" + a, 1)
    a = "    if (call.turns.length) transcriptHistoryRender(call.turns);\n"
    must(s, a)
    s = s.replace(a, a + "    if (call.structuredOutputs) postCallStructured({ callId: call.callId, outputs: call.structuredOutputs });\n", 1)
    return s

def patch_page_hitl(s):
    # "Human in the Loop" tab + live transcript flag.
    if 'id="hitlGrid"' in s:
        s = resync(s, '// ---- Human in the Loop tab + live flag', '// ---- end hitl', snip('hitl.page.js').replace('// ---- end hitl', '').rstrip())
        a = s.index('/* Human in the Loop */'); b = s.index('.hitl-re {', a); b = s.index('\n', b) + 1
        return s[:a] + snip('hitl.css').strip() + '\n' + s[b:]
    a = '  <button class="tab-btn" data-tab="toolskb" role="tab">Tools &amp; Knowledge Base</button>\n'
    must(s, a)
    s = s.replace(a, a + '  <button class="tab-btn" data-tab="hitl" role="tab">Human in the Loop</button>\n', 1)
    a = '<section class="logs" id="logs" hidden>'
    must(s, a)
    s = s.replace(a, '<section class="advanced" id="hitl" hidden>\n  <div class="adv-grid" id="hitlGrid"></div>\n</section>\n\n' + a, 1)
    a = "  if ($('dbt')) $('dbt').hidden = name !== 'dbt';\n"
    must(s, a)
    s = s.replace(a, a + "  if ($('hitl')) $('hitl').hidden = name !== 'hitl';\n", 1)
    a = "  if (typeof dbtTimer !== 'undefined') clearInterval(dbtTimer);\n"
    must(s, a)
    s = s.replace(a, a + "  if (typeof hitlTimer !== 'undefined') clearInterval(hitlTimer);\n", 1)
    a = "  if (name === 'dbt' && typeof dbtLoad === 'function') { dbtLoad(); dbtTimer = setInterval(dbtLoad, 30000); }\n"
    must(s, a)
    s = s.replace(a, a + "  if (name === 'hitl' && typeof hitlLoad === 'function') { hitlLoad(); hitlTimer = setInterval(hitlLoad, 10000); }\n", 1)
    a = '// ---- Call DB & Tables tab'
    must(s, a)
    s = s.replace(a, snip('hitl.page.js').strip() + '\n\n' + a, 1)
    a = '</style>'
    must(s, a)
    s = s.replace(a, snip('hitl.css').strip() + '\n' + a, 1)
    a = "    case 'call.structured':\n"
    must(s, a)
    s = s.replace(a, "    case 'hitl.flag':\n      hitlFlagShow(d);\n      break;\n" + a, 1)
    return s

def patch_server_hitl(s):
    if 'function hitlOnTranscript' in s:
        return resync(s, '// ---- Human in the loop (transcripts + regex watcher)', '\n// ---- Static + routing', snip('hitl.server.js'))
    a = '\n// ---- Static + routing'
    must(s, a)
    s = s.replace(a, snip('hitl.server.js') + a, 1)
    if "req.url.startsWith('/hitl/')" not in s:
        a = "  if (req.method === 'GET' && req.url === '/monitoring') return monitoringHandler(res);"
        must(s, a)
        s = s.replace(a, a + "\n  if (req.url === '/hitl' || req.url.startsWith('/hitl/')) return hitlHandler(req, res);", 1)
    if 'hitlOnTranscript(message);' not in s:
        a = "  if (message?.type === 'transcript') prefetchFromTranscript(" if "prefetchFromTranscript(" in s else "  storeEndOfCall(message);"
        must(s, a)
        s = s.replace(a, "  hitlOnTranscript(message);  // transcripts table + swear/anger regex → human_in_the_loop\n" + a, 1)
    return s

def patch_server_dbt(s):
    if 'async function dbTablesHandler' in s:
        return resync(s, '// ---- Call DB & Tables tab', '\n// ---- Static + routing', snip('db-tables.server.js'))
    a = '\n// ---- Static + routing'
    must(s, a)
    s = s.replace(a, snip('db-tables.server.js') + a, 1)
    if "req.url === '/db-tables'" not in s:
        a = "  if (req.method === 'GET' && req.url === '/monitoring') return monitoringHandler(res);"
        must(s, a)
        s = s.replace(a, a + "\n  if (req.method === 'GET' && req.url === '/db-tables') return dbTablesHandler(res);", 1)
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
    page = patch_page_hitl(patch_page_postcall(patch_page_dbt(patch_page(open(pp).read()))))
    srv = patch_server_hitl(patch_server_dbt(patch_server(open(sp).read())))
    marks = ['tab-menu-only" data-tab="dbt"', '.tab-btn.tab-menu-only {', 'data-tab="hitl"', 'id="hitlGrid"', 'async function hitlLoad', "case 'hitl.flag':", '.hitl-re {', 'function postCallStructured', "case 'call.structured':", 'postCallStructured({ callId: call.callId', '.pc-chip.hit {', 'data-tab="dbt"', 'id="dbtGrid"', 'async function dbtLoad', '.dbt-wrap {', "'End-of-call logs'", "'Stored structured outputs'", 'data-tab="monso"', 'id="monsoGrid"', 'function monsoLoad', 'Simulations &amp; Test']
    smarks = ['function hitlOnTranscript', 'hitlOnTranscript(message);', "req.url.startsWith('/hitl/')", 'CREATE TABLE IF NOT EXISTS human_in_the_loop', "emitEvent('call.structured'", "emitEvent('call.monitor'", 'async function dbTablesHandler', "req.url === '/db-tables'", 'CREATE TABLE IF NOT EXISTS end_of_call_reports', 'async function storeCallLog', 'CREATE TABLE IF NOT EXISTS structured_output_results', 'function storeStructuredOutputs', 'async function monitoringHandler', 'async function monitorWebhookHandler', 'storeEndOfCall(message);', "req.url === '/monitoring'"]
    missing = [m for m in marks if m not in page] + [m for m in smarks if m not in srv]
    # Never wipe another patch's styles (an earlier re-sync dropped the ⋮ menu CSS).
    if 'id="navMenuBtn"' in page and '.nav-menu {' not in page:
        missing.append('.nav-menu { (menu styles lost)')
    if missing or "advRenderSO(data, $('advGrid'))" in page:
        raise SystemExit(f'monitoring patch FAILED, missing: {missing}')
    open(pp, 'w').write(page); open(sp, 'w').write(srv)
    patch_package(project)

if __name__ == '__main__':
    apply(sys.argv[1])
    print('ok: monitoring tab + webhook store applied')
