import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { installPlugin } from "../dist/install.js";
import { createHarness } from "../dist/harness.js";
import { spawnSubagent, currentSpawnDepth } from "../dist/subagent.js";
import { runDoctor, formatDoctor } from "../dist/doctor.js";
import { RunStore } from "../dist/store.js";
import { StubMcode } from "../dist/mcode.js";
import { main } from "../dist/cli.js";
import { CliError } from "../dist/util.js";

const fakeMcode = path.resolve("test/fixtures/fake-mcode.mjs");
const bin = path.resolve("bin/oh-my-mcode.mjs");

function tmp(prefix = "omm-h-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function captureMain(argv) {
  const chunks = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  return {
    chunks,
    err,
    async run() {
      try {
        return await main(argv);
      } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
      }
    },
  };
}

test("install copies from package root, not cwd", () => {
  const fakeRoot = tmp("omm-pkg-");
  mkdirSync(path.join(fakeRoot, ".minimax-plugin"), { recursive: true });
  writeFileSync(
    path.join(fakeRoot, "plugin.json"),
    JSON.stringify({ name: "oh-my-mcode", version: "0.0.0-fake" }),
  );
  writeFileSync(
    path.join(fakeRoot, ".minimax-plugin/plugin.json"),
    JSON.stringify({ schemaVersion: 1, name: "oh-my-mcode", version: "0.0.0-fake" }),
  );
  writeFileSync(path.join(fakeRoot, "MARKER.txt"), "from-package-root\n");

  const cwd = tmp("omm-cwd-");
  writeFileSync(path.join(cwd, "MARKER.txt"), "from-cwd\n");
  writeFileSync(path.join(cwd, "plugin.json"), JSON.stringify({ name: "cwd-imposter" }));

  const home = tmp("omm-home-");
  const prevRoot = process.env.OMM_PACKAGE_ROOT;
  const prevHome = process.env.MINIMAX_HOME;
  const prevCwd = process.cwd();
  process.env.OMM_PACKAGE_ROOT = fakeRoot;
  process.env.MINIMAX_HOME = home;
  process.chdir(cwd);
  try {
    const result = installPlugin({ yes: true });
    assert.equal(result.packageRoot, path.resolve(fakeRoot));
    assert.notEqual(result.packageRoot, cwd);
    assert.equal(result.yes, true);
    const destMarker = path.join(result.dest, "MARKER.txt");
    assert.ok(existsSync(destMarker));
    assert.match(readFileSync(destMarker, "utf8"), /from-package-root/);
    assert.doesNotMatch(readFileSync(destMarker, "utf8"), /from-cwd/);
    const destPlugin = JSON.parse(readFileSync(path.join(result.dest, "plugin.json"), "utf8"));
    assert.equal(destPlugin.version, "0.0.0-fake");
    assert.notEqual(destPlugin.name, "cwd-imposter");
  } finally {
    process.chdir(prevCwd);
    if (prevRoot) process.env.OMM_PACKAGE_ROOT = prevRoot;
    else delete process.env.OMM_PACKAGE_ROOT;
    if (prevHome) process.env.MINIMAX_HOME = prevHome;
    else delete process.env.MINIMAX_HOME;
  }
});

test("interview --answers writes interview.json and does not Accept or builder-exec", async () => {
  const workspace = tmp("omm-iv-");
  const answers = path.join(workspace, "answers.json");
  writeFileSync(
    answers,
    JSON.stringify({
      goal: "fix auth",
      constraints: ["do not rewrite the session layer"],
      acceptance: ["npm test exits 0"],
      out_of_scope: ["new OAuth provider"],
    }),
  );
  const roles = [];
  const prevWs = process.env.OMM_WORKSPACE;
  const prevMcode = process.env.OMM_MCODE;
  process.env.OMM_WORKSPACE = workspace;
  delete process.env.OMM_MCODE;
  const cap = captureMain(["interview", "fix auth", "--answers", answers, "--workspace", workspace]);
  try {
    const code = await cap.run();
    assert.equal(code, 0, cap.err.join(""));
  } finally {
    if (prevWs) process.env.OMM_WORKSPACE = prevWs;
    else delete process.env.OMM_WORKSPACE;
    if (prevMcode) process.env.OMM_MCODE = prevMcode;
  }
  const store = new RunStore(workspace);
  const runId = store.latestId();
  assert.ok(runId);
  const run = store.load(runId);
  assert.equal(run.phase, "PLAN_REVIEW");
  assert.notEqual(run.status, "accepted");
  const interview = JSON.parse(store.readArtifact(runId, "interview.json"));
  assert.equal(interview.run_id, runId);
  assert.ok(interview.questions.length >= 3);
  assert.ok(interview.derived_acceptance.some((item) => /npm test/.test(item.criterion)));
  assert.match(store.readArtifact(runId, "interview.md"), /Interview/);
  assert.ok(store.loadEvents(runId).some((event) => event.type === "interview_completed" && event.payload.builder === false));
  assert.ok(!roles.includes("builder"));
  const types = store.loadEvents(runId).map((event) => event.type);
  assert.ok(!types.includes("run_accepted"));
});

