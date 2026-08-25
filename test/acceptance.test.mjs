import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runMax, runPlan } from "../dist/orchestrator.js";
import { StubMcode } from "../dist/mcode.js";
import { RunStore } from "../dist/store.js";
import { plannerYield, yieldResult } from "./helpers/yield.mjs";
import { copyHelloPkg } from "./helpers/hello-pkg.mjs";
import { seedGoalAcceptance, shouldSkipDiscover } from "../dist/acceptance.js";
import { runCaptured } from "../dist/verify.js";

function bareWorkspace() {
  return mkdtempSync(path.join(os.tmpdir(), "omm-bare-"));
}

function recordingStub(roles) {
  return new StubMcode(async (req) => {
    roles.push(req.role);
    if (req.role === "planner") {
      return plannerYield({
        tasks: [{ id: "T1", title: "implement the named change", role: "builder", depends_on: [] }],
        acceptance: [{ id: "A1", criterion: "npm test exits 0", kind: "test", command: "npm test" }],
      });
    }
    return yieldResult(`${req.role} ok`);
  });
}

test("hello-pkg goal naming npm test stores that acceptance command before the first host exec", async () => {
  const workspace = copyHelloPkg();
  const store = new RunStore(workspace);
  const created = store.create("export hello() and prove npm test passes");
  const seeded = store.loadTasks(created.run_id).acceptance;
  assert.equal(seeded[0]?.command, "npm test");
  assert.equal(seeded[0]?.source, "goal");
  const createdEvent = store.loadEvents(created.run_id)[0];
  assert.equal(createdEvent.payload.acceptance[0].command, "npm test");

  const roles = [];
  const logs = [];
  const run = await runMax({
    workspace,
    runId: created.run_id,
    goal: created.goal,
    mcode: recordingStub(roles),
    llmVerify: false,
    onLog: (line) => logs.push(line),
  });
  assert.equal(store.loadTasks(run.run_id).acceptance[0].command, "npm test");
  assert.match(logs.join("\n"), /command=npm test/);
  assert.ok(logs.some((line) => /acceptance \(how we will know we are done\)/.test(line)));
});

test("workspace with no scripts.test and a goal with no command has no Accept path", async () => {
  const workspace = bareWorkspace();
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "bare", private: true }));
  const seeded = seedGoalAcceptance(workspace, "improve the app");
  assert.ok(!seeded.some((item) => item.command));

  const roles = [];
  const run = await runMax({
    workspace,
    goal: "improve the app",
    mcode: recordingStub(roles),
    llmVerify: false,
    maxRepairs: 0,
  });
  assert.notEqual(run.status, "accepted");
  const store = new RunStore(workspace);
  const findings = store.loadFindings(run.run_id);
  assert.equal(findings?.verdict, "rejected");
  assert.ok(
    findings?.findings.some((item) => item.class === "no_test" || /No automated test\/build/.test(item.title)),
    `expected no_test finding, got ${JSON.stringify(findings?.findings)}`,
  );
  assert.ok(store.readArtifact(run.run_id, "evidence/no-test-command.txt"));
});

test("concrete max does not spawn explorer; plan and vague max still do", async () => {
  const concreteRoles = [];
  const concrete = await runMax({
    workspace: copyHelloPkg(),
    goal: "export hello() and prove npm test passes",
    mcode: recordingStub(concreteRoles),
    llmVerify: false,
  });
  assert.ok(!concreteRoles.includes("explorer"), `explorer spawned on concrete max: ${concreteRoles.join(",")}`);
  assert.ok(concreteRoles.includes("planner"));
  const runStore = new RunStore(concrete.workspace);
  const discover = runStore.readArtifact(concrete.run_id, "discover.md") ||
    runStore.readArtifact(concrete.run_id, "evidence/discover.md");
  assert.match(discover, /skipped: goal already concrete/);
  assert.doesNotMatch(discover, /src\/index\.js is a React app/);
  const snap = JSON.parse(runStore.readArtifact(concrete.run_id, "exec-snapshot-discover.json"));
  assert.equal(snap.skipped, true);

  const planRoles = [];
  const planned = await runPlan({
    workspace: copyHelloPkg(),
    goal: "export hello() and prove npm test passes",
    mcode: recordingStub(planRoles),
  });
  assert.ok(planRoles.includes("explorer"), "plan must still discover");
  assert.equal(planned.phase, "PLAN_REVIEW");

  const vagueRoles = [];
  await runMax({
    workspace: copyHelloPkg(),
    goal: "improve the app",
    mcode: recordingStub(vagueRoles),
    llmVerify: false,
  });
  assert.ok(vagueRoles.includes("explorer"), "vague max must still discover");

  const forcedRoles = [];
  await runMax({
    workspace: copyHelloPkg(),
    goal: "export hello() and prove npm test passes",
    mcode: recordingStub(forcedRoles),
    llmVerify: false,
    discover: true,
  });
  assert.ok(forcedRoles.includes("explorer"), "--discover must force explorer");
});

test("greenfield max without a detected command still discovers", async () => {
  const workspace = bareWorkspace();
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  const roles = [];
  await runMax({
    workspace,
    goal: "build a tiny todo app",
    mcode: recordingStub(roles),
    llmVerify: false,
    maxRepairs: 0,
  });
  assert.ok(roles.includes("explorer"));
  assert.equal(shouldSkipDiscover({ workflow: "max", goal: "build a tiny todo app", workspace }), false);
});

test("follow-goal violate: exporting greet is rejected by npm test", async () => {
  const workspace = copyFollowGoal();
  writeFileSync(
    path.join(workspace, "src/index.js"),
    'export function hello() { return "hello"; }\nexport function greet() { return "hi"; }\n',
  );
  const run = await runMax({
    workspace,
    goal: "export hello() returning hello. Do not add greet. Prove with npm test.",
    mcode: recordingStub([]),
    llmVerify: false,
    maxRepairs: 0,
  });
  assert.equal(run.status, "blocked");
  assert.equal(run.goal_state?.phase, "blocked");
  assert.equal(run.goal_state?.blockedReason?.code, "repair-cap");
  const store = new RunStore(workspace);
  const findings = store.loadFindings(run.run_id);
  assert.ok(findings?.findings.some((item) => item.class === "command_failed"));
});

test("acceptance npm test runs the workspace package, not a parent npm lifecycle", async () => {
  const workspace = copyFollowGoal();
  writeFileSync(
    path.join(workspace, "src/index.js"),
    'export function hello() { return "hello"; }\nexport function greet() { return "hi"; }\n',
  );
  const prevInit = process.env.INIT_CWD;
  const prevLife = process.env.npm_lifecycle_event;
  process.env.INIT_CWD = path.resolve(".");
  process.env.npm_lifecycle_event = "test";
  try {
    const result = await runCaptured("npm test", workspace);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /greet/);
  } finally {
    if (prevInit === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = prevInit;
    if (prevLife === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = prevLife;
  }
});

function copyFollowGoal() {
  const src = path.resolve("evals/tasks/follow-goal");
  const dest = mkdtempSync(path.join(os.tmpdir(), "omm-follow-"));
  cpSync(src, dest, { recursive: true });
  return dest;
}
