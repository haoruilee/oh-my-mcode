import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { StubMcode } from "../dist/mcode.js";
import { RunStore } from "../dist/store.js";
import { runMax } from "../dist/orchestrator.js";
import { runInspect, parseRunAddress } from "../dist/inspect.js";
import { buildTeamPacket } from "../dist/team.js";
import { builderPrompt, measurePrompt } from "../dist/prompts.js";
import { main } from "../dist/cli.js";
import { sha256Bytes } from "../dist/hash.js";
import { plannerYield, yieldResult } from "./helpers/yield.mjs";

function tmp(prefix = "omm-omp-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function project() {
  const dir = tmp("omm-omp-proj-");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { test: 'node -e "process.exit(0)"' } }),
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/auth.js"), "export const ok = true;\n");
  return dir;
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

describe("omp copies", () => {
test("doctor --tps --allow-stub still prints unmeasured and does not invent tps", async () => {
  const prev = process.env.OMM_MCODE;
  process.env.OMM_MCODE = path.resolve("test/fixtures/fake-mcode.mjs");
  try {
    const cap = captureMain(["doctor", "--package-only", "--tps", "--allow-stub"]);
    const code = await cap.run();
    assert.equal(code, 0, cap.chunks.join("") + cap.err.join(""));
    const text = cap.chunks.join("");
    assert.match(text, /unmeasured/);
    assert.match(text, /output_tps: null/);
    assert.match(text, /our_prompt_chars:/);
    assert.match(text, /builder_prompt_est_tokens:/);
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
    else delete process.env.OMM_MCODE;
  }
});

test("stale evidence hash cannot Accept", () => {
  const dir = tmp();
  const store = new RunStore(dir);
  const run = store.create("stale hash");
  const logFile = path.join(dir, "out.log");
  writeFileSync(logFile, "ok\n");
  const record = store.addEvidence(run.run_id, "test", logFile, { command: "npm test", exit_code: 0 });
  assert.ok(record.sha256);
  writeFileSync(path.join(store.dir(run.run_id), record.path), "tampered\n");
  assert.ok(store.staleEvidence(run.run_id).length >= 1);
  assert.throws(
    () =>
      store.writeFindings(run.run_id, {
        run_id: run.run_id,
        verdict: "accepted",
        checked_at: new Date().toISOString(),
        summary: "should fail",
        acceptance: [{ id: "A1", criterion: "npm test", result: "pass" }],
        findings: [],
      }),
    (error) => /stale evidence/.test(error.message),
  );
});

test("team packet injects shared context; builder prompt stays contract-only", async () => {
  const packet = buildTeamPacket({
    goal: "split work",
    discovery: "tests: npm test",
    interview: "interview.md",
    tasks: [
      { id: "T1", title: "a", role: "builder", status: "pending", depends_on: [] },
      { id: "T2", title: "b", role: "builder", status: "pending", depends_on: [] },
    ],
  });
  assert.match(packet.context, /split work/);
  assert.match(packet.context, /Orchestrator is the only scheduler/);
  assert.equal(packet.tasks.length, 2);

  const prompts = [];
  const mcode = new StubMcode(async (req) => {
    prompts.push(req.prompt);
    if (req.role === "planner") {
      return plannerYield({
        tasks: [
          { id: "T1", title: "inspect auth", role: "builder", depends_on: [] },
          { id: "T2", title: "implement rotation", role: "builder", depends_on: [] },
        ],
        acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
      });
    }
    return yieldResult(`${req.role} ok`);
  });
  const workspace = project();
  await runMax({
    workspace,
    goal: "two independent builders",
    mcode,
    team: true,
    llmVerify: false,
  });
  const builderPrompts = prompts.filter((text) => /Role: builder/.test(text));
  assert.equal(builderPrompts.length, 2);
  for (const prompt of builderPrompts) {
    assert.match(prompt, /Shared context/);
    assert.match(prompt, /schemaMode=strict|Yield JSON/);
    assert.doesNotMatch(prompt, /ultrathink|orchestrate|hashline|Sisyphus/i);
    assert.doesNotMatch(prompt, /type":"assistant"/);
    assert.ok(measurePrompt(prompt).chars < 2500, `builder prompt too large: ${measurePrompt(prompt).chars}`);
  }
});

test("run:// addresses point at store files", async () => {
  const workspace = project();
  const store = new RunStore(workspace);
  const run = store.create("address me");
  store.writeFindings(run.run_id, {
    run_id: run.run_id,
    verdict: "rejected",
    checked_at: new Date().toISOString(),
    summary: "not yet",
    acceptance: [{ id: "A1", criterion: "x", result: "fail" }],
    findings: [{ id: "F1", severity: "note", title: "n", detail: "d" }],
  });
  const address = `run://${run.run_id}/findings`;
  assert.deepEqual(parseRunAddress(address), { runId: run.run_id, leaf: "findings" });
  const inspected = runInspect({ topic: address, workspace, runId: run.run_id });
  assert.equal(inspected.ok, true);
  assert.match(String(inspected.data.contents), /not yet/);
  const context = runInspect({ topic: "context", workspace, runId: run.run_id });
  assert.equal(context.data.addresses.findings, address);
});

test("parent discover artifact is yield.summary, not dumped JSONL", async () => {
  const workspace = project();
  const mcode = new StubMcode(async (req) => {
    if (req.role === "planner") {
      return plannerYield({
        tasks: [{ id: "T1", title: "one change", role: "builder", depends_on: [] }],
        acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
      });
    }
    if (req.role === "explorer") {
      return yieldResult("leaked-should-not-appear", "explorer summary only");
    }
    return yieldResult(`${req.role} ok`);
  });
  const run = await runMax({ workspace, goal: "no jsonl leak", mcode, llmVerify: false });
  const store = new RunStore(workspace);
  const discover = store.readArtifact(run.run_id, "discover.md") || store.loadEvidence(run.run_id);
  const discoverText =
    typeof discover === "string" ? discover : store.readArtifact(run.run_id, "evidence/discover.md");
  // discover.md is written as text evidence under evidence/
  const ev = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover"));
  assert.ok(ev);
  const body = store.readArtifact(run.run_id, ev.path);
  assert.match(body, /explorer summary only/);
  assert.doesNotMatch(body, /leaked-should-not-appear/);
  const builderPromptText = builderPrompt({
    task_id: "T1",
    objective: "x",
    acceptance: ["npm test"],
    constraints: ["One task only"],
  });
  assert.doesNotMatch(builderPromptText, /agents\/builder\.md/);
});

test("content hash is recorded on evidence bytes", () => {
  const dir = tmp();
  const store = new RunStore(dir);
  const run = store.create("hash me");
  const logFile = path.join(dir, "out.log");
  const body = "probe\n";
  writeFileSync(logFile, body);
  const record = store.addEvidence(run.run_id, "log", logFile);
  assert.equal(record.sha256, sha256Bytes(body));
});
});
