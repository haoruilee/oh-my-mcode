#!/usr/bin/env node
/**
 * Eval harness for oh-my-mcode. Uses StubMcode / fake-mcode. No production ΔY claims.
 *
 *   npm run eval
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const fakeMcode = path.join(root, "test/fixtures/fake-mcode.mjs");

const { runMax, runPlan, runResume } = await import(pathToFileURL(path.join(dist, "orchestrator.js")).href);
const { StubMcode } = await import(pathToFileURL(path.join(dist, "mcode.js")).href);
const { RunStore } = await import(pathToFileURL(path.join(dist, "store.js")).href);

function copyTask(name) {
  const src = path.join(root, "evals/tasks", name);
  const dest = mkdtempSync(path.join(os.tmpdir(), `omm-eval-${name}-`));
  cpSync(src, dest, { recursive: true });
  return dest;
}

function stub(handler) {
  return new StubMcode(async (req) => {
    if (handler) {
      const extra = await handler(req);
      if (extra) return extra;
    }
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

async function evalPass() {
  const workspace = copyTask("pass");
  const run = await runMax({
    workspace,
    goal: "eval pass: prove tests pass",
    mcode: stub(),
    llmVerify: false,
  });
  const store = new RunStore(workspace);
  return {
    fixture: "pass",
    run_id: run.run_id,
    verified_completion: run.status === "accepted",
    repairs: run.repair_count || 0,
    interventions: store.loadEvents(run.run_id).filter((e) => e.payload?.stop).length,
    resume_success: null,
    status: run.status,
    phase: run.phase,
  };
}

async function evalFailThenRepair() {
  const workspace = copyTask("fail-then-repair");
  const run = await runMax({
    workspace,
    goal: "eval fail-then-repair: fix until tests pass",
    mcode: stub(async (req) => {
      if (req.role === "builder" && /Previous verifier findings/i.test(req.prompt)) {
        writeFileSync(path.join(req.cwd, ".repaired"), "ok\n");
      }
      return undefined;
    }),
    llmVerify: false,
    maxRepairs: 3,
    ralph: true,
  });
  const store = new RunStore(workspace);
  return {
    fixture: "fail-then-repair",
    run_id: run.run_id,
    verified_completion: run.status === "accepted",
    repairs: run.repair_count || 0,
    interventions: store.loadEvents(run.run_id).filter((e) => e.payload?.stop).length,
    resume_success: null,
    status: run.status,
    phase: run.phase,
  };
}

async function evalPlanOnly() {
  const workspace = copyTask("plan-only");
  const planned = await runPlan({
    workspace,
    goal: "eval plan-only: do not implement",
    mcode: stub(),
  });
  const resumed = await runResume({
    workspace,
    runId: planned.run_id,
    mcode: stub(),
  });
  return {
    fixture: "plan-only",
    run_id: planned.run_id,
    verified_completion: false,
    repairs: planned.repair_count || 0,
    interventions: 0,
    resume_success: resumed.run_id === planned.run_id && resumed.goal === planned.goal,
    status: planned.status,
    phase: planned.phase,
  };
}

function ok(row) {
  if (row.fixture === "pass") return row.verified_completion && row.repairs === 0;
  if (row.fixture === "fail-then-repair") return row.verified_completion && row.repairs >= 1;
  if (row.fixture === "plan-only") return row.phase === "PLAN_REVIEW" && row.resume_success === true;
  return false;
}

async function main() {
  const rows = [await evalPass(), await evalFailThenRepair(), await evalPlanOnly()];
  const report = {
    plugin: "oh-my-mcode",
    harness: "evals/runner.mjs",
    note: "Fixture harness only. Not a production ΔY statistic.",
    generated_at: new Date().toISOString(),
    ok: rows.every(ok),
    results: rows,
    totals: {
      verified_completion: rows.filter((r) => r.verified_completion).length,
      repairs: rows.reduce((n, r) => n + (r.repairs || 0), 0),
      interventions: rows.reduce((n, r) => n + (r.interventions || 0), 0),
      resume_success: rows.filter((r) => r.resume_success).length,
    },
  };
  const outDir = path.join(root, "evals/output");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "report.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!existsSync(path.join(root, "evals/baselines/report.json"))) {
    process.stderr.write("evals: missing baselines/report.json\n");
    process.exit(1);
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`evals: ${error.message}\n`);
  process.exit(1);
});
