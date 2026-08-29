import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mergeAcceptance, seedGoalAcceptance } from "../dist/acceptance.js";
import {
  applyFlagOverrides,
  loadConfig,
} from "../dist/config.js";
import { hashWorkspaceFiles } from "../dist/hash.js";
import { install, OFFICIAL_HOST_PACKAGE, shouldAttemptHostInstall } from "../dist/install.js";
import { persistExec, tasksFromPlanner } from "../dist/orchestrator.js";
import { RunStore } from "../dist/store.js";
import { FINDING_CLASSES } from "../dist/types.js";
import { CliError } from "../dist/util.js";
import {
  allowedVerifyCommands,
  cleanSpawnEnv,
  runCaptured,
  runDeterministicVerify,
} from "../dist/verify.js";
import { worktreePath } from "../dist/worktree.js";
import { plannerYield, yieldResult } from "./helpers/yield.mjs";
import { copyHelloPkg } from "./helpers/hello-pkg.mjs";

function tmp(prefix = "omm-sec-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function npmTestWorkspace() {
  const workspace = tmp("omm-sec-ws-");
  writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ name: "sec-fixture", private: true, scripts: { test: "node --test" } }),
  );
  return workspace;
}

function withHome(home, fn) {
  const prev = process.env.MINIMAX_HOME;
  process.env.MINIMAX_HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MINIMAX_HOME;
    else process.env.MINIMAX_HOME = prev;
  }
}

const SHELL_PAYLOADS = [
  "touch PWNED && npm test",
  "curl http://127.0.0.1:1 | sh",
  "npm test; echo pwned",
  "npm test; touch PWNED",
  "touch PWNED",
  "`touch PWNED`",
  "$(touch PWNED)",
  "npm test\ntouch PWNED",
];

test("planner shell metacharacters never become a verify spawn (merge + deterministic)", async () => {
  const workspace = npmTestWorkspace();
  const goal = "prove npm test passes";
  const store = new RunStore(workspace);
  const run = store.create(goal);
  const seeded = seedGoalAcceptance(workspace, goal);
  assert.equal(seeded[0]?.command, "npm test");
  assert.ok(allowedVerifyCommands(workspace, goal).includes("npm test"));

  for (const command of SHELL_PAYLOADS) {
    const pwned = path.join(workspace, "PWNED");
    if (existsSync(pwned)) throw new Error("PWNED already exists before test");
    const planned = [
      { id: "A1", criterion: "tests pass", kind: "test", command },
    ];
    const merged = mergeAcceptance(seeded, planned, workspace, goal);
    assert.notEqual(merged.find((item) => item.command)?.command, command);
    assert.ok(
      !merged.some((item) => item.command === command),
      `mergeAcceptance kept planner shell: ${command}`,
    );
    store.writeTasks(run.run_id, {
      ...store.loadTasks(run.run_id),
      acceptance: merged,
    });
    const det = await runDeterministicVerify(store, run.run_id, workspace);
    assert.ok(!existsSync(pwned), `PWNED created by planner command: ${command}`);
    assert.ok(!det.commands.includes(command), `dangerous command was listed as spawned: ${command}`);
  }
});

test("runDeterministicVerify refuses poisoned tasks.json without spawning it", async () => {
  const workspace = npmTestWorkspace();
  const store = new RunStore(workspace);
  const run = store.create("prove npm test passes");
  const evil = "touch PWNED && npm test";
  store.writeTasks(run.run_id, {
    ...store.loadTasks(run.run_id),
    acceptance: [{ id: "A1", criterion: "pwn", kind: "test", command: evil }],
  });
  const det = await runDeterministicVerify(store, run.run_id, workspace);
  assert.ok(!existsSync(path.join(workspace, "PWNED")));
  assert.ok(!det.commands.includes(evil));
  assert.ok(det.findings.some((item) => item.class === "command_refused"));
  assert.ok(FINDING_CLASSES.includes("command_refused"));
});

