// Tool calls render INLINE in the live transcript as event-log entries, in the
// style of Vapi's internal call log: "+mm:ss.mmm" call time, the event, a
// category chip, the arguments, then a second timestamped line when the result
// lands (with observed latency). Used live (tool.called / tool.completed) and
// when the transcript is rebuilt from history (toolCardInline).
function toolLogClock(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return '+' + String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}
function toolLogNow() {
  const start = (typeof liveStats !== 'undefined' && liveStats?.startedAt && Date.parse(liveStats.startedAt))
    || (typeof liveStart !== 'undefined' && liveStart) || null;
  return start ? (Date.now() - start) / 1000 : null;
}
function toolLogLine(cls, sec, title, chip, chipCls) {
  const row = document.createElement('div');
  row.className = 'tl-row ' + cls;
  row.innerHTML = '<span class="tl-when"><span class="tl-t"></span><span class="ms"></span></span><span class="tl-title"></span><span class="tl-chip"></span>';
  row.querySelector('.tl-t').textContent = toolLogClock(sec);
  if (sec != null) row.dataset.sec = sec;
  row.querySelector('.tl-title').textContent = title;
  const c = row.querySelector('.tl-chip');
  c.textContent = chip; c.classList.add(chipCls);
  return row;
}
function toolLogArgs(args) {
  const box = document.createElement('div');
  box.className = 'tl-args';
  const entries = Object.entries(args || {});
  if (!entries.length) { box.textContent = 'no arguments'; return box; }
  for (const [k, v] of entries) {
    const line = document.createElement('div');
    const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
    const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
    line.append(kk, vv); box.appendChild(line);
  }
  return box;
}
function toolLogResult(el, result, ms, sec) {
  if (el.querySelector('.tl-row.res')) return;
  const callSec = Number(el.querySelector('.tl-row.call')?.dataset.sec);
  // Prefer Vapi's own timestamps (secondsFromStart) over webhook arrival times.
  if (sec != null && isFinite(callSec) && sec >= callSec) ms = Math.round((sec - callSec) * 1000);
  const row = toolLogLine('res', sec, 'Tool result · ' + el.dataset.name, 'RESULT', 'result');
  row.querySelector('.ms').textContent = ms > 0 ? ms + ' ms' : '';
  el.appendChild(row);
  const r = document.createElement('div');
  r.className = 'result tl-result';
  let text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  try { const j = JSON.parse(text); if (j && typeof j === 'object') text = Object.entries(j).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('\n'); } catch {}
  r.textContent = text || '(empty result)';
  if (text.length > 280) {
    r.classList.add('clamp');
    r.title = 'Click to expand';
    r.addEventListener('click', () => r.classList.toggle('clamp'));
  }
  el.appendChild(r);
  el.classList.add('done');
  const st = el.querySelector('.tl-row.call .ms');
  if (st) st.textContent = 'done';
}
function toolLogCard(name, args, toolCallId, sec, done) {
  const el = document.createElement('div');
  el.className = 'tool-card tool-inline tool-log' + (done ? ' done' : ' flash');
  el.dataset.name = name;
  if (toolCallId) el.dataset.tcid = toolCallId;
  const row = toolLogLine('call', sec, 'Tool call · ' + name, 'TOOL', 'tool');
  row.querySelector('.ms').textContent = done ? 'done' : 'running';
  el.appendChild(row);
  el.appendChild(toolLogArgs(args));
  return el;
}

function addToolCall(name, args, toolCallId, sec) {
  // Speech before a tool call is finished; speech after it is new. Parking the
  // open bubbles stops post-tool words from being appended to a pre-tool line.
  pendingFlush();
  panelReady('transcript');
  const box = $('transcript');
  const el = toolLogCard(name, args, toolCallId, sec ?? toolLogNow(), false);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function completeToolCall(name, result, ms, toolCallId, sec) {
  // Prefer an exact id match. Otherwise FIRST open card of the name (FIFO):
  // parallel same-name calls complete in call order.
  const open = [...document.querySelectorAll('.tool-card:not(.done)')];
  const el = (toolCallId && open.find(c => c.dataset.tcid === toolCallId))
    || open.find(c => c.dataset.name === name)
    || addToolCall(name, {});
  toolLogResult(el, result, ms, sec ?? toolLogNow());
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

function toolCardInline(box, turn) {
  if (turn.background) { toolBackgroundShow(turn, box, turn.sec); return; }
  const done = turn.done || callEnded;
  const el = toolLogCard(turn.name, turn.args, turn.id, turn.sec, done);
  box.appendChild(el);
  if (turn.result != null) toolLogResult(el, turn.result, turn.ms ?? 0, turn.resultSec);
}

// Background tool results: a tool that answers "lookup started" right away and
// later pushes its result into the call (controlUrl add-message) shows that
// result as its own entry, at the moment it was added to the conversation.
// Live via the `tool.background` event; rebuilt from history from system
// messages that start with "[Background lookup result]".
function toolBackgroundShow(d, box = $('transcript'), sec) {
  panelReady('transcript');
  const el = document.createElement('div');
  el.className = 'tool-card tool-inline tool-log background done' + (box === $('transcript') && sec == null ? ' flash' : '');
  el.dataset.name = d.name || 'lookup';
  const row = toolLogLine('bg', sec ?? toolLogNow(), 'Background result · ' + (d.name || 'lookup'), 'ADDED TO CALL', 'result');
  row.querySelector('.ms').textContent = d.ms != null ? d.ms + ' ms' : '';
  el.appendChild(row);
  if (d.query) el.appendChild(toolLogArgs({ query: d.query, ...(d.model ? { model: d.model } : {}) }));
  const r = document.createElement('div');
  r.className = 'result tl-result';
  r.textContent = d.result || '(no result)';
  if (r.textContent.length > 280) { r.classList.add('clamp'); r.title = 'Click to expand'; r.addEventListener('click', () => r.classList.toggle('clamp')); }
  el.appendChild(r);
  if (d.injected === false) el.appendChild(Object.assign(document.createElement('div'), { className: 'tl-warn', textContent: 'Could not add to the live call (no control URL).' }));
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
