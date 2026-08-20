import { createHash } from "node:crypto";
import type { Findings, Phase, RunRecord, TaskContract, TaskGraph, TaskItem } from "./types.js";
import { log, McodeMissingError, nowIso, promptYesNo } from "./util.js";
import { RunStore } from "./store.js";
import { ProcessMcode, resolveMcodeInvocation, type ExecRequest, type ExecResult, type McodeClient } from "./mcode.js";
import {
  detectProjectCommands,
  findingsFromDeterministic,
  judgePrompt,
  optionalLlmJudge,
  runCaptured,
  runDeterministicVerify,
} from "./verify.js";
import { builderPrompt, explorerPrompt, plannerPrompt, plannerTeamPrompt, repairPrompt } from "./prompts.js";
import { execWithRepair } from "./tool-repair.js";
import { drainBuilderWaves } from "./team.js";
import { cleanupRunWorktrees, createWorktree, mergeWorktree } from "./worktree.js";
import { loadWorkflow } from "./workflows.js";

export interface OrchestratorOptions {
  workspace: string;
  goal?: string;
  runId?: string;
  permission?: "ask" | "smart" | "full" | "off";
  approvePlan?: boolean;
  maxRepairs?: number;
  llmVerify?: boolean;
  release?: boolean;
  team?: boolean;
  worktree?: boolean;
  ralph?: boolean;
  concurrency?: number;
  workflow?: string;
  mcode?: McodeClient;
  onLog?: (line: string) => void;
}

function emit(opts: OrchestratorOptions, line: string): void {
  (opts.onLog || log)(line);
}

