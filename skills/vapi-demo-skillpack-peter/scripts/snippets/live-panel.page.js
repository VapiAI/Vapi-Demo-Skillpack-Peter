// ---- Live call data (panel 03) ------------------------------------------------
// Derived from what is already on the board, re-read every second, so it can
// never disagree with the transcript: status pill, active call, turn bubbles
// and inline tool cards. Start/end come from the first event seen (live) or
// from the Vapi call record (last call).
let liveCallId = null;
let liveStart = null;
let liveEnd = null;
let liveEndedReason = null;
let liveSig = '';
let liveStats = null;      // { cost, promptTokens, completionTokens, ... } from /call-stats
let liveStatsBusy = false;
let liveStatsFinal = false; // stop polling once an ended call has its final cost

// Real call ids only: synthetic replays (try-it) have no Vapi record.
function liveStatsPoll() {
  if (!activeCallId || liveStatsBusy || liveStatsFinal || !/^[0-9a-f-]{36}$/i.test(activeCallId)) return;
  liveStatsBusy = true;
  const id = activeCallId;
  fetch('/call-stats?id=' + encodeURIComponent(id))
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s || id !== activeCallId) return;
      liveStats = s;
      if (s.endedReason) liveEndedReason = s.endedReason;
      if (s.status === 'ended' && s.cost != null) liveStatsFinal = true;
    })
    .catch(() => {})
    .finally(() => { liveStatsBusy = false; });
}

function liveFmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function liveTick() {
  const box = $('live');
  if (!box) return;
  if (!activeCallId) {
    liveCallId = null; liveStart = null; liveEnd = null; liveEndedReason = null;
    liveStats = null; liveStatsFinal = false;
    if (liveSig !== 'idle') { liveSig = 'idle'; placeholderShow('live'); }
    return;
  }
  if (activeCallId !== liveCallId) {
    liveCallId = activeCallId; liveStart = Date.now(); liveEnd = null; liveEndedReason = null;
    liveStats = null; liveStatsFinal = false;
  }
  liveStatsPoll();
  const status = ($('callStatus')?.querySelector('.st-text')?.textContent || '').trim();
  const ended = callEnded || /ended|last call/i.test(status);
  if (ended && !liveEnd) liveEnd = Date.now();
  if (ended) document.querySelectorAll('#transcript .tool-card:not(.done)').forEach((c) => {
    c.classList.add('done');
    const ms = c.querySelector('.ms');
    if (ms) ms.textContent = 'done';
  });
  const t = $('transcript');
  const caller = t.querySelectorAll('.utterance.user').length;
  const agent = t.querySelectorAll('.utterance.assistant').length;
  const tools = t.querySelectorAll('.tool-card').length;
  const fmtInt = (n) => Number(n).toLocaleString();
  const st = liveStats;
  const tokens = st && (st.promptTokens != null || st.completionTokens != null)
    ? fmtInt((st.promptTokens ?? 0) + (st.completionTokens ?? 0))
      + ' (' + fmtInt(st.promptTokens ?? 0) + ' in · ' + fmtInt(st.completionTokens ?? 0) + ' out)'
    : '—';
  // Prefer Vapi's own timestamps, so a page opened mid-call shows true elapsed time.
  const startMs = (st && st.startedAt && Date.parse(st.startedAt)) || liveStart;
  const endMs = (st && st.endedAt && Date.parse(st.endedAt)) || (ended ? liveEnd : null);
  const rows = [
    ['Status', status || '—'],
    ['Duration', startMs ? liveFmtDuration((endMs ?? Date.now()) - startMs) : '—'],
    ['Turns', (caller + agent) + ' (Caller ' + caller + ' · Assistant ' + agent + ')'],
    ['Cost', st && st.cost != null ? '$' + Number(st.cost).toFixed(4) : '—'],
    // Cost per hour = final cost / call duration, so it reads as a rate a buyer
    // can compare against staffing. Only once Vapi has published the cost.
    ['Cost per hour', st && st.cost != null && startMs && (endMs ?? Date.now()) - startMs > 0
      ? '$' + (Number(st.cost) / (((endMs ?? Date.now()) - startMs) / 3600000)).toFixed(2) + '/hr'
      : '—'],
    ['Tokens', tokens],
    ['Tool calls', String(tools)],
    ['Call ID', activeCallId],
  ];
  if (liveEndedReason) rows.push(['Ended reason', String(liveEndedReason).replace(/-/g, ' ')]);
  const sig = JSON.stringify(rows);
  if (sig === liveSig) return;
  liveSig = sig;
  panelReady('live');
  box.innerHTML = '';
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'live-row';
    row.innerHTML = '<span class="k"></span><span class="v"></span>';
    row.querySelector('.k').textContent = k;
    row.querySelector('.v').textContent = v;
    box.appendChild(row);
  }
}
setInterval(liveTick, 1000);

