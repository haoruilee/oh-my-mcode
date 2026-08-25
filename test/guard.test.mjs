import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRepair, findingFingerprint, pruneInjectedText } from "../dist/guard.js";

const findings = {
  run_id: "run_TEST",
  verdict: "rejected",
  checked_at: new Date().toISOString(),
  summary: "tests failed",
  acceptance: [],
  findings: [{ id: "F1", severity: "blocker", title: "npm test failed", detail: "exit 1" }],
};

test("first fail admits repair", () => {
  const fingerprint = findingFingerprint(findings);
  const decision = decideRepair({
    fingerprint,
    repairsIncludingThis: 1,
    maxRounds: 3,
  });
  assert.deepEqual(decision, { action: "repair", fingerprint });
});

test("same fingerprint as last VERIFY blocks with repeat-finding", () => {
  const fingerprint = findingFingerprint(findings);
  const decision = decideRepair({
    fingerprint,
    lastFingerprint: fingerprint,
    repairsIncludingThis: 2,
    maxRounds: 3,
  });
  assert.equal(decision.action, "block");
  assert.equal(decision.code, "repeat-finding");
  assert.match(decision.message, /repeated failure signature/);
  assert.equal(decision.fingerprint, fingerprint);
});

test("repairsIncludingThis over maxRounds blocks with repair-cap", () => {
  const fingerprint = findingFingerprint(findings);
  const decision = decideRepair({
    fingerprint,
    lastFingerprint: "different",
    repairsIncludingThis: 4,
    maxRounds: 3,
  });
  assert.equal(decision.action, "block");
  assert.equal(decision.code, "repair-cap");
  assert.match(decision.message, /repair limit reached \(3\)/);
});

test("pruneInjectedText keeps head and tail and marks omitted middle", () => {
  const short = "blocker: npm test failed";
  assert.equal(pruneInjectedText(short), short);
  const long = `${"HEAD".repeat(400)}${"MID".repeat(800)}${"TAIL".repeat(400)}`;
  const pruned = pruneInjectedText(long, 80);
  assert.ok(pruned.length < long.length);
  assert.match(pruned, /… \(\+\d+ chars omitted\)/);
  assert.ok(pruned.startsWith("HEAD"));
  assert.ok(pruned.endsWith("TAIL"));
  const omitted = Number(/… \(\+(\d+) chars omitted\)/.exec(pruned)?.[1]);
  assert.ok(omitted > 0);
  assert.equal(omitted, long.length - (pruned.length - `… (+${omitted} chars omitted)`.length));
});
