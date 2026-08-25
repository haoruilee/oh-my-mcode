import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RunStore } from "../dist/store.js";
import { CliError } from "../dist/util.js";
import { blockGoal, completeGoal, createGoalSnapshot } from "../dist/goal.js";

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), "omm-goal-"));
}

test("create arms goal_state then writeFindings accepted completes it", () => {
  const dir = tmp();
  const store = new RunStore(dir);
  const run = store.create("export hello() and prove npm test");
  assert.ok(run.goal_state);
  assert.equal(run.goal, "export hello() and prove npm test");
  assert.equal(run.goal_state.id, `goal_${run.run_id}`);
  assert.equal(run.goal_state.revision, 1);
  assert.equal(run.goal_state.objective, run.goal);
  assert.equal(run.goal_state.phase, "active");
  assert.equal(run.goal_state.blockedReason, undefined);
  assert.equal(run.goal_state.maxRounds, 3);
  assert.equal(run.goal_state.roundsStarted, 0);
  const events = store.loadEvents(run.run_id);
  assert.ok(events.some((event) => event.type === "goal_changed" && event.payload.operation === "create"));

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
  assert.equal(written.run.goal_state.phase, "complete");
  assert.equal(written.run.goal_state.revision, 2);
  assert.equal(written.run.goal_state.blockedReason, undefined);
  assert.ok(
    store
      .loadEvents(run.run_id)
      .some((event) => event.type === "goal_changed" && event.payload.operation === "complete"),
  );
});

test("create then block(repeat-finding) sets status blocked and blockedReason", () => {
  const store = new RunStore(tmp());
  const run = store.create("this will fail verify");
  const blocked = store.blockGoal(run.run_id, 1, {
    code: "repeat-finding",
    message: "repeated failure signature; stopping repair loop",
  });
  assert.equal(blocked.phase, "blocked");
  assert.equal(blocked.revision, 2);
  assert.equal(blocked.blockedReason.code, "repeat-finding");
  assert.match(blocked.blockedReason.message, /repeated failure/);
  const loaded = store.load(run.run_id);
  assert.equal(loaded.status, "blocked");
  assert.equal(loaded.goal_state.phase, "blocked");
  assert.ok(loaded.goal_state.blockedReason);
  const change = store.loadEvents(run.run_id).find((event) => event.payload?.operation === "block");
  assert.equal(change.type, "goal_changed");
  assert.equal(change.payload.phase, "blocked");
  assert.equal(change.payload.blockedReason.code, "repeat-finding");
});

test("stale goal revision throws CliError", () => {
  const store = new RunStore(tmp());
  const run = store.create("stale cas");
  store.blockGoal(run.run_id, 1, { code: "repair-cap", message: "repair limit reached (3)" });
  assert.throws(
    () => store.blockGoal(run.run_id, 1, { code: "repair-cap", message: "repair limit reached (3)" }),
    (error) => error instanceof CliError && /stale goal revision/.test(error.message),
  );
});

test("blockedReason is present iff phase is blocked", () => {
  const armed = createGoalSnapshot("run_TEST", "objective");
  assert.equal(armed.phase, "active");
  assert.equal(armed.blockedReason, undefined);
  const blocked = blockGoal(armed, 1, { code: "host-crash", message: "native sqlite abort" });
  assert.equal(blocked.phase, "blocked");
  assert.ok(blocked.blockedReason);
  const completed = completeGoal(blocked, 2);
  assert.equal(completed.phase, "complete");
  assert.equal(completed.blockedReason, undefined);
});
