import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runMax, runPlan, runResume } from "../dist/orchestrator.js";
import { StubMcode } from "../dist/mcode.js";
import { RunStore } from "../dist/store.js";
import { main } from "../dist/cli.js";
import { yieldResult } from "./helpers/yield.mjs";

const fakeMcode = path.resolve("test/fixtures/fake-mcode.mjs");

function project(testScript = "node -e \"process.exit(0)\"") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omm-proj-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { test: testScript } }),
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/auth.js"), "export const ok = true;\n");
  return dir;
}

function stubFromFake() {
  return new StubMcode(async (req) => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [fakeMcode, "exec", "--cwd", req.cwd, req.prompt], {
      encoding: "utf8",
    });
    const lines = result.stdout.split("\n").filter(Boolean);
    const events = lines.map((line) => {
      try {
        const raw = JSON.parse(line);
        return { raw, type: raw.type, text: raw.text };
      } catch {
        return { raw: line, text: line };
      }
    });
    return {
      text: events.map((e) => e.text || "").join("\n"),
      events,
      exitCode: result.status ?? 0,
      rawLines: lines,
    };
  });
}

test("max with stub mcode reaches Accepted when tests pass", async () => {
  const workspace = project();
  const run = await runMax({
    workspace,
    goal: "fix auth and prove tests pass",
    mcode: stubFromFake(),
    llmVerify: false,
  });
  assert.equal(run.status, "accepted");
  assert.equal(run.phase, "ACCEPT");
  const store = new RunStore(workspace);
  assert.ok(store.evidenceFilesExist(run.run_id));
  const types = new Set(store.loadEvents(run.run_id).map((e) => e.type));
  for (const needed of ["run_created", "phase_changed", "test_ran", "run_accepted"]) {
    assert.ok(types.has(needed), `missing event ${needed}`);
  }
  assert.match(readFileSync(path.join(store.dir(run.run_id), "summary.md"), "utf8"), /accepted/i);
});

test("plan does not enter PLAN_REVIEW when discover yield fails", async () => {
  const workspace = project();
  const run = await runPlan({
    workspace,
    goal: "host exit 70",
    mcode: new StubMcode(async () => ({
      text: "MCode encountered an internal error",
      events: [],
      exitCode: 70,
      rawLines: [],
    })),
  });
  assert.notEqual(run.phase, "PLAN_REVIEW");
  assert.equal(run.phase, "DISCOVER");
  assert.equal(run.status, "rejected");
  const store = new RunStore(workspace);
  const failed = JSON.parse(store.readArtifact(run.run_id, "yield-discover.json"));
  assert.equal(failed.status, "failed");
  assert.ok(store.loadEvents(run.run_id).some((event) => event.type === "run_rejected" && event.payload.reason === "failed_worker_yield"));
  assert.doesNotMatch(store.loadPlan(run.run_id), /## Planner/);
});

test("plan does not enter PLAN_REVIEW when planner yield fails", async () => {
  const workspace = project();
  const run = await runPlan({
    workspace,
    goal: "planner died",
    mcode: new StubMcode(async (req) => {
      if (req.role === "explorer") return yieldResult("looked around");
      return { text: "internal error", events: [], exitCode: 70, rawLines: [] };
    }),
  });
  assert.equal(run.phase, "PLAN");
  assert.equal(run.status, "rejected");
  assert.notEqual(run.phase, "PLAN_REVIEW");
  const store = new RunStore(workspace);
  const failed = JSON.parse(store.readArtifact(run.run_id, "yield-plan.json"));
  assert.equal(failed.status, "failed");
});

test("plan stops at PLAN_REVIEW and does not Accept", async () => {
  const workspace = project();
  const run = await runPlan({
    workspace,
    goal: "migrate mysql to postgres",
    mcode: stubFromFake(),
  });
  assert.equal(run.phase, "PLAN_REVIEW");
  assert.notEqual(run.status, "accepted");
});

test("max without mcode still creates a run then fails clearly", async () => {
  const workspace = project();
  const prev = process.env.PATH;
  const prevStub = process.env.OMM_MCODE;
  process.env.PATH = "/nonexistent";
  delete process.env.OMM_MCODE;
  try {
    await assert.rejects(
      () => runMax({ workspace, goal: "create then fail", llmVerify: false }),
      (error) => error.name === "McodeMissingError",
    );
    const store = new RunStore(workspace);
    const ids = store.listIds();
    assert.equal(ids.length, 1);
    const events = store.loadEvents(ids[0]);
    assert.equal(events[0].type, "run_created");
    assert.ok(events.some((e) => e.payload && e.payload.error === "mcode_missing"));
  } finally {
    process.env.PATH = prev;
    if (prevStub) process.env.OMM_MCODE = prevStub;
  }
});

test("failing tests reject and bound the repair loop", async () => {
  const workspace = project("node -e \"process.exit(1)\"");
  const run = await runMax({
    workspace,
    goal: "this will fail verify",
    mcode: stubFromFake(),
    llmVerify: false,
    maxRepairs: 2,
  });
  assert.equal(run.status, "rejected");
  assert.ok((run.repair_count || 0) >= 1);
  const store = new RunStore(workspace);
  assert.ok(store.loadFindings(run.run_id)?.verdict === "rejected");
  assert.ok(store.evidenceFilesExist(run.run_id));
});

test("resume continues a PLAN_REVIEW run without starting a new goal", async () => {
  const workspace = project();
  const planned = await runPlan({
    workspace,
    goal: "original goal",
    mcode: stubFromFake(),
  });
  const resumed = await runResume({
    workspace,
    runId: planned.run_id,
    mcode: stubFromFake(),
  });
  assert.equal(resumed.run_id, planned.run_id);
  assert.equal(resumed.goal, "original goal");
  const store = new RunStore(workspace);
  assert.ok(store.loadEvents(planned.run_id).some((e) => e.type === "run_resumed"));
});

test("cli --help lists hero commands", async () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = await main(["--help"]);
    assert.equal(code, 0);
  } finally {
    process.stdout.write = orig;
  }
  const help = chunks.join("");
  for (const cmd of [
    "max",
    "plan",
    "verify",
    "resume",
    "review",
    "ship",
    "research",
    "attach",
    "status",
    "cancel",
    "inspect",
    "team",
    "doctor",
    "install",
    "interview",
  ]) {
    assert.match(help, new RegExp(cmd));
  }
});

test("cli max without mcode creates run (exit 2)", async () => {
  const workspace = project();
  const prevPath = process.env.PATH;
  const prevWs = process.env.OMM_WORKSPACE;
  delete process.env.OMM_MCODE;
  process.env.PATH = "/nonexistent";
  process.env.OMM_WORKSPACE = workspace;
  const err = [];
  const origErr = process.stderr.write.bind(process.stderr);
  const origOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  process.stdout.write = () => true;
  try {
    const code = await main(["max", "fix auth from cli"]);
    assert.equal(code, 2);
    const store = new RunStore(workspace);
    assert.equal(store.listIds().length, 1);
    assert.match(err.join(""), /mcode is not on PATH/);
  } finally {
    process.stderr.write = origErr;
    process.stdout.write = origOut;
    process.env.PATH = prevPath;
    if (prevWs) process.env.OMM_WORKSPACE = prevWs;
    else delete process.env.OMM_WORKSPACE;
  }
});

void pathToFileURL;
