// ---- Post-call results in the transcript ---------------------------------------------
// Structured outputs (and monitor alerts about a call) arrive after the call ends;
// they're added at the bottom of that call's transcript as event-log entries.
// Live via 'call.structured' / 'call.monitor', and for the last call from
// /last-call's structuredOutputs. One entry per call per kind.
const postCallShown = new Set();
function postCallEntry(callId, kind, title, chip, body) {
  if (!callId || (typeof activeCallId !== 'undefined' && activeCallId && callId !== activeCallId)) return;
  const key = callId + ':' + kind + ':' + title;
  if (postCallShown.has(key)) return;
  postCallShown.add(key);
  panelReady('transcript');
  const box = $('transcript');
  const el = document.createElement('div');
  el.className = 'tool-card tool-inline tool-log post-call done flash';
  const row = toolLogLine('pc', null, title, chip, kind === 'monitor' ? 'alert' : 'result');
  row.querySelector('.tl-t').textContent = 'post-call';
  el.appendChild(row);
  el.appendChild(body);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
function postCallStructured(d) {
  const list = Array.isArray(d.outputs) ? d.outputs : Object.values(d.outputs ?? {}).map((v) => ({ name: v?.name, result: v?.result }));
  if (!list.length) return;
  const chips = document.createElement('div');
  chips.className = 'tl-args pc-chips';
  for (const o of list) {
    const v = typeof o.result === 'object' && o.result !== null ? JSON.stringify(o.result) : String(o.result);
    const c = document.createElement('span');
    c.className = 'pc-chip' + (o.result === true ? ' hit' : '');
    c.textContent = (o.name ?? 'output') + ': ' + v;
    chips.appendChild(c);
  }
  postCallEntry(d.callId, 'structured', 'Structured outputs', 'POST-CALL', chips);
}
function postCallMonitor(d) {
  const body = document.createElement('div');
  body.className = 'tl-args';
  body.textContent = d.detail || 'Monitor flagged this call.';
  postCallEntry(d.callId, 'monitor', 'Monitor · ' + (d.title || 'alert'), (d.severity || 'ALERT').toUpperCase(), body);
}
// ---- end post-call