test("runCaptured refuses shell metacharacters and does not spawn them", async () => {
  const workspace = npmTestWorkspace();
  for (const command of SHELL_PAYLOADS) {
    await assert.rejects(
      () => runCaptured(command, workspace),
      (error) => error instanceof CliError && /refused verify command/.test(error.message),
    );
    assert.ok(!existsSync(path.join(workspace, "PWNED")), `runCaptured spawned: ${command}`);
  }
});

test("allowed npm test still runs as argv", async () => {
  const workspace = copyHelloPkg();
  const result = await runCaptured("npm test", workspace);
  assert.notEqual(result.exitCode, undefined);
  assert.match(result.output, /\$ npm test/);
  assert.equal(result.timedOut, undefined);
});

test("runCaptured timeout is distinct from a generic exit 1 fail", async () => {
  const workspace = tmp("omm-sec-to-");
  writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({
      name: "timeout-fixture",
      private: true,
      scripts: { test: "node -e \"setTimeout(() => {}, 60000)\"" },
    }),
  );
  const result = await runCaptured("npm test", workspace, 250);
  assert.equal(result.timedOut, true, result.output.slice(-500));
  assert.notEqual(result.exitCode, 0);
  const store = new RunStore(workspace);
  const run = store.create("prove npm test passes");
  const det = await runDeterministicVerify(store, run.run_id, workspace, 250);
  assert.ok(det.findings.some((item) => item.class === "command_timeout"), JSON.stringify(det.findings));
  assert.ok(!det.findings.some((item) => item.class === "command_failed"));
  assert.ok(FINDING_CLASSES.includes("command_timeout"));
});

function deadPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = child.pid;
    if (!pid) {
      reject(new Error("spawn produced no pid"));
      return;
    }
    child.on("exit", () => resolve(pid));
    child.on("error", reject);
  });
}

test("withLock does not steal a lock held by a live pid even if the file is old", () => {
  const workspace = tmp("omm-sec-lock-live-");
  const store = new RunStore(workspace);
  const run = store.create("live lock holder");
  const lockPath = path.join(store.dir(run.run_id), ".lock");
  writeFileSync(lockPath, `${process.pid}\n`);
  const ancient = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(lockPath, ancient, ancient);
  assert.throws(
    () => store.withLock(run.run_id, () => "stolen"),
    (error) => error instanceof CliError && /run directory is locked/.test(error.message),
  );
  assert.ok(existsSync(lockPath));
  assert.equal(readFileSync(lockPath, "utf8").trim(), String(process.pid));
});

test("withLock steals a lock whose holder pid is dead", async () => {
  const workspace = tmp("omm-sec-lock-dead-");
  const store = new RunStore(workspace);
  const run = store.create("dead lock holder");
  const lockPath = path.join(store.dir(run.run_id), ".lock");
  const pid = await deadPid();
  writeFileSync(lockPath, `${pid}\n`);
  const result = store.withLock(run.run_id, () => "stolen");
  assert.equal(result, "stolen");
});

test("planner cannot invent a verify command when goal+workspace have none", () => {
  const workspace = tmp("omm-sec-bare-");
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "bare", private: true }));
  const seeded = seedGoalAcceptance(workspace, "improve the app");
  assert.ok(!seeded.some((item) => item.command));
  assert.deepEqual(allowedVerifyCommands(workspace, "improve the app"), []);
  const merged = mergeAcceptance(
    seeded,
    [{ id: "A1", criterion: "pwn", kind: "test", command: "touch PWNED && npm test" }],
    workspace,
    "improve the app",
  );
  assert.ok(!merged.some((item) => item.command), `planner invented ${JSON.stringify(merged)}`);
});

