// Tool calls render INLINE in the transcript, where they happened in the
// conversation, as a compact card between the speech bubbles.
function toolCardInline(box, turn) {
  const done = turn.done || callEnded;
  const el = document.createElement('div');
  el.className = 'tool-card tool-inline' + (done ? ' done' : '');
  el.dataset.name = turn.name;
  if (turn.id) el.dataset.tcid = turn.id;
  el.innerHTML = '<div class="row"><span class="dot"></span><span class="name"></span><span class="ms"></span></div><div class="args"></div>';
  el.querySelector('.name').textContent = 'Tool call · ' + turn.name;
  el.querySelector('.ms').textContent = done ? 'done' : 'running';
  const argText = Object.entries(turn.args || {}).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('  ·  ');
  el.querySelector('.args').textContent = argText || 'no arguments';
  if (turn.result) {
    const r = document.createElement('div');
    r.className = 'result';
    r.textContent = turn.result;
    el.appendChild(r);
  }
  box.appendChild(el);
}