function extractJsonBlock(text: string): unknown {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence?.[1] || text.match(/(\{[\s\S]*\})/)?.[1];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function tasksFromPlanner(runId: string, goal: string, plannerText: string): TaskGraph {
  const parsed = extractJsonBlock(plannerText) as
    | { tasks?: TaskItem[]; acceptance?: TaskGraph["acceptance"] }
    | undefined;
  if (parsed?.tasks?.length && parsed.acceptance?.length) {
    return {
      run_id: runId,
      updated_at: nowIso(),
      tasks: parsed.tasks.map((task, i) => ({
        id: task.id || `T${i + 1}`,
        title: task.title,
        role: task.role || "builder",
        status: task.status || "pending",
        depends_on: task.depends_on || [],
        notes: task.notes,
        allowed_files: task.allowed_files,
      })),
      acceptance: parsed.acceptance,
    };
  }
  return {
    run_id: runId,
    updated_at: nowIso(),
    tasks: [
      {
        id: "T1",
        title: goal,
        role: "builder",
        status: "pending",
        depends_on: [],
      },
    ],
    acceptance: [
      {
        id: "A1",
        criterion: "Project test or build command exits 0",
        kind: "test",
      },
    ],
  };
}

function planMarkdown(goal: string, discovery: string, plannerText: string): string {
  return `# Plan\n\nGoal: ${goal}\n\n## Discovery\n\n${discovery || "_none_"}\n\n## Planner\n\n${plannerText}\n`;
}

function nextBuilder(tasks: TaskGraph): TaskItem | undefined {
  const done = new Set(tasks.tasks.filter((task) => task.status === "done").map((task) => task.id));
  return tasks.tasks.find(
    (task) =>
      task.role === "builder" &&
      (task.status === "pending" || task.status === "in_progress") &&
      task.depends_on.every((id) => done.has(id)),
  );
}

function markTask(tasks: TaskGraph, id: string, status: TaskItem["status"]): TaskGraph {
  return {
    ...tasks,
    tasks: tasks.tasks.map((task) => (task.id === id ? { ...task, status } : task)),
    updated_at: nowIso(),
  };
}

function contractFor(task: TaskItem, tasks: TaskGraph): TaskContract {
  return {
    task_id: task.id,
    objective: task.title,
    allowed_files: task.allowed_files,
    acceptance: tasks.acceptance.map((item) => `${item.id}: ${item.criterion}${item.command ? ` (${item.command})` : ""}`),
    constraints: ["One task only", "Do not mark Accepted", "Do not start unrelated refactors"],
  };
}

function signatureOf(findings: Findings): string {
  const key = findings.findings
    .map((item) => item.title)
    .sort()
    .join("|");
  return createHash("sha256").update(key || findings.summary).digest("hex").slice(0, 16);
}

function shouldRun(current: Phase, min: Phase, resumeFrom?: Phase): boolean {
  const order: Phase[] = [
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
  const start = resumeFrom || "INTAKE";
  return order.indexOf(start) <= order.indexOf(min) && current !== "ACCEPT";
}

async function persistExec(store: RunStore, runId: string, phase: string, result: ExecResult): Promise<void> {
  store.writeTextEvidence(runId, "log", `mcode-${phase}.jsonl`, result.rawLines.join("\n") || result.text || "(empty)", {
    command: `mcode exec (${phase})`,
    exit_code: result.exitCode,
  });
}

async function execRole(
  client: McodeClient,
  store: RunStore,
  runId: string,
  req: ExecRequest,
): Promise<ExecResult> {
  return execWithRepair(client, req, { store, runId });
}

function discoveryText(store: RunStore, runId: string): string {
  const ev = store.loadEvidence(runId).items.find((item) => item.path.includes("discover"));
  return ev ? store.readArtifact(runId, ev.path) : "";
}

export async function requireClient(opts: OrchestratorOptions, store: RunStore, runId: string): Promise<McodeClient> {
  if (opts.mcode) return opts.mcode;
  try {
    resolveMcodeInvocation();
    return new ProcessMcode();
  } catch (error) {
    if (error instanceof McodeMissingError) {
      store.appendEvent(runId, "tool_called", { error: "mcode_missing" });
    }
    throw error;
  }
}

function rememberOptions(store: RunStore, runId: string, opts: OrchestratorOptions): void {
  store.patchRun(runId, {
    max_repairs: opts.maxRepairs ?? 3,
    ralph: Boolean(opts.ralph),
    team: Boolean(opts.team),
    workflow: opts.workflow || (opts.team ? "team" : "max"),
  });
}

export async function runMax(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const run = opts.runId ? store.load(opts.runId) : store.create(opts.goal || "");
  rememberOptions(store, run.run_id, { ...opts, workflow: opts.workflow || (opts.team ? "team" : "max") });
  emit(opts, `run ${run.run_id} at ${store.dir(run.run_id)}`);
  const client = await requireClient(opts, store, run.run_id);
  return drive(store, client, run.run_id, opts, { stopAfter: "ACCEPT" });
}

export async function runTeam(opts: OrchestratorOptions): Promise<RunRecord> {
  return runMax({ ...opts, team: true, workflow: "team" });
}

export async function runPlan(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const run = opts.runId ? store.load(opts.runId) : store.create(opts.goal || "");
  rememberOptions(store, run.run_id, { ...opts, workflow: opts.workflow || "plan" });
  emit(opts, `run ${run.run_id} at ${store.dir(run.run_id)}`);
  const client = await requireClient(opts, store, run.run_id);
  return drive(store, client, run.run_id, { ...opts, workflow: opts.workflow || "plan" }, { stopAfter: "PLAN_REVIEW" });
}

export async function runVerifyOnly(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const runId = store.resolveId(opts.runId);
  store.setPhase(runId, "VERIFY");
  const client = opts.mcode;
  await verifyPhase(store, runId, opts, client);
  return store.load(runId);
}

export async function runResume(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const runId = store.resolveId(opts.runId);
  const run = store.load(runId);
  store.appendEvent(runId, "run_resumed", { from_phase: run.phase, goal: run.goal });
  emit(opts, `resuming ${runId} from ${run.phase}`);
  if (run.phase === "ACCEPT" || run.phase === "RELEASE") {
    store.evidenceReport(runId);
    return store.load(runId);
  }
  if (run.status === "cancelled") {
    emit(opts, `run ${runId} is cancelled`);
    return run;
  }
  const client = await requireClient(opts, store, runId);
  const plannedOnly = run.phase === "PLAN" || run.phase === "PLAN_REVIEW";
  const stopAfter = plannedOnly && !opts.ralph ? "PLAN_REVIEW" : "ACCEPT";
  return drive(store, client, runId, opts, { stopAfter, resumeFrom: run.phase });
}

async function verifyWorktreeSlice(workspace: string): Promise<boolean> {
  const detected = detectProjectCommands(workspace);
  const command = detected.test || detected.build;
  if (!command) return true;
  const result = await runCaptured(command, workspace);
  return result.exitCode === 0;
}

async function executeOneBuilder(
  store: RunStore,
  client: McodeClient,
  runId: string,
  opts: OrchestratorOptions,
  task: TaskItem,
  permission: NonNullable<OrchestratorOptions["permission"]>,
): Promise<void> {
  let tasks = markTask(store.loadTasks(runId), task.id, "in_progress");
  store.writeTasks(runId, tasks);
  store.appendEvent(runId, "task_started", { title: task.title }, { task_id: task.id });
  const prior = store.loadFindings(runId);
  const prompt =
    prior && prior.verdict === "rejected"
      ? repairPrompt(contractFor(task, tasks), JSON.stringify(prior.findings, null, 2))
      : builderPrompt(contractFor(task, tasks));
  let cwd = opts.workspace;
  let worktree: ReturnType<typeof createWorktree> | undefined;
  if (opts.worktree) {
    worktree = createWorktree(opts.workspace, runId, task.id);
    if (worktree.created) {
      cwd = worktree.path;
      store.appendEvent(runId, "worktree_created", { path: worktree.path, branch: worktree.branch }, { task_id: task.id });
    }
  }
  const result = await execRole(client, store, runId, {
    cwd,
    prompt,
    role: "builder",
    permission,
  });
  await persistExec(store, runId, `execute-${task.id}`, result);
  if (worktree?.created) {
    const sliceOk = await verifyWorktreeSlice(worktree.path);
    if (sliceOk) mergeWorktree(opts.workspace, runId, task.id);
    else emit(opts, `worktree verify slice failed for ${task.id}; not merging`);
  }
  store.writeTasks(runId, markTask(store.loadTasks(runId), task.id, "done"));
  store.appendEvent(runId, "task_completed", { title: task.title }, { task_id: task.id });
}

async function drive(
  store: RunStore,
  client: McodeClient,
  runId: string,
  opts: OrchestratorOptions,
  ctrl: { stopAfter: Phase; resumeFrom?: Phase },
): Promise<RunRecord> {
  const workflow = loadWorkflow(opts.workflow || (opts.team ? "team" : "max"));
  const permission = opts.permission || "smart";
  const maxRepairs = opts.maxRepairs ?? 3;
  const concurrency = opts.concurrency ?? 2;
  let run = store.load(runId);
  if (run.status === "cancelled") return run;

  if (shouldRun(run.phase, "DISCOVER", ctrl.resumeFrom) && workflow.phases.includes("DISCOVER")) {
    store.setPhase(runId, "DISCOVER");
    emit(opts, "phase DISCOVER");
    const result = await execRole(client, store, runId, {
      cwd: opts.workspace,
      prompt: explorerPrompt(run.goal),
      role: "explorer",
      permission: permission === "full" ? "ask" : permission,
    });
    await persistExec(store, runId, "discover", result);
    store.writeTextEvidence(runId, "log", "discover.md", result.text || "(no explorer output)", {
      notes: "explorer",
    });
    run = store.load(runId);
  }

  if (shouldRun(store.load(runId).phase, "PLAN", ctrl.resumeFrom) && ctrl.stopAfter !== "INTAKE") {
    store.setPhase(runId, "PLAN");
    emit(opts, "phase PLAN");
    const discoverBody = discoveryText(store, runId);
    const result = await execRole(client, store, runId, {
      cwd: opts.workspace,
      prompt: opts.team ? plannerTeamPrompt(run.goal, discoverBody) : plannerPrompt(run.goal, discoverBody),
      role: "planner",
      permission: "ask",
    });
    await persistExec(store, runId, "plan", result);
    store.writePlan(runId, planMarkdown(run.goal, discoverBody, result.text));
    store.writeTasks(runId, tasksFromPlanner(runId, run.goal, result.text));
  }

  if (ctrl.stopAfter === "PLAN_REVIEW" || shouldRun(store.load(runId).phase, "PLAN_REVIEW", ctrl.resumeFrom)) {
    store.setPhase(runId, "PLAN_REVIEW");
    emit(opts, "phase PLAN_REVIEW");
    if (opts.approvePlan) {
      const ok = await promptYesNo("Proceed with this plan?");
      if (!ok) return store.load(runId);
    } else {
      store.appendEvent(runId, "tool_called", { plan_review: "auto-continue" });
    }
    if (ctrl.stopAfter === "PLAN_REVIEW") {
      store.evidenceReport(runId);
      return store.load(runId);
    }
  }

  while (true) {
    run = store.load(runId);
    if (run.phase === "ACCEPT" || run.status === "cancelled") break;

    store.setPhase(runId, "EXECUTE", "active");
    emit(opts, "phase EXECUTE");
    if (opts.team) {
      await drainBuilderWaves(
        () => store.loadTasks(runId),
        async (task) => executeOneBuilder(store, client, runId, opts, task, permission),
        concurrency,
        (wave) => {
          store.appendEvent(runId, "team_spawned", {
            count: wave.length,
            task_ids: wave.map((item) => item.id),
            grandchildren: false,
          });
        },
      );
    } else {
      const task = nextBuilder(store.loadTasks(runId));
      if (task) await executeOneBuilder(store, client, runId, opts, task, permission);
    }

    const verdict = await verifyPhase(store, runId, opts, client);
    if (verdict === "accepted") break;

    const findings = store.loadFindings(runId);
    if (!findings) break;
    const sig = signatureOf(findings);
    const current = store.load(runId);
    const repairs = (current.repair_count || 0) + 1;
    if (current.last_failure_signature === sig) {
      emit(opts, "repeated failure signature; stopping repair loop");
      store.appendEvent(runId, "repair_requested", { stop: "repeated_failure", signature: sig });
      break;
    }
    if (repairs > maxRepairs) {
      emit(opts, `repair limit reached (${maxRepairs})`);
      store.appendEvent(runId, "repair_requested", { stop: "max_repairs", repairs });
      break;
    }
    store.patchRun(runId, { repair_count: repairs, last_failure_signature: sig, status: "rejected" });
    store.setPhase(runId, "REPAIR", "rejected");
    const currentTasks = store.loadTasks(runId);
    const nextId = `T${currentTasks.tasks.length + 1}`;
    currentTasks.tasks.push({
      id: nextId,
      title: `Repair: ${findings.findings[0]?.title || "address verifier findings"}`,
      role: "builder",
      status: "pending",
      depends_on: currentTasks.tasks.filter((t) => t.role === "builder").map((t) => t.id),
    });
    store.writeTasks(runId, currentTasks);
    store.appendEvent(runId, "repair_requested", { task_id: nextId, signature: sig });
  }

  if (store.load(runId).status === "cancelled") {
    cleanupRunWorktrees(opts.workspace, runId);
  }
  if (opts.release && store.load(runId).status === "accepted") {
    store.setPhase(runId, "RELEASE");
    emit(opts, "phase RELEASE — commit/PR yourself after Accepted; this is not a second VCS CLI");
  }
  store.evidenceReport(runId);
  return store.load(runId);
}

async function verifyPhase(
  store: RunStore,
  runId: string,
  opts: OrchestratorOptions,
  client?: McodeClient,
): Promise<"accepted" | "rejected"> {
  store.setPhase(runId, "VERIFY", "active");
  emit(opts, "phase VERIFY (deterministic first)");
  const det = await runDeterministicVerify(store, runId, opts.workspace);
  const extra: Findings["findings"] = [];
  if (opts.llmVerify !== false && client) {
    try {
      const run = store.load(runId);
      const judged = await optionalLlmJudge(
        client,
        opts.workspace,
        "verifier",
        judgePrompt(run.goal, store.loadPlan(runId), det),
        "ask",
      );
      await persistExec(store, runId, "verify-llm", judged);
      const parsed = extractJsonBlock(judged.text) as { blockers?: { title: string; detail: string }[] } | undefined;
      if (parsed?.blockers?.length) {
        for (const [i, item] of parsed.blockers.entries()) {
          extra.push({
            id: `F${det.findings.length + i + 1}`,
            severity: "major",
            title: item.title,
            detail: item.detail,
          });
        }
      }
    } catch (error) {
      emit(opts, `LLM verifier skipped: ${(error as Error).message}`);
    }
  }
  const findings = findingsFromDeterministic(runId, det, extra);
  try {
    store.writeFindings(runId, findings);
  } catch (error) {
    if (findings.verdict === "accepted") {
      findings.verdict = "rejected";
      findings.summary = `Acceptance blocked: ${(error as Error).message}`;
      findings.findings.push({
        id: `F${findings.findings.length + 1}`,
        severity: "blocker",
        title: "Accepted without evidence is forbidden",
        detail: (error as Error).message,
      });
      store.writeFindings(runId, findings);
    } else {
      throw error;
    }
  }
  store.evidenceReport(runId);
  return store.load(runId).status === "accepted" ? "accepted" : "rejected";
}