test("dir/resolveId/load refuse traversal runId before path join (HIGH 2b)", () => {
  const workspace = tmp("omm-sec-runid-");
  const store = new RunStore(workspace);
  const pwnName = `pwned-runid-${process.pid}`;
  const outside = path.join(path.dirname(workspace), pwnName);
  const payloads = [
    `../../../${pwnName}`,
    "../../../../tmp/pwn",
    "../pwn",
    "run_../../../tmp/pwn",
    "run_foo/../pwn",
    "/tmp/pwn",
    "not-a-run-id",
  ];
  for (const id of payloads) {
    assert.throws(
      () => store.dir(id),
      (error) => error instanceof CliError && /invalid run id/.test(error.message),
    );
    assert.throws(
      () => store.resolveId(id),
      (error) => error instanceof CliError && /invalid run id/.test(error.message),
    );
    assert.throws(
      () => store.load(id),
      (error) => error instanceof CliError && /invalid run id/.test(error.message),
    );
    assert.throws(
      () => store.withLock(id, () => "no"),
      (error) => error instanceof CliError && /invalid run id/.test(error.message),
    );
  }
  const prev = process.env.OMM_RUN_ID;
  process.env.OMM_RUN_ID = "../../../../tmp/pwn";
  try {
    assert.throws(
      () => store.resolveId(),
      (error) => error instanceof CliError && /invalid run id/.test(error.message),
    );
  } finally {
    if (prev === undefined) delete process.env.OMM_RUN_ID;
    else process.env.OMM_RUN_ID = prev;
  }
  assert.ok(!existsSync(outside), `mkdir outside runsRoot: ${outside}`);
  assert.ok(!existsSync(path.join(store.runsRoot(), pwnName)));
  assert.ok(!existsSync(path.join(store.runsRoot(), "pwn")));
});

test("writeTextEvidence/addEvidence do not write through dest symlink (HIGH 2c)", () => {
  const workspace = tmp("omm-sec-sl-");
  const store = new RunStore(workspace);
  const run = store.create("evidence dest must not be a symlink");
  const outside = path.join(workspace, "outside-secret");
  writeFileSync(outside, "KEEP\n");
  const dest = path.join(store.dir(run.run_id), "evidence", "A1-test.log");
  symlinkSync(outside, dest);

  store.writeTextEvidence(run.run_id, "test", "A1-test.log", "PWN\n");
  assert.equal(readFileSync(outside, "utf8"), "KEEP\n", "writeTextEvidence wrote through dest symlink");
  assert.equal(lstatSync(dest).isSymbolicLink(), false);
  assert.match(readFileSync(dest, "utf8"), /PWN/);

  writeFileSync(outside, "KEEP\n");
  rmSync(dest);
  symlinkSync(outside, dest);
  const src = path.join(workspace, "src.log");
  writeFileSync(src, "PWN2\n");
  store.addEvidence(run.run_id, "log", src, { name: "A1-test.log" });
  assert.equal(readFileSync(outside, "utf8"), "KEEP\n", "addEvidence wrote through dest symlink");
  assert.equal(lstatSync(dest).isSymbolicLink(), false);
  assert.match(readFileSync(dest, "utf8"), /PWN2/);
});

test("addEvidence refuses when evidence/ parent is a symlink that escapes the run dir", () => {
  const workspace = tmp("omm-sec-epar-");
  const store = new RunStore(workspace);
  const run = store.create("evidence parent escape");
  const outsideDir = path.join(workspace, "escaped-evidence");
  mkdirSync(outsideDir);
  const planted = path.join(outsideDir, "A1-test.log");
  writeFileSync(planted, "KEEP\n");
  const evidence = path.join(store.dir(run.run_id), "evidence");
  rmSync(evidence, { recursive: true });
  symlinkSync(outsideDir, evidence);
  const src = path.join(workspace, "src.log");
  writeFileSync(src, "PWN\n");
  assert.throws(
    () => store.addEvidence(run.run_id, "log", src, { name: "A1-test.log" }),
    (error) => error instanceof CliError,
  );
  assert.equal(readFileSync(planted, "utf8"), "KEEP\n");
});

test("writeArtifact refuses path escape and does not create a file outside the run dir", () => {
  const workspace = tmp("omm-sec-art-");
  const store = new RunStore(workspace);
  const run = store.create("confine artifacts");
  const runDir = store.dir(run.run_id);
  const outside = path.resolve(runDir, "../../outside.txt");
  const deeper = path.resolve(runDir, "../../../tmp-sec-x");
  assert.throws(
    () => store.writeArtifact(run.run_id, "../../outside.txt", "pwn"),
    (error) => error instanceof CliError && /escapes/.test(error.message),
  );
  assert.throws(
    () => store.writeArtifact(run.run_id, "../../../tmp/x", "pwn"),
    (error) => error instanceof CliError,
  );
  assert.ok(!existsSync(outside), `wrote ${outside}`);
  assert.ok(!existsSync(deeper));
  assert.ok(!existsSync(path.join(workspace, "outside.txt")));
});

