import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { runMax } from "../dist/orchestrator.js";
import { runResearch } from "../dist/research.js";
import { runReview } from "../dist/review.js";
import { runShip } from "../dist/ship.js";
import { StubMcode } from "../dist/mcode.js";
import { RunStore } from "../dist/store.js";
import { CliError } from "../dist/util.js";
import { main } from "../dist/cli.js";
import { attachHud, renderHud, loadHud } from "../dist/hud.js";
import { inspectSkills, runInspect } from "../dist/inspect.js";
import { readyBuilders } from "../dist/team.js";

function project(testScript = "node -e \"process.exit(0)\"") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omm-prod-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { test: testScript } }),
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/auth.js"), "export const ok = true;\n");
  return dir;
}

function stubOk() {
  return new StubMcode(async (req) => ({
    text:
      req.role === "planner"
        ? '```json\n{"tasks":[{"id":"T1","title":"one change","role":"builder","depends_on":[]}],"acceptance":[{"id":"A1","criterion":"npm test","kind":"test","command":"npm test"}]}\n```'
        : `${req.role} ok`,
    events: [],
    exitCode: 0,
    rawLines: [],
  }));
}

test("review does not Accept", async () => {
  const workspace = project();
  const store = new RunStore(workspace);
  const run = store.create("review me");
  const logFile = path.join(workspace, "out.log");
  writeFileSync(logFile, "ok\n");
  store.addEvidence(run.run_id, "log", logFile, { notes: "seed" });
  const result = await runReview({ workspace, runId: run.run_id, mcode: stubOk() });
  assert.equal(result.review.can_accept, false);
  assert.notEqual(result.run.status, "accepted");
  assert.equal(store.load(run.run_id).status, "active");
  assert.ok(store.loadEvents(run.run_id).some((e) => e.type === "review_completed"));
});

test("ship refuses non-accepted runs", async () => {
  const workspace = project();
  const store = new RunStore(workspace);
  const run = store.create("not ready");
  await assert.rejects(
    () => runShip({ workspace, runId: run.run_id }),
    (error) => error instanceof CliError && /non-accepted/.test(error.message),
  );
});

test("research does not edit (no builder)", async () => {
  const workspace = project();
  const roles = [];
  const mcode = new StubMcode(async (req) => {
    roles.push(req.role);
    return { text: "map: src/auth.js", events: [], exitCode: 0, rawLines: [] };
  });
  const run = await runResearch({ workspace, goal: "how does auth work", mcode });
  assert.ok(!roles.includes("builder"));
  assert.equal(run.phase, "DISCOVER");
  assert.notEqual(run.status, "accepted");
  const store = new RunStore(workspace);
  assert.ok(store.readArtifact(run.run_id, "research.md").includes("No builder"));
  assert.ok(store.loadEvents(run.run_id).some((e) => e.type === "research_completed"));
});

test("attach/status render without mcode", async () => {
  const workspace = project();
  const store = new RunStore(workspace);
  const run = store.create("hud without mcode");
  const hud = renderHud(loadHud(store, run.run_id));
  assert.match(hud, /Run: run_/);
  assert.match(hud, /Phase: INTAKE/);
  assert.match(hud, /Cache\/cost: n\/a if unknown/);
  const attached = attachHud(store, run.run_id);
  assert.match(attached, /Goal: hud without mcode/);
  assert.ok(store.loadEvents(run.run_id).some((e) => e.type === "hud_attached"));

  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  const prev = process.env.OMM_WORKSPACE;
  process.env.OMM_WORKSPACE = workspace;
  try {
    const code = await main(["status", run.run_id]);
    assert.equal(code, 0);
  } finally {
    process.stdout.write = orig;
    if (prev) process.env.OMM_WORKSPACE = prev;
    else delete process.env.OMM_WORKSPACE;
  }
  assert.match(chunks.join(""), /Run: run_/);
});

test("inspect skills errors if a manifest skill is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omm-inspect-"));
  mkdirSync(path.join(dir, ".minimax-plugin"), { recursive: true });
  writeFileSync(
    path.join(dir, ".minimax-plugin/plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "oh-my-mcode",
      skills: ["skills/ghost/SKILL.md"],
    }),
  );
  const result = inspectSkills(dir);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("skills/ghost/SKILL.md"));
  assert.match(result.error || "", /configured but invisible/);

  const live = runInspect({ topic: "skills", workspace: dir });
  assert.equal(live.ok, true);
});

test("team schedules independent tasks", async () => {
  const workspace = project();
  const roles = [];
  const mcode = new StubMcode(async (req) => {
    roles.push(req.role);
    if (req.role === "planner") {
      return {
        text: `\`\`\`json\n${JSON.stringify({
          tasks: [
            { id: "T1", title: "inspect auth", role: "builder", depends_on: [] },
            { id: "T2", title: "implement rotation", role: "builder", depends_on: [] },
          ],
          acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
        })}\n\`\`\``,
        events: [],
        exitCode: 0,
        rawLines: [],
      };
    }
    return { text: `${req.role} ok`, events: [], exitCode: 0, rawLines: [] };
  });
  const graph = {
    run_id: "run_x",
    updated_at: new Date().toISOString(),
    tasks: [
      { id: "T1", title: "inspect auth", role: "builder", status: "pending", depends_on: [] },
      { id: "T2", title: "implement rotation", role: "builder", status: "pending", depends_on: [] },
    ],
    acceptance: [],
  };
  assert.equal(readyBuilders(graph).length, 2);

  const run = await runMax({
    workspace,
    goal: "two independent builders",
    mcode,
    team: true,
    llmVerify: false,
  });
  assert.equal(roles.filter((role) => role === "builder").length, 2);
  const store = new RunStore(workspace);
  assert.ok(store.loadEvents(run.run_id).some((e) => e.type === "team_spawned" && e.payload.count === 2));
});

test("cancel persists", () => {
  const workspace = project();
  const store = new RunStore(workspace);
  const run = store.create("cancel me");
  const cancelled = store.cancel(run.run_id);
  assert.equal(cancelled.status, "cancelled");
  const events = store.loadEvents(run.run_id);
  assert.ok(events.some((e) => e.type === "run_cancelled"));
  assert.ok(events.some((e) => e.type === "task_cancelled"));
});

test("evals runner exits 0 on fixtures", () => {
  const result = spawnSync(process.execPath, [path.resolve("evals/runner.mjs")], {
    encoding: "utf8",
    cwd: path.resolve("."),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /fail-then-repair/);
});

test("cli --help lists the full command surface", async () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    assert.equal(await main(["--help"]), 0);
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
  ]) {
    assert.match(help, new RegExp(cmd));
  }
});
