import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RunStore } from "../dist/store.js";
import { CliError } from "../dist/util.js";

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), "omm-store-"));
}

test("create persists INTAKE run atomically", () => {
  const store = new RunStore(tmp());
  const run = store.create("prove the store");
  assert.match(run.run_id, /^run_[A-Z0-9]+$/);
  assert.equal(run.phase, "INTAKE");
  assert.equal(store.load(run.run_id).goal, "prove the store");
  assert.equal(store.loadEvents(run.run_id)[0].type, "run_created");
});

test("cannot mark Accepted without evidence files", () => {
  const store = new RunStore(tmp());
  const run = store.create("no evidence");
  assert.throws(
    () =>
      store.writeFindings(run.run_id, {
        run_id: run.run_id,
        verdict: "accepted",
        checked_at: new Date().toISOString(),
        summary: "should fail",
        acceptance: [{ id: "A1", criterion: "x", result: "pass" }],
        findings: [],
      }),
    (error) => error instanceof CliError && /evidence files/.test(error.message),
  );
});

test("Accepted requires all-pass acceptance and evidence", () => {
  const dir = tmp();
  const store = new RunStore(dir);
  const run = store.create("with evidence");
  const logFile = path.join(dir, "out.log");
  writeFileSync(logFile, "ok\n");
  store.addEvidence(run.run_id, "test", logFile, { command: "npm test", exit_code: 0 });
  const written = store.writeFindings(run.run_id, {
    run_id: run.run_id,
    verdict: "accepted",
    checked_at: new Date().toISOString(),
    summary: "ok",
    acceptance: [{ id: "A1", criterion: "npm test", result: "pass", evidence: ["evidence/E1-out.log"] }],
    findings: [],
  });
  assert.equal(written.run.status, "accepted");
  assert.equal(written.run.phase, "ACCEPT");
});