test("doctor --smoke against fake-mcode exits 0 and mentions pong/smoke", async () => {
  const prev = process.env.OMM_MCODE;
  process.env.OMM_MCODE = fakeMcode;
  try {
    const report = runDoctor({ smoke: true });
    const text = formatDoctor(report);
    assert.equal(report.ok, true, text);
    const smoke = report.checks.find((check) => check.id === "smoke");
    assert.ok(smoke);
    assert.equal(smoke.ok, true, smoke.message);
    assert.match(smoke.message, /pong|smoke/i);
    assert.equal(typeof smoke.message.match(/latency=(\d+)/)?.[1] !== undefined, true);

    const cap = captureMain(["doctor", "--smoke"]);
    const code = await cap.run();
    assert.equal(code, 0, cap.chunks.join("") + cap.err.join(""));
    assert.match(cap.chunks.join(""), /pong|smoke/i);
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
    else delete process.env.OMM_MCODE;
  }
});

test("doctor --package-only still skips host and smoke", () => {
  const prev = process.env.OMM_MCODE;
  delete process.env.OMM_MCODE;
  try {
    const report = runDoctor({ packageOnly: true, smoke: true });
    assert.equal(report.packageOk, true, formatDoctor(report));
    assert.ok(!report.checks.some((check) => check.id === "mcode"));
    const smoke = report.checks.find((check) => check.id === "smoke");
    assert.ok(smoke);
    assert.match(smoke.message, /package-only/);
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
  }
});

test("subagent spawn records one exec; worker cannot spawn a grandchild", async () => {
  let execs = 0;
  const client = new StubMcode(async (req) => {
    execs += 1;
    assert.equal(currentSpawnDepth(), 1);
    await assert.rejects(
      () =>
        spawnSubagent(
          {
            role: "builder",
            contract: { task_id: "nested", objective: "nope", acceptance: [], constraints: [] },
            permission: "ask",
            cwd: process.cwd(),
            prompt: "grandchild",
          },
          { client },
        ),
      (error) => error instanceof CliError && /grandchildren/.test(error.message),
    );
    return {
      text: `${req.role} ok`,
      structuredOutput: { data: { status: "ok", summary: `${req.role} ok`, findings: [], artifacts: [] } },
      events: [
        {
          raw: {
            type: "result",
            structuredOutput: { data: { status: "ok", summary: `${req.role} ok`, findings: [], artifacts: [] } },
          },
          type: "result",
          text: `${req.role} ok`,
        },
      ],
      exitCode: 0,
      rawLines: [],
    };
  });
  const store = new RunStore(tmp());
  const run = store.create("one worker");
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look around", acceptance: [], constraints: ["no spawn"] },
      permission: "ask",
      cwd: store.workspace,
    },
    { client, store, runId: run.run_id },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(execs, 1);
  assert.equal(currentSpawnDepth(), 0);
  assert.ok(store.loadEvents(run.run_id).some((event) => event.type === "subagent_spawned" && event.payload.grandchildren === false));
});

test("harness submit create + status uses the same run store as CLI", async () => {
  const workspace = tmp("omm-core-");
  const harness = createHarness(workspace);
  const created = await harness.submit({ op: "create", goal: "shared store proof" });
  assert.match(created.run.run_id, /^run_/);
  const store = new RunStore(workspace);
  assert.equal(store.load(created.run.run_id).goal, "shared store proof");
  assert.ok(existsSync(path.join(store.dir(created.run.run_id), "run.json")));

  const status = await harness.submit({ op: "status", runId: created.run.run_id });
  assert.match(status.hud, /Run: run_/);
  assert.match(status.hud, /shared store proof/);
  assert.equal(status.run.run_id, created.run.run_id);

  const prevWs = process.env.OMM_WORKSPACE;
  process.env.OMM_WORKSPACE = workspace;
  const cap = captureMain(["status", created.run.run_id]);
  try {
    const code = await cap.run();
    assert.equal(code, 0);
    assert.match(cap.chunks.join(""), /shared store proof/);
  } finally {
    if (prevWs) process.env.OMM_WORKSPACE = prevWs;
    else delete process.env.OMM_WORKSPACE;
  }
});

test("bin help lists interview", () => {
  const result = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /interview/);
  assert.match(result.stdout, /--smoke/);
  assert.match(result.stdout, /--tps/);
});
