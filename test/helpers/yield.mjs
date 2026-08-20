/** Shared stub yield for tests. Parent reads structuredOutput.data only. */
export function yieldData(summary = "ok", artifacts = []) {
  return { status: "ok", summary, findings: [], artifacts };
}

export function yieldResult(text, summary = text) {
  const data = yieldData(summary);
  const raw = { type: "result", structuredOutput: { data }, text };
  return {
    text,
    structuredOutput: { data },
    events: [{ raw, type: "result", text }],
    exitCode: 0,
    rawLines: [JSON.stringify(raw)],
  };
}

export function plannerYield(graph, sessionId) {
  const text = `\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``;
  const data = yieldData("planner wrote task graph", ["plan.md", "tasks.json"]);
  const raw = { type: "result", structuredOutput: { data }, text };
  if (sessionId) raw.session_id = sessionId;
  return {
    text,
    structuredOutput: { data },
    events: [{ raw, type: "result", text }],
    exitCode: 0,
    rawLines: [JSON.stringify(raw)],
  };
}
