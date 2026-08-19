#!/usr/bin/env node
/** Stand-in for `mcode exec --output-format stream-json`. No network. */
function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("0.1.6\n");
  process.exit(0);
}

const prompt = args.at(-1) || "";
const failOnce = process.env.OMM_FAKE_FAIL_ONCE === "1";
const marker = process.env.OMM_FAKE_MARKER || "";

if (/Role: Explorer/i.test(prompt)) {
  emit({ type: "assistant", text: "tests: npm test\nrisks: auth handler throws on mismatch\npaths: src/auth.js tests/auth.test.js" });
} else if (/Role: Planner/i.test(prompt)) {
  emit({
    type: "assistant",
    text: `Plan for ${prompt.slice(0, 40)}\n\n\`\`\`json\n${JSON.stringify({
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
    })}\n\`\`\``,
  });
} else if (/Role: Verifier/i.test(prompt) || /READ-ONLY/i.test(prompt)) {
  emit({ type: "assistant", text: '```json\n{"blockers":[],"notes":["deterministic evidence is sufficient"]}\n```' });
} else if (/Role: Builder/i.test(prompt)) {
  if (failOnce && marker && !process.env.OMM_FAKE_BUILT) {
    // Builder "works" but tests may still fail independently.
    emit({ type: "assistant", text: "Changed src/auth.js (first attempt)." });
  } else {
    emit({ type: "assistant", text: "Changed src/auth.js. Tests should pass." });
  }
} else {
  emit({ type: "assistant", text: "ok" });
}

process.exit(0);
