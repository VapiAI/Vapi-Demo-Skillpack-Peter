
// ---- Turn history with tool calls ---------------------------------------------
// Vapi's message list -> ordered turns. Speech becomes {role, text}; each tool
// call becomes {role:'tool', name, args, result, done} in the position it
// happened, so the transcript can show it inline. Results carry no id, so they
// pair with calls positionally per tool name.
function historyTurns(messages) {
  const turns = [];
  const open = {};
  for (const m of messages ?? []) {
    if ((m.role === 'bot' || m.role === 'user') && typeof m.message === 'string' && m.message.trim()) {
      turns.push({ role: m.role === 'bot' ? 'assistant' : 'user', name: m.assistantName ?? null, text: m.message });
    }
    for (const tc of m.toolCalls ?? m.tool_calls ?? []) {
      let args = tc.function?.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
      const t = { role: 'tool', id: tc.id ?? null, name: tc.function?.name ?? tc.name ?? tc.type ?? 'tool', args, result: null, done: false };
      turns.push(t);
      (open[t.name] ??= []).push(t);
    }
    if (m.role === 'tool_call_result') {
      const t = (open[m.name ?? '?'] ?? []).shift();
      if (t) {
        t.result = typeof m.result === 'string' ? m.result : JSON.stringify(m.result ?? '');
        t.done = true;
      }
    }
  }
  return turns;
}
