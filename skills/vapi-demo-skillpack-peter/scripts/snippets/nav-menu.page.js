
// ---- ⋮ menu (header, right of Reset) -----------------------------------------------
// Dropdown with the page's tabs (navigation) and quick actions: open this agent
// in the Vapi dashboard, copy the current call ID. Closes on outside click / Esc.
(() => {
  const btn = document.getElementById('navMenuBtn');
  const menu = document.getElementById('navMenu');
  if (!btn || !menu) return;
  let agentId = null;
  fetch('/agent-prompt').then((r) => (r.ok ? r.json() : null)).then((a) => { agentId = a?.id ?? null; }).catch(() => {});
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const item = (label, icon, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'nav-item'; b.setAttribute('role', 'menuitem');
    b.innerHTML = '<span class="nav-ic"></span><span class="nav-lbl"></span>';
    b.querySelector('.nav-ic').innerHTML = icon;
    b.querySelector('.nav-lbl').textContent = label;
    b.addEventListener('click', () => { close(); onClick(); });
    return b;
  };
  const ICON = {
    tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  };
  const build = () => {
    menu.innerHTML = '';
    menu.appendChild(Object.assign(document.createElement('div'), { className: 'nav-head', textContent: 'Go to' }));
    for (const t of document.querySelectorAll('.tab-btn')) {
      const it = item(t.textContent.trim(), ICON.tab, () => tabShow(t.dataset.tab));
      if (t.classList.contains('on')) it.classList.add('on');
      menu.appendChild(it);
    }
    menu.appendChild(Object.assign(document.createElement('div'), { className: 'nav-sep' }));
    menu.appendChild(item('Open agent in Vapi', ICON.open, () => {
      if (agentId) window.open('https://dashboard.vapi.ai/assistants/' + agentId, '_blank', 'noopener');
    }));
    const cid = (typeof activeCallId !== 'undefined' && activeCallId) || null;
    const copy = item(cid ? 'Copy call ID' : 'Copy call ID (no call)', ICON.copy, () => {
      if (cid) navigator.clipboard?.writeText(cid).catch(() => {});
    });
    if (!cid) copy.disabled = true;
    menu.appendChild(copy);
  };
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (menu.hidden) { build(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); } else close();
  });
  document.addEventListener('click', (ev) => { if (!menu.hidden && !menu.contains(ev.target)) close(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
})();
