#!/usr/bin/env node
/**
 * Deterministic run store for Oh My MiniMax Code.
 * Persist workflow state on disk. Single writer. Atomic writes (temp + rename).
 *
 * Usage:
 *   node scripts/run-store.mjs create --goal "..." [--workspace DIR]
 *   node scripts/run-store.mjs show [--run-id ID] [--latest] [--workspace DIR]
 *   node scripts/run-store.mjs list [--workspace DIR]
 *   node scripts/run-store.mjs append-event --type TYPE [--payload JSON] [--run-id ID]
 *   node scripts/run-store.mjs set-phase --phase PHASE [--status STATUS] [--run-id ID]
 *   node scripts/run-store.mjs write-plan --file PATH [--run-id ID]
 *   node scripts/run-store.mjs write-tasks --file PATH [--run-id ID]
 *   node scripts/run-store.mjs write-findings --file PATH [--run-id ID]
 *   node scripts/run-store.mjs add-evidence --kind KIND --path FILE [--command CMD] [--exit-code N]
 *   node scripts/run-store.mjs evidence-report [--run-id ID]
 *
 * Runs live at <workspace>/.minimax/runs/<run_id>/ — never inside the plugin folder.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PHASES = [
  "INTAKE",
  "DISCOVER",
  "PLAN",
  "PLAN_REVIEW",
  "EXECUTE",
  "VERIFY",
  "REPAIR",
  "ACCEPT",
  "RELEASE",
];

const STATUSES = ["active", "accepted", "rejected", "blocked"];

const EVENT_TYPES = [
  "run_created",
  "phase_changed",
  "task_started",
  "task_completed",
  "tool_called",
  "test_ran",
  "finding_emitted",
  "repair_requested",
  "run_accepted",
  "run_rejected",
  "run_resumed",
];

const EVIDENCE_KINDS = ["command", "test", "diff", "log", "other"];

function nowIso() {
  return new Date().toISOString();
}

function fail(message, code = 1) {
  process.stderr.write(`run-store: ${message}\n`);
  process.exit(code);
}

function usage(code = 0) {
  process.stdout.write(`Oh My MiniMax Code run store

Commands:
  create            Start a new run (INTAKE / active)
  show              Print run.json (and optional plan/tasks/findings)
  list              List runs in the workspace
  append-event      Append one events.jsonl row
  set-phase         Change phase (and optional status)
  write-plan        Atomically replace plan.md
  write-tasks       Atomically replace tasks.json
  write-findings    Atomically replace findings.json; may Accept / Reject
  add-evidence      Copy a file into evidence/ and index it
  evidence-report   Rebuild summary.md from store artifacts

Common flags:
  --workspace, -w   Project root (default: cwd or OMM_WORKSPACE)
  --run-id, -r      Existing run id (default: OMM_RUN_ID or latest)
  --latest          Resolve the most recently updated run
  --json            Machine-readable stdout (default for most commands)

See docs/architecture.md for the on-disk layout.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.flags.help = true;
      continue;
    }
    if (token === "--latest" || token === "--json") {
      args.flags[token.slice(2)] = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        args.flags[key] = true;
      } else {
        args.flags[key] = next;
        i += 1;
      }
      continue;
    }
    if (token === "-w" || token === "-r") {
      const map = { "-w": "workspace", "-r": "run-id" };
      args.flags[map[token]] = argv[i + 1];
      i += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function crockford32(bytes) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function newRunId() {
  const time = BigInt(Date.now());
  const timeBytes = Buffer.alloc(6);
  let remaining = time;
  for (let i = 5; i >= 0; i -= 1) {
    timeBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return `run_${crockford32(timeBytes).slice(0, 10)}${crockford32(randomBytes(10)).slice(0, 16)}`;
}

function newEventId() {
  return `evt_${crockford32(Buffer.concat([Buffer.from(Date.now().toString()), randomBytes(8)])).slice(0, 20)}`;
}

function workspaceRoot(flags) {
  return path.resolve(flags.workspace || process.env.OMM_WORKSPACE || process.cwd());
}

function runsRoot(workspace) {
  return path.join(workspace, ".minimax", "runs");
}

function runDir(workspace, runId) {
  return path.join(runsRoot(workspace), runId);
}

function writeAtomic(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, filePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, ".lock");
  if (existsSync(lockPath)) {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < 30_000) {
      fail(`run directory is locked: ${lockPath}`);
    }
    rmSync(lockPath);
  }
  writeFileSync(lockPath, `${process.pid}\n`);
  try {
    return fn();
  } finally {
    try {
      rmSync(lockPath);
    } catch {
      // ignore
    }
  }
}

function listRunIds(workspace) {
  const root = runsRoot(workspace);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith("run_") && existsSync(path.join(root, name, "run.json")))
    .sort((a, b) => {
      const aTime = statSync(path.join(root, a, "run.json")).mtimeMs;
      const bTime = statSync(path.join(root, b, "run.json")).mtimeMs;
      return bTime - aTime;
    });
}

function resolveRunId(workspace, flags, { required = true } = {}) {
  if (flags["run-id"]) return flags["run-id"];
  if (process.env.OMM_RUN_ID) return process.env.OMM_RUN_ID;
  const ids = listRunIds(workspace);
  if (flags.latest || ids.length === 1) return ids[0];
  if (!required) return undefined;
  if (ids.length === 0) fail("no runs in this workspace; create one first");
  fail(`multiple runs exist; pass --run-id or --latest (${ids.slice(0, 5).join(", ")})`);
}

function emptyTasks(runId) {
  return {
    run_id: runId,
    updated_at: nowIso(),
    tasks: [
      {
        id: "T1",
        title: "Intake and restated goal",
        role: "explorer",
        status: "in_progress",
        depends_on: [],
      },
    ],
    acceptance: [
      {
        id: "A1",
        criterion: "Replace this placeholder with a concrete, testable criterion during PLAN.",
        kind: "manual",
      },
    ],
  };
}

function appendEventLine(dir, event) {
  const filePath = path.join(dir, "events.jsonl");
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeAtomic(filePath, `${existing}${JSON.stringify(event)}\n`);
}

function createRun(workspace, goal) {
  if (!goal || !String(goal).trim()) fail("create requires --goal");
  const runId = newRunId();
  const dir = runDir(workspace, runId);
  if (existsSync(dir)) fail(`run already exists: ${runId}`);
  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  const created = nowIso();
  const run = {
    run_id: runId,
    goal: String(goal).trim(),
    phase: "INTAKE",
    status: "active",
    created_at: created,
    updated_at: created,
    workspace,
  };
  writeJson(path.join(dir, "run.json"), run);
  writeAtomic(
    path.join(dir, "plan.md"),
    `# Plan\n\nGoal: ${run.goal}\n\n_Planner has not written this file yet._\n`,
  );
  writeJson(path.join(dir, "tasks.json"), emptyTasks(runId));
  writeJson(path.join(dir, "evidence/index.json"), { run_id: runId, items: [] });
  appendEventLine(dir, {
    id: newEventId(),
    ts: created,
    type: "run_created",
    run_id: runId,
    phase: "INTAKE",
    payload: { goal: run.goal },
  });
  return run;
}

function loadRun(workspace, runId) {
  const filePath = path.join(runDir(workspace, runId), "run.json");
  if (!existsSync(filePath)) fail(`run.json not found: ${filePath}`);
  return readJson(filePath);
}

function touchRun(workspace, runId, patch) {
  const dir = runDir(workspace, runId);
  const current = loadRun(workspace, runId);
  const next = { ...current, ...patch, updated_at: nowIso() };
  writeJson(path.join(dir, "run.json"), next);
  return next;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function showRun(workspace, runId) {
  const dir = runDir(workspace, runId);
  const run = loadRun(workspace, runId);
  const extra = {};
  for (const name of ["tasks.json", "findings.json", "evidence/index.json"]) {
    const filePath = path.join(dir, name);
    if (existsSync(filePath)) extra[name] = readJson(filePath);
  }
  extra.plan_md = existsSync(path.join(dir, "plan.md"));
  extra.summary_md = existsSync(path.join(dir, "summary.md"));
  extra.path = dir;
  return { ...run, artifacts: extra };
}

function setPhase(workspace, runId, phase, status) {
  if (!PHASES.includes(phase)) fail(`unknown phase: ${phase}`);
  if (status && !STATUSES.includes(status)) fail(`unknown status: ${status}`);
  const dir = runDir(workspace, runId);
  return withLock(dir, () => {
    const current = loadRun(workspace, runId);
    if (current.phase === "ACCEPT" && phase !== "ACCEPT" && phase !== "RELEASE") {
      fail("accepted runs can only move to RELEASE");
    }
    const nextStatus = status || current.status;
    const next = touchRun(workspace, runId, { phase, status: nextStatus });
    appendEventLine(dir, {
      id: newEventId(),
      ts: next.updated_at,
      type: "phase_changed",
      run_id: runId,
      phase,
      payload: { from: current.phase, to: phase, status: nextStatus },
    });
    return next;
  });
}

function appendEvent(workspace, runId, type, payload, extra = {}) {
  if (!EVENT_TYPES.includes(type)) fail(`unknown event type: ${type}`);
  const dir = runDir(workspace, runId);
  return withLock(dir, () => {
    const run = loadRun(workspace, runId);
    const event = {
      id: extra.id || newEventId(),
      ts: nowIso(),
      type,
      run_id: runId,
      phase: extra.phase || run.phase,
      payload: payload || {},
    };
    if (extra.task_id) event.task_id = extra.task_id;
    appendEventLine(dir, event);
    touchRun(workspace, runId, {});
    return event;
  });
}

function copyText(src) {
  return readFileSync(src, "utf8");
}

function writePlan(workspace, runId, filePath) {
  const dir = runDir(workspace, runId);
  if (!existsSync(filePath)) fail(`plan file not found: ${filePath}`);
  return withLock(dir, () => {
    writeAtomic(path.join(dir, "plan.md"), copyText(filePath).endsWith("\n") ? copyText(filePath) : `${copyText(filePath)}\n`);
    const run = touchRun(workspace, runId, {});
    return { run_id: runId, written: "plan.md", updated_at: run.updated_at };
  });
}

function writeTasks(workspace, runId, filePath) {
  const dir = runDir(workspace, runId);
  if (!existsSync(filePath)) fail(`tasks file not found: ${filePath}`);
  const tasks = readJson(filePath);
  if (tasks.run_id && tasks.run_id !== runId) fail(`tasks.json run_id ${tasks.run_id} != ${runId}`);
  tasks.run_id = runId;
  tasks.updated_at = nowIso();
  return withLock(dir, () => {
    writeJson(path.join(dir, "tasks.json"), tasks);
    touchRun(workspace, runId, {});
    return tasks;
  });
}

function writeFindings(workspace, runId, filePath) {
  const dir = runDir(workspace, runId);
  if (!existsSync(filePath)) fail(`findings file not found: ${filePath}`);
  const findings = readJson(filePath);
  if (findings.run_id && findings.run_id !== runId) {
    fail(`findings.json run_id ${findings.run_id} != ${runId}`);
  }
  findings.run_id = runId;
  if (!findings.checked_at) findings.checked_at = nowIso();
  if (findings.verdict !== "accepted" && findings.verdict !== "rejected") {
    fail("findings.verdict must be accepted or rejected");
  }
  if (findings.verdict === "accepted") {
    const indexPath = path.join(dir, "evidence/index.json");
    const index = existsSync(indexPath) ? readJson(indexPath) : { items: [] };
    const filesOk =
      Array.isArray(index.items) &&
      index.items.length > 0 &&
      index.items.every((item) => existsSync(path.join(dir, item.path)));
    if (!filesOk) fail("cannot mark Accepted without evidence files");
    const failed = (findings.acceptance || []).filter((item) => item.result !== "pass");
    if (failed.length > 0) fail("cannot mark Accepted while acceptance is not all pass");
    const blockers = (findings.findings || []).filter((item) => item.severity === "blocker" || item.severity === "major");
    if (blockers.length > 0) fail("cannot mark Accepted with blocker/major findings");
  }
  return withLock(dir, () => {
    writeJson(path.join(dir, "findings.json"), findings);
    const status = findings.verdict === "accepted" ? "accepted" : "rejected";
    const phase = findings.verdict === "accepted" ? "ACCEPT" : "REPAIR";
    const current = loadRun(workspace, runId);
    const next = touchRun(workspace, runId, { status, phase });
    appendEventLine(dir, {
      id: newEventId(),
      ts: next.updated_at,
      type: "finding_emitted",
      run_id: runId,
      phase,
      payload: { verdict: findings.verdict, finding_count: findings.findings?.length || 0 },
    });
    appendEventLine(dir, {
      id: newEventId(),
      ts: next.updated_at,
      type: findings.verdict === "accepted" ? "run_accepted" : "run_rejected",
      run_id: runId,
      phase,
      payload: { summary: findings.summary },
    });
    if (findings.verdict === "rejected") {
      appendEventLine(dir, {
        id: newEventId(),
        ts: next.updated_at,
        type: "repair_requested",
        run_id: runId,
        phase: "REPAIR",
        payload: {
          blockers: (findings.findings || [])
            .filter((item) => item.severity === "blocker" || item.severity === "major")
            .map((item) => item.id),
        },
      });
    }
    if (current.phase !== phase) {
      appendEventLine(dir, {
        id: newEventId(),
        ts: next.updated_at,
        type: "phase_changed",
        run_id: runId,
        phase,
        payload: { from: current.phase, to: phase, status },
      });
    }
    return { run: next, findings };
  });
}

function addEvidence(workspace, runId, flags) {
  const kind = flags.kind;
  if (!EVIDENCE_KINDS.includes(kind)) fail(`unknown evidence kind: ${kind}`);
  const src = flags.path;
  if (!src || !existsSync(src)) fail("add-evidence requires --path to an existing file");
  const dir = runDir(workspace, runId);
  return withLock(dir, () => {
    const indexPath = path.join(dir, "evidence/index.json");
    const index = existsSync(indexPath) ? readJson(indexPath) : { run_id: runId, items: [] };
    const nextNum = index.items.length + 1;
    const id = `E${nextNum}`;
    const destName = flags.name || `${id}-${path.basename(src)}`;
    const destRel = path.posix.join("evidence", destName);
    const destAbs = path.join(dir, "evidence", destName);
    copyFileSync(src, destAbs);
    const record = {
      id,
      kind,
      path: destRel,
      recorded_at: nowIso(),
    };
    if (flags.command) record.command = String(flags.command);
    if (flags["exit-code"] !== undefined) record.exit_code = Number(flags["exit-code"]);
    if (flags.notes) record.notes = String(flags.notes);
    index.items.push(record);
    writeJson(indexPath, index);
    const eventType = kind === "test" ? "test_ran" : "tool_called";
    appendEventLine(dir, {
      id: newEventId(),
      ts: record.recorded_at,
      type: eventType,
      run_id: runId,
      phase: loadRun(workspace, runId).phase,
      payload: record,
    });
    touchRun(workspace, runId, {});
    return record;
  });
}

function readEvents(dir) {
  const filePath = path.join(dir, "events.jsonl");
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function evidenceReport(workspace, runId) {
  const dir = runDir(workspace, runId);
  const run = loadRun(workspace, runId);
  const tasks = existsSync(path.join(dir, "tasks.json")) ? readJson(path.join(dir, "tasks.json")) : null;
  const findings = existsSync(path.join(dir, "findings.json")) ? readJson(path.join(dir, "findings.json")) : null;
  const evidence = existsSync(path.join(dir, "evidence/index.json"))
    ? readJson(path.join(dir, "evidence/index.json"))
    : { items: [] };
  const events = readEvents(dir);
  const lines = [
    `# Evidence report`,
    ``,
    `- run_id: \`${run.run_id}\``,
    `- goal: ${run.goal}`,
    `- phase: ${run.phase}`,
    `- status: ${run.status}`,
    `- created_at: ${run.created_at}`,
    `- updated_at: ${run.updated_at}`,
    ``,
    `## Acceptance`,
    ``,
  ];
  const acceptance = findings?.acceptance || tasks?.acceptance || [];
  for (const item of acceptance) {
    const result = item.result ? ` **${item.result}**` : "";
    lines.push(`- ${item.id}: ${item.criterion}${result}`);
  }
  if (acceptance.length === 0) lines.push(`- _none recorded_`);
  lines.push(``, `## Findings`, ``);
  if (findings) {
    lines.push(`Verdict: **${findings.verdict}** — ${findings.summary}`, ``);
    if (findings.findings.length === 0) {
      lines.push(`- none`);
    } else {
      for (const finding of findings.findings) {
        lines.push(`- ${finding.id} (${finding.severity}): ${finding.title}`);
      }
    }
  } else {
    lines.push(`_Verifier has not written findings.json._`);
  }
  lines.push(``, `## Evidence files`, ``);
  if (evidence.items.length === 0) {
    lines.push(`- none`);
  } else {
    for (const item of evidence.items) {
      const extra = item.exit_code === undefined ? "" : ` exit=${item.exit_code}`;
      lines.push(`- ${item.id} [${item.kind}] \`${item.path}\`${extra}`);
    }
  }
  lines.push(``, `## Event log`, ``);
  for (const event of events) {
    lines.push(`- ${event.ts} ${event.type}${event.phase ? ` (${event.phase})` : ""}`);
  }
  lines.push(``);
  const markdown = lines.join("\n");
  writeAtomic(path.join(dir, "summary.md"), markdown);
  return { run_id: runId, path: path.join(dir, "summary.md"), status: run.status, phase: run.phase };
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args._.length === 0) usage(args._.length === 0 ? 1 : 0);
  const command = args._[0];
  const workspace = workspaceRoot(args.flags);

  if (command === "create") {
    const run = createRun(workspace, args.flags.goal);
    printJson({ ...run, path: runDir(workspace, run.run_id) });
    return;
  }

  if (command === "list") {
    const runs = listRunIds(workspace).map((id) => {
      const run = loadRun(workspace, id);
      return {
        run_id: run.run_id,
        phase: run.phase,
        status: run.status,
        goal: run.goal,
        updated_at: run.updated_at,
      };
    });
    printJson({ workspace, runs });
    return;
  }

  const runId = resolveRunId(workspace, args.flags);

  if (command === "show") {
    printJson(showRun(workspace, runId));
    return;
  }

  if (command === "append-event") {
    let payload = {};
    if (args.flags.payload) {
      payload = JSON.parse(args.flags.payload);
    }
    const event = appendEvent(workspace, runId, args.flags.type, payload, {
      task_id: args.flags["task-id"],
      phase: args.flags.phase,
    });
    printJson(event);
    return;
  }

  if (command === "set-phase") {
    printJson(setPhase(workspace, runId, args.flags.phase, args.flags.status));
    return;
  }

  if (command === "write-plan") {
    printJson(writePlan(workspace, runId, path.resolve(args.flags.file)));
    return;
  }

  if (command === "write-tasks") {
    printJson(writeTasks(workspace, runId, path.resolve(args.flags.file)));
    return;
  }

  if (command === "write-findings") {
    printJson(writeFindings(workspace, runId, path.resolve(args.flags.file)));
    return;
  }

  if (command === "add-evidence") {
    printJson(addEvidence(workspace, runId, args.flags));
    return;
  }

  if (command === "evidence-report") {
    printJson(evidenceReport(workspace, runId));
    return;
  }

  if (command === "id") {
    printJson({ run_id: runId, fingerprint: fingerprint({ workspace, runId }) });
    return;
  }

  fail(`unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export {
  PHASES,
  EVENT_TYPES,
  createRun,
  writeFindings,
  evidenceReport,
  newRunId,
};
