// ---- Call viewer (modal) ---------------------------------------------------------
// Vapi-dashboard-style view of one call: header (date, type, call id, agent,
// ended reason, duration, cost), speaker lanes (assistant / user / silence /
// tool calls) with a playhead synced to the recording, speed + download, and
// the transcript. Evals (text-only) open the same frame with the scripted
// conversation and the judge's verdict.
const cvFmt = (s) => { s = Math.max(0, Math.round(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const cvShort = (id) => (id && id.length > 12 ? id.slice(0, 4) + '…' + id.slice(-5) : id || '');
const cvType = (t) => ({ webCall: 'webCall', 'vapi.websocketCall': 'Simulation · voice', inboundPhoneCall: 'Inbound call', outboundPhoneCall: 'Outbound call' }[t] || t || 'call');
function cvCopy(text) { try { navigator.clipboard.writeText(text); } catch {} }

function cvShell(onClose) {
  const back = advEl('div', 'cv-back');
  const box = advEl('div', 'cv-box');
  const close = advEl('button', 'cv-x', '✕');
  close.title = 'Close';
  box.appendChild(close);
  const body = advEl('div', 'cv-body', 'Loading…');
  box.appendChild(body);
  back.appendChild(box);
  const done = () => { back.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = (e) => { if (e.key === 'Escape') done(); };
  close.addEventListener('click', done);
  back.addEventListener('click', (e) => { if (e.target === back) done(); });
  document.addEventListener('keydown', esc);
  document.body.appendChild(back);
  return body;
}

function cvHeader(body, line1, line2) {
  const h = advEl('div', 'cv-head');
  const a = advEl('div', 'cv-h1');
  for (const part of line1) a.appendChild(part);
  const b = advEl('div', 'cv-h2');
  for (const part of line2) b.appendChild(part);
  h.appendChild(a); h.appendChild(b);
  body.appendChild(h);
}
function cvIdChip(label, id) {
  const s = advEl('span', 'cv-id');
  s.appendChild(advEl('span', 'cv-muted', label));
  s.appendChild(advEl('code', null, cvShort(id)));
  const c = advEl('button', 'cv-copy', '⧉');
  c.title = 'Copy ' + id;
  c.addEventListener('click', () => { cvCopy(id); c.textContent = '✓'; setTimeout(() => (c.textContent = '⧉'), 1200); });
  s.appendChild(c);
  return s;
}
function cvStat(label, value) {
  const s = advEl('span', 'cv-stat');
  s.appendChild(advEl('span', 'cv-muted', label));
  s.appendChild(advEl('span', null, value));
  return s;
}

async function openCallViewer(callId, opts = {}) {
  const body = cvShell(() => audio && audio.pause());
  let audio = null;
  let d;
  try {
    const r = await fetch('/call-detail?id=' + encodeURIComponent(callId));
    if (!r.ok) throw new Error('call ' + r.status);
    d = await r.json();
  } catch { body.textContent = 'Could not load this call.'; return; }
  body.textContent = '';
  const when = new Date(d.startedAt || d.createdAt);
  const tz = when.toLocaleTimeString([], { timeZoneName: 'short' }).split(' ').pop();
  cvHeader(body,
    [advEl('span', 'cv-date', when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' '),
     advEl('span', 'cv-muted', tz + ' '), advEl('span', 'cv-type', cvType(d.type)), cvIdChip('Call ID:', d.id)],
    [cvIdChip((d.assistantName || agentLabel || 'Assistant') + ' ', d.assistantId),
     cvStat('Ended: ', (d.endedReason || '—').replace(/-/g, ' ')),
     cvStat('Duration ', cvFmt(d.duration)),
     cvStat('Cost: ', d.cost != null && d.cost > 0 ? '$' + d.cost.toFixed(2) : '—')]
     .concat(opts.badge ? [opts.badge] : []));

  // Lanes: talk share per speaker, silence = time nobody is speaking.
  const D = Math.max(d.duration || 0, ...d.segments.map((s) => s.start + s.dur), 1);
  const talk = { assistant: 0, user: 0 };
  for (const s of d.segments) talk[s.role] += Math.min(s.dur, D - s.start);
  const ivs = d.segments.map((s) => [s.start, Math.min(D, s.start + s.dur)]).sort((a, b) => a[0] - b[0]);
  const gaps = []; let cur = 0;
  for (const [a, b] of ivs) { if (a > cur + 0.6) gaps.push([cur, a]); cur = Math.max(cur, b); }
  if (D > cur + 0.6) gaps.push([cur, D]);
  const silence = gaps.reduce((t, [a, b]) => t + (b - a), 0);
  const pct = (x) => Math.round((x / D) * 100) + '%';

  const tl = advEl('div', 'cv-tl');
  const lanes = [
    ['assistant', d.assistantName || agentLabel || 'Assistant', pct(talk.assistant), d.segments.filter((s) => s.role === 'assistant').map((s) => [s.start, s.dur])],
    ['user', 'User', pct(talk.user), d.segments.filter((s) => s.role === 'user').map((s) => [s.start, s.dur])],
    ['silence', 'Silence', pct(silence), gaps.map(([a, b]) => [a, b - a])],
    ['tools', 'Tool calls', '', d.tools.map((t) => [t.at, 0])],
  ];
  const track = advEl('div', 'cv-track');
  for (const [cls, label, share, bars] of lanes) {
    const row = advEl('div', 'cv-lane ' + cls);
    const lab = advEl('div', 'cv-lab');
    lab.appendChild(advEl('span', null, label));
    lab.appendChild(advEl('span', 'cv-muted', share));
    row.appendChild(lab);
    const area = advEl('div', 'cv-area');
    for (const [s, dur] of bars) {
      const b = advEl('span', 'cv-bar');
      b.style.left = (s / D) * 100 + '%';
      b.style.width = cls === 'tools' ? '' : Math.max(0.3, (dur / D) * 100) + '%';
      if (cls === 'tools') b.title = 'tool call';
      area.appendChild(b);
    }
    row.appendChild(area);
    track.appendChild(row);
  }
  // One label per cluster of nearby markers (they overlapped into garbage text):
  // markers within ~10% of the timeline share a label like "name ×3"; the
  // tooltip lists each one with its time. Labels near the end anchor leftwards.
  const toolArea = track.querySelector('.cv-lane.tools .cv-area');
  const groups = [];
  for (const t of [...d.tools].sort((a, b) => a.at - b.at)) {
    const g = groups[groups.length - 1];
    if (g && (t.at - g.items[g.items.length - 1].at) / D < 0.1) g.items.push(t); else groups.push({ items: [t] });
  }
  for (const g of groups) {
    const names = [...new Set(g.items.map((t) => t.name))];
    const text = names.length === 1 ? names[0] + (g.items.length > 1 ? ' ×' + g.items.length : '') : names[0] + ' +' + (g.items.length - 1);
    const lbl = advEl('span', 'cv-tool-lbl', text);
    const pos = g.items[0].at / D;
    lbl.style.left = pos * 100 + '%';
    if (pos > 0.75) lbl.classList.add('end');
    lbl.title = g.items.map((t) => cvFmt(t.at) + '  ' + t.name).join('\n');
    toolArea.appendChild(lbl);
  }
  const head = advEl('div', 'cv-playhead');
  const headLbl = advEl('span', 'cv-playlbl', '00:00');
  head.appendChild(headLbl);
  track.appendChild(head);
  tl.appendChild(track);
  const axis = advEl('div', 'cv-axis');
  axis.appendChild(advEl('span', null, '00:00'));
  axis.appendChild(advEl('span', null, cvFmt(D)));
  tl.appendChild(axis);
  body.appendChild(tl);

  // Player
  const bar = advEl('div', 'cv-player');
  const play = advEl('button', 'cv-play', '▶');
  const speed = advEl('select', 'cv-speed');
  for (const v of ['1', '1.5', '2']) { const o = advEl('option', null, v + 'x'); o.value = v; speed.appendChild(o); }
  bar.appendChild(play); bar.appendChild(speed);
  bar.appendChild(advEl('span', 'cv-spacer'));
  const dl = advEl('a', 'cv-dl', '⬇ Audio');
  bar.appendChild(dl);
  body.appendChild(bar);
  if (d.hasRecording) {
    audio = new Audio('/recording?id=' + encodeURIComponent(d.id));
    audio.preload = 'metadata';
    dl.href = '/recording?id=' + encodeURIComponent(d.id);
    dl.target = '_blank';
    const left = () => track.querySelector('.cv-area').getBoundingClientRect().left - track.getBoundingClientRect().left;
    const place = () => {
      const w = track.clientWidth - left();
      head.style.left = left() + (Math.min(audio.currentTime, D) / D) * w + 'px';
      headLbl.textContent = cvFmt(audio.currentTime);
    };
    audio.addEventListener('timeupdate', place);
    audio.addEventListener('ended', () => (play.textContent = '▶'));
    play.addEventListener('click', () => { if (audio.paused) { audio.play(); play.textContent = '❚❚'; } else { audio.pause(); play.textContent = '▶'; } });
    speed.addEventListener('change', () => (audio.playbackRate = Number(speed.value)));
    track.addEventListener('click', (e) => {
      const x = e.clientX - track.getBoundingClientRect().left - left();
      const w = track.clientWidth - left();
      if (x >= 0) { audio.currentTime = Math.max(0, Math.min(D, (x / w) * D)); place(); }
    });
    requestAnimationFrame(place);
  } else {
    play.disabled = true; speed.disabled = true; dl.classList.add('off');
    bar.appendChild(advEl('span', 'cv-muted', 'No recording on this call'));
  }

  // Transcript
  const tx = advEl('div', 'cv-tx');
  tx.appendChild(advEl('div', 'prompt-k adv-k', 'Transcript'));
  for (const s of d.segments) {
    const line = advEl('div', 'logs-line ' + s.role);
    const who = advEl('span', 'who', (s.role === 'user' ? 'User' : (d.assistantName || 'Assistant')) + ' · ' + cvFmt(s.start));
    line.appendChild(who);
    line.appendChild(advEl('span', 'txt', displayText(s.text)));
    if (audio) { line.style.cursor = 'pointer'; line.addEventListener('click', () => { audio.currentTime = s.start; audio.play(); play.textContent = '❚❚'; }); }
    tx.appendChild(line);
  }
  body.appendChild(tx);
}

async function openEvalViewer(runId, opts = {}) {
  const body = cvShell();
  let d;
  try {
    const r = await fetch('/eval-run-detail?id=' + encodeURIComponent(runId));
    if (!r.ok) throw new Error('eval ' + r.status);
    d = await r.json();
  } catch { body.textContent = 'Could not load this eval run.'; return; }
  body.textContent = '';
  const when = new Date(d.startedAt || d.createdAt);
  const pass = d.results.length ? d.results.every((x) => x.status === 'pass') : null;
  const dur = d.startedAt && d.endedAt ? (Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 1000 : null;
  cvHeader(body,
    [advEl('span', 'cv-date', when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' '),
     advEl('span', 'cv-type', 'Eval · chat'), cvIdChip('Run ID:', d.id)],
    [advEl('span', 'cv-stat', d.name || opts.name || 'Eval'), advBadge(pass),
     cvStat('Ended: ', (d.endedReason || d.status || '—').replace(/-/g, ' ')),
     cvStat('Duration ', dur != null ? cvFmt(dur) : '—'),
     cvStat('Cost: ', d.cost != null ? '$' + Number(d.cost).toFixed(4) : '—')]);
  for (const res of d.results) {
    const tx = advEl('div', 'cv-tx');
    tx.appendChild(advEl('div', 'prompt-k adv-k', 'Conversation · judge verdict ' + (res.status || '').toUpperCase()));
    for (const m of res.messages) {
      const line = advEl('div', 'logs-line ' + (m.role === 'user' ? 'user' : 'assistant'));
      line.appendChild(advEl('span', 'who', m.role === 'user' ? 'Caller (scripted)' : (agentLabel || 'Assistant')));
      line.appendChild(advEl('span', 'txt', displayText(m.text)));
      tx.appendChild(line);
    }
    body.appendChild(tx);
  }
  if (!d.results.length) body.appendChild(advEl('div', 'adv-empty', 'This run has no results yet (' + d.status + ').'));
}

