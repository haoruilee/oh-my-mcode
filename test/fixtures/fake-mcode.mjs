#!/usr/bin/env node
/** Stand-in for `mcode exec --output-format stream-json`. No network. */
import { writeFileSync } from "node:fs";

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function rejectOutputSchemaPath() {
  process.stderr.write("mcode exec failed: --output-schema requires a JSON object.\n");
  process.exit(2);
}

/** Live host `chm`: no unit → milliseconds. Bare `180` is 180ms → exit 6 (Sw.timeout). */
function rejectBareTimeout() {
  process.stderr.write("mcode exec failed: timeout (exit 6). Bare --timeout integers are milliseconds.\n");
  process.exit(6);
}

function yieldOk(summary, artifacts = []) {
  return { status: "ok", summary, findings: [], artifacts };
}

function emitYield(summary, artifacts = [], extra = {}) {
  emit({ type: "result", structuredOutput: { data: yieldOk(summary, artifacts) }, ...extra });
}

const args = process.argv.slice(2);
if (process.env.OMM_FAKE_ARGV) {
  writeFileSync(process.env.OMM_FAKE_ARGV, `${JSON.stringify(args)}\n`);
}
if (args[0] === "--version") {
  process.stdout.write("0.2.1\n");
  process.exit(0);
}

const timeoutIdx = args.indexOf("--timeout");
if (timeoutIdx >= 0) {
  const value = args[timeoutIdx + 1] || "";
  if (!/^\d+(ms|s|m|h)$/i.test(value)) rejectBareTimeout();
}

const schemaIdx = args.indexOf("--output-schema");
if (schemaIdx >= 0) {
  const schema = args[schemaIdx + 1] || "";
  const trimmed = schema.trim();
  if (!trimmed.startsWith("{")) rejectOutputSchemaPath();
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) rejectOutputSchemaPath();
  } catch {
    rejectOutputSchemaPath();
  }
}

const prompt = args.at(-1) || "";
const failOnce = process.env.OMM_FAKE_FAIL_ONCE === "1";
const marker = process.env.OMM_FAKE_MARKER || "";

if (/Role: explorer/i.test(prompt)) {
  const text = "tests: npm test\nrisks: auth handler throws on mismatch\npaths: src/auth.js tests/auth.test.js";
  emit({ type: "assistant", text });
  emitYield(text, ["src/auth.js"]);
} else if (/Role: planner/i.test(prompt)) {
  const graph = {
    tasks: [
      {
        id: "T1",
        title: "Implement the requested change",
        role: "builder",
        depends_on: [],
        allowed_files: ["src/auth.js"],
      },
    ],
    acceptance: [{ id: "A1", criterion: "npm test exits 0", kind: "test", command: "npm test" }],
  };
  emit({
    type: "assistant",
    text: `Plan for ${prompt.slice(0, 40)}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``,
  });
  emitYield("planner wrote task graph", ["plan.md", "tasks.json"]);
} else if (/Role: verifier/i.test(prompt) || /Role: reviewer/i.test(prompt) || /READ-ONLY/i.test(prompt)) {
  emit({ type: "assistant", text: "deterministic evidence is sufficient" });
  emitYield("deterministic evidence is sufficient", []);
} else if (/single word pong/i.test(prompt) || /exactly pong/i.test(prompt) || /\bpong\b/i.test(prompt)) {
  if (args.includes("json") && !args.includes("stream-json")) {
    process.stdout.write(`${JSON.stringify({ type: "result", text: "pong" })}\n`);
  } else {
    emit({ type: "assistant", text: "pong" });
    emitYield("pong", []);
  }
} else if (/Role: builder/i.test(prompt)) {
  const text =
    failOnce && marker && !process.env.OMM_FAKE_BUILT
      ? "Changed src/auth.js (first attempt)."
      : "Changed src/auth.js. Tests should pass.";
  emit({ type: "assistant", text });
  emitYield(text, ["src/auth.js"]);
} else {
  emit({ type: "assistant", text: "ok" });
  emitYield("ok", []);
}

process.exit(0);
