
// ---- End call button ----------------------------------------------------------------
// Red "End call" next to Talk to the agent, shown whenever a call is live on the
// board. A web call started from this page hangs up in the browser; any other
// live call of this agent (phone, another tab) is ended by the server through
// the call's controlUrl (POST /end-call).
(() => {
  const btn = document.getElementById('end-btn');
  if (!btn) return;
  let busy = false;
  const live = () => !!(window.__webCall?.active() || (activeCallId && !callEnded));
  setInterval(() => { if (!busy) btn.hidden = !live(); }, 400);
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true; btn.disabled = true; btn.textContent = 'Ending…';
    try {
      if (window.__webCall?.active()) window.__webCall.stop();
      else if (activeCallId) {
        const r = await fetch('/end-call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId: activeCallId }) });
        if (!r.ok) throw new Error('end-call ' + r.status);
      }
    } catch (err) { console.error('end call failed', err); }
    setTimeout(() => { busy = false; btn.disabled = false; btn.textContent = '■ End call'; btn.hidden = !live(); }, 2500);
  });
})();