test("writeTextEvidence refuses ../escape.log and does not write outside evidence/", () => {
  const workspace = tmp("omm-sec-ev-");
  const store = new RunStore(workspace);
  const run = store.create("confine evidence");
  const runDir = store.dir(run.run_id);
  const escaped = path.resolve(runDir, "evidence", "../escape.log");
  assert.throws(
    () => store.writeTextEvidence(run.run_id, "log", "../escape.log", "pwn"),
    (error) => error instanceof CliError && /unsafe evidence name/.test(error.message),
  );
  assert.ok(!existsSync(escaped));
  assert.ok(!existsSync(path.join(runDir, "escape.log")));
});

test("tasksFromPlanner sanitizes path-escape task.id; persistExec stays in the run dir", async () => {
  const workspace = npmTestWorkspace();
  const store = new RunStore(workspace);
  const run = store.create("export hello() and prove npm test passes");
  const graph = tasksFromPlanner(
    run.run_id,
    run.goal,
    plannerYield({
      tasks: [{ id: "../../etc/passwd", title: "pwn", role: "builder", depends_on: [] }],
      acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
    }),
    store.loadTasks(run.run_id),
    workspace,
  );
  assert.notEqual(graph.tasks[0].id, "../../etc/passwd");
  assert.match(graph.tasks[0].id, /^T\d+$/);
  store.writeTasks(run.run_id, graph);
  const spawned = {
    ...yieldResult("builder ok"),
    yield: { status: "ok", summary: "ok", findings: [], artifacts: [] },
  };
  await persistExec(store, run.run_id, `execute-${graph.tasks[0].id}`, spawned);
  const runDir = store.dir(run.run_id);
  assert.ok(!existsSync(path.resolve(runDir, "../../etc/passwd")));
  assert.ok(!existsSync(path.join(workspace, "etc", "passwd")));
  const yieldName = `yield-execute-${graph.tasks[0].id}.json`;
  assert.ok(existsSync(path.join(runDir, yieldName)));
  await persistExec(store, run.run_id, "../../etc/passwd", spawned);
  assert.ok(!existsSync(path.resolve(runDir, "../../etc/passwd")));
  assert.ok(existsSync(path.join(runDir, "yield-id_sanitized.json")));
});

test("worktreePath with ../ taskId stays under .minimax/worktrees", () => {
  const workspace = tmp("omm-sec-wt-");
  const dest = worktreePath(workspace, "run_SAFEIDTEST0000000000001", "../../outside");
  const root = path.resolve(workspace, ".minimax", "worktrees");
  assert.ok(dest === root || dest.startsWith(root + path.sep));
  assert.notEqual(path.resolve(dest), path.resolve(workspace, "../../outside"));
  assert.ok(!dest.includes(`${path.sep}..${path.sep}`));
});

test("hashWorkspaceFiles does not read absolute or .. paths", () => {
  const workspace = tmp("omm-sec-hash-");
  const secret = path.join(workspace, "..", `secret-${process.pid}`);
  writeFileSync(secret, "top-secret\n");
  const passwd = "/etc/passwd";
  const hashes = hashWorkspaceFiles(workspace, [passwd, "../../secret", secret, "../secret"]);
  assert.ok(!(passwd in hashes), "hashed /etc/passwd");
  assert.ok(!("../../secret" in hashes));
  assert.ok(!(secret in hashes));
  assert.ok(!("../secret" in hashes));
  assert.deepEqual(hashes, {});
});

test("workspace config cannot silently raise permission to full", () => {
  const home = tmp("omm-sec-home-");
  const workspace = tmp("omm-sec-cfg-");
  mkdirSync(path.join(workspace, ".minimax"), { recursive: true });
  writeFileSync(
    path.join(workspace, ".minimax/oh-my-mcode.json"),
    JSON.stringify({ permission: "full" }),
  );
  withHome(home, () => {
    assert.equal(loadConfig(workspace).permission, "smart");
    const viaCli = applyFlagOverrides(loadConfig(workspace), { permission: "full" });
    assert.equal(viaCli.permission, "full");
  });
});

