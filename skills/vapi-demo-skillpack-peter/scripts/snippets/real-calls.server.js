
// ---- Real calls only -------------------------------------------------------------
// Simulation runs call this same assistant (type vapi.websocketCall, metadata
// isSimulation:"true" + simulationRunId), so their webhooks and call records
// would otherwise land on the live board, last-call view and Logs. Evals are
// chat mocks and never create calls. Anything flagged here is hidden.
const testCallIds = new Set();
function isTestCall(call) {
  if (!call) return false;
  if (call.id && testCallIds.has(call.id)) return true;
  const md = call.metadata ?? {};
  const flagged = md.isSimulation === true || md.isSimulation === 'true' || !!md.simulationRunId
    || !!md.simulationParentRunId || call.type === 'vapi.websocketCall'
    || /simulation/i.test(call.transport?.websocketCallUrl ?? '');
  if (flagged && call.id) { testCallIds.add(call.id); if (testCallIds.size > 500) testCallIds.delete(testCallIds.values().next().value); }
  return flagged;
}