test("workspace config may set ask/smart/off; home file may set full", () => {
  const home = tmp("omm-sec-home2-");
  const workspace = tmp("omm-sec-cfg2-");
  mkdirSync(path.join(workspace, ".minimax"), { recursive: true });
  writeFileSync(
    path.join(workspace, ".minimax/oh-my-mcode.json"),
    JSON.stringify({ permission: "off" }),
  );
  withHome(home, () => {
    assert.equal(loadConfig(workspace).permission, "off");
  });
  writeFileSync(path.join(home, "oh-my-mcode.json"), JSON.stringify({ permission: "full" }));
  writeFileSync(
    path.join(workspace, ".minimax/oh-my-mcode.json"),
    JSON.stringify({ permission: "full" }),
  );
  withHome(home, () => {
    assert.equal(loadConfig(workspace).permission, "full");
  });
});

test("cleanSpawnEnv drops secrets and npm_* but keeps PATH", () => {
  const cleaned = cleanSpawnEnv({
    AWS_SECRET_ACCESS_KEY: "x",
    OPENAI_API_KEY: "sk",
    MINIMAX_API_KEY: "mm",
    GH_TOKEN: "gh",
    PATH: "/bin",
    npm_config_foo: "1",
    INIT_CWD: "/tmp",
  });
  assert.equal(cleaned.PATH, "/bin");
  assert.equal(cleaned.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(cleaned.OPENAI_API_KEY, undefined);
  assert.equal(cleaned.MINIMAX_API_KEY, undefined);
  assert.equal(cleaned.GH_TOKEN, undefined);
  assert.equal(cleaned.npm_config_foo, undefined);
  assert.equal(cleaned.INIT_CWD, undefined);
});

test("shouldAttemptHostInstall skips host on non-TTY without --yes", () => {
  assert.equal(
    shouldAttemptHostInstall({ yes: false, hostPresent: false, stdinIsTTY: false }),
    false,
  );
  assert.equal(
    shouldAttemptHostInstall({ yes: true, hostPresent: false, stdinIsTTY: false }),
    true,
  );
  assert.equal(
    shouldAttemptHostInstall({ yes: false, hostPresent: false, stdinIsTTY: true }),
    true,
  );
});

test("install without --yes on non-TTY is plugin-only", async () => {
  const fakeRoot = tmp("omm-pkg-");
  mkdirSync(path.join(fakeRoot, ".minimax-plugin"), { recursive: true });
  writeFileSync(path.join(fakeRoot, "plugin.json"), JSON.stringify({ name: "oh-my-mcode", version: "0.0.0-fake" }));
  writeFileSync(
    path.join(fakeRoot, ".minimax-plugin/plugin.json"),
    JSON.stringify({ schemaVersion: 1, name: "oh-my-mcode", version: "0.0.0-fake" }),
  );
  const home = tmp("omm-home-");
  const prevRoot = process.env.OMM_PACKAGE_ROOT;
  const prevHome = process.env.MINIMAX_HOME;
  process.env.OMM_PACKAGE_ROOT = fakeRoot;
  process.env.MINIMAX_HOME = home;
  let hostCalls = 0;
  try {
    const result = await install({
      yes: false,
      stdinIsTTY: false,
      mcodeExists: () => false,
      installHost: () => {
        hostCalls += 1;
        return { ok: true, command: `npm install -g ${OFFICIAL_HOST_PACKAGE}` };
      },
    });
    assert.equal(hostCalls, 0);
    assert.equal(result.skip_host, true);
    assert.equal(result.host_install_attempted, false);
    assert.equal(result.plugin_installed, true);
  } finally {
    if (prevRoot) process.env.OMM_PACKAGE_ROOT = prevRoot;
    else delete process.env.OMM_PACKAGE_ROOT;
    if (prevHome) process.env.MINIMAX_HOME = prevHome;
    else delete process.env.MINIMAX_HOME;
  }
});
