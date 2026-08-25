import { createHash } from "node:crypto";
import type { Findings, Phase, RunRecord, TaskContract, TaskGraph, TaskItem } from "./types.js";
import { log, McodeMissingError, nowIso, promptYesNo } from "./util.js";
import { RunStore } from "./store.js";
import {
  classifyHostExit,
  isHostNativeCrash,
  ProcessMcode,
  resolveMcodeInvocation,
  type ExecRequest,
  type ExecResult,
  type McodeClient,
} from "./mcode.js";
import {
  applyRequestedSession,
  emitHostSessionHints,
  judgeEvidenceFiles,
  type SessionOpts,
} from "./session.js";
import { spawnSubagent, type SpawnResult } from "./subagent.js";
import { interviewContext } from "./interview.js";
import {
  coerceJsonValue,
  extractExecResultAnswer,
  looksLikePlannerGraph,
  writeExecPhaseSnapshots,
} from "./yield.js";
import {
  detectProjectCommands,
  findingsFromDeterministic,
  judgePrompt,
  runCaptured,
  runDeterministicVerify,
} from "./verify.js";
import { builderPrompt, explorerPrompt, plannerPrompt, plannerTeamPrompt, repairPrompt } from "./prompts.js";
import { buildTeamPacket, drainBuilderWaves } from "./team.js";
import { cleanupRunWorktrees, createWorktree, mergeWorktree } from "./worktree.js";
import { loadWorkflow } from "./workflows.js";
import {
  formatAcceptanceAnnouncement,
  hasRunnableAcceptance,
  mergeAcceptance,
  seedGoalAcceptance,
  shouldSkipDiscover,
  skippedDiscoverText,
} from "./acceptance.js";

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
  session?: string;
  noSession?: boolean;
  continue?: boolean;
  resumeFrom?: Phase;
  interview?: boolean;
  /** Force the explorer host exec on `max` even when the goal is already concrete. */
  discover?: boolean;
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

function plannerGraphFromResult(result: ExecResult): unknown {
  const data = result.structuredOutput && typeof result.structuredOutput === "object" ? result.structuredOutput.data : undefined;
  if (looksLikePlannerGraph(data)) return data;
  for (const event of result.events || []) {
    const raw = event.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const answer = coerceJsonValue(rec.answer);
    if (looksLikePlannerGraph(answer)) return answer;
  }
  const fromText = extractJsonBlock(result.text || "");
  if (looksLikePlannerGraph(fromText)) return fromText;
  return undefined;
}

function planningYieldKind(result: ExecResult): "ok" | "blocked" | "failed" {
  const worker = "yield" in result ? (result as SpawnResult).yield : undefined;
  if (!worker) return "failed";
  if (worker.status === "ok") return "ok";
  if (worker.status === "blocked") return "blocked";
  return "failed";
}

function rejectPlanningYield(
  store: RunStore,
  runId: string,
  phase: "DISCOVER" | "PLAN",
  result: ExecResult,
  opts: OrchestratorOptions,
  kind: "blocked" | "failed",
): RunRecord {
  const worker = "yield" in result ? (result as SpawnResult).yield : undefined;
  const status = kind === "blocked" ? "blocked" : "rejected";
  const reason = kind === "blocked" ? "blocked_worker_yield" : "failed_worker_yield";
  store.setPhase(runId, phase, status);
  store.appendEvent(runId, "run_rejected", {
    reason,
    phase,
    status: worker?.status,
    summary: worker?.summary,
    exit_code: result.exitCode,
    class: isHostNativeCrash(result) || classifyHostExit(result.exitCode) === "crash" ? "host_crash" : undefined,
  });
  emit(
    opts,
    `${phase} ${kind}: ${worker?.summary || (kind === "blocked" ? "worker yield blocked" : "worker yield failed")} (exit ${result.exitCode})`,
  );
  store.evidenceReport(runId);
  const finished = store.load(runId);
  emitHostSessionHints(finished, (line) => emit(opts, line));
  return finished;
}

function tasksFromPlanner(runId: string, goal: string, result: ExecResult, existing?: TaskGraph): TaskGraph {
  const parsed = plannerGraphFromResult(result) as
    | { tasks?: TaskItem[]; acceptance?: TaskGraph["acceptance"] }
    | undefined;
  const seeded = existing?.acceptance || [];
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
      acceptance: mergeAcceptance(seeded, parsed.acceptance),
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
    acceptance: mergeAcceptance(seeded, [
      {
        id: "A1",
        criterion: "Project test or build command exits 0",
        kind: "test",
      },
    ]),
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

function isEvidenceStorePath(item: Findings["findings"][number]): boolean {
  const marked = item.evidence?.[0] || "";
  if (marked.startsWith("evidence/") || marked === "evidence") return true;
  return item.title.startsWith("Stale content hash: evidence/");
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

function yieldSummary(result: ExecResult, fallback = ""): string {
  const worker = "yield" in result ? (result as SpawnResult).yield : undefined;
  if (worker?.summary) return worker.summary;
  return fallback;
}

function shortHostNote(result: ExecResult): string {
  const kind = classifyHostExit(result.exitCode);
  if (isHostNativeCrash(result)) return "host crash: native sqlite/assert abort; yield may be truncated";
  if (kind === "crash") return `host crash (exit ${result.exitCode})`;
  if (kind === "invocation") return `host invocation (exit ${result.exitCode})`;
  return "";
}

function discoverEvidenceText(result: ExecResult): string {
  const spawned = result as SpawnResult;
  const worker = "yield" in result ? spawned.yield : undefined;
  if (worker?.status === "ok" && worker.summary) return worker.summary;
  const first = spawned.firstExec ?? result;
  const reminder = spawned.reminderExec;
  const crashRetry = spawned.crashRetryExec;
  const parts: string[] = [];
  if (worker?.summary) parts.push(worker.summary);
  const text = (first.text || result.text || "").trim();
  if (text && text !== worker?.summary) parts.push(text.slice(0, 4000));
  const answer = extractExecResultAnswer(first);
  if (answer !== undefined) {
    const rendered = typeof answer === "string" ? answer : JSON.stringify(answer);
    if (rendered && rendered !== text && rendered !== worker?.summary) parts.push(rendered.slice(0, 2000));
  }
  for (const follow of [reminder, crashRetry]) {
    if (!follow) continue;
    const followText = (follow.text || "").trim();
    if (followText && followText !== text && followText !== worker?.summary) parts.push(followText.slice(0, 800));
    const note = shortHostNote(follow);
    if (note) parts.push(note);
  }
  const firstNote = shortHostNote(first);
  if (firstNote && !parts.includes(firstNote)) parts.push(firstNote);
  return parts.filter(Boolean).join("\n\n") || "(no explorer yield)";
}

async function persistExec(store: RunStore, runId: string, phase: string, result: ExecResult): Promise<void> {
  const worker = "yield" in result ? (result as SpawnResult).yield : undefined;
  if (worker) {
    store.writeArtifact(runId, `yield-${phase}.json`, `${JSON.stringify(worker, null, 2)}\n`);
    store.writeTextEvidence(runId, "log", `yield-${phase}.json`, JSON.stringify(worker), {
      notes: "structured worker yield",
      exit_code: result.exitCode,
    });
    store.mergeFileHashes(runId, worker.file_hashes);
  }
  writeExecPhaseSnapshots(store, runId, phase, result, {
    hashes: worker?.file_hashes || store.loadFileHashes(runId),
    yieldStatus: worker?.status ?? null,
  });
}

function sessionOptsOf(opts: OrchestratorOptions, extra: SessionOpts = {}): SessionOpts {
  return {
    noSession: opts.noSession,
    session: opts.session,
    continue: opts.continue,
    ...extra,
  };
}

async function execRole(
  client: McodeClient,
  store: RunStore,
  runId: string,
  req: ExecRequest,
  opts: OrchestratorOptions,
  extra: SessionOpts = {},
): Promise<SpawnResult> {
  return spawnSubagent(
    {
      role: req.role,
      contract: {
        task_id: req.role,
        objective: req.prompt.slice(0, 240),
        acceptance: [],
        constraints: ["One role exec", "Do not mark Accepted", "Do not spawn sub-agents"],
      },
      session: req.session,
      permission: req.permission,
      cwd: req.cwd,
      prompt: req.prompt,
      files: req.files,
      timeoutMs: req.timeoutMs,
      maxSteps: req.maxSteps,
      outputSchema: req.outputSchema,
    },
    { client, store, runId, sessionOpts: sessionOptsOf(opts, extra) },
  );
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

function announceAcceptance(store: RunStore, runId: string, opts: OrchestratorOptions): void {
  const run = store.load(runId);
  const tasks = store.loadTasks(runId);
  if (!hasRunnableAcceptance(tasks.acceptance)) {
    const seeded = seedGoalAcceptance(opts.workspace, run.goal);
    if (seeded.length) {
      store.writeTasks(runId, { ...tasks, acceptance: seeded, updated_at: nowIso() });
    }
  }
  const acceptance = store.loadTasks(runId).acceptance;
  for (const line of formatAcceptanceAnnouncement(runId, acceptance)) emit(opts, line);
}

export async function runMax(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const run = opts.runId ? store.load(opts.runId) : store.create(opts.goal || "");
  rememberOptions(store, run.run_id, { ...opts, workflow: opts.workflow || (opts.team ? "team" : "max") });
  applyRequestedSession(store, run.run_id, opts);
  emit(opts, `run ${run.run_id} at ${store.dir(run.run_id)}`);
  announceAcceptance(store, run.run_id, opts);
  const client = await requireClient(opts, store, run.run_id);
  return drive(store, client, run.run_id, opts, { stopAfter: "ACCEPT", resumeFrom: opts.resumeFrom });
}

export async function runTeam(opts: OrchestratorOptions): Promise<RunRecord> {
  return runMax({ ...opts, team: true, workflow: "team" });
}

export async function runPlan(opts: OrchestratorOptions): Promise<RunRecord> {
  const store = new RunStore(opts.workspace);
  const run = opts.runId ? store.load(opts.runId) : store.create(opts.goal || "");
  rememberOptions(store, run.run_id, { ...opts, workflow: opts.workflow || "plan" });
  applyRequestedSession(store, run.run_id, opts);
  emit(opts, `run ${run.run_id} at ${store.dir(run.run_id)}`);
  announceAcceptance(store, run.run_id, opts);
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
  applyRequestedSession(store, runId, opts);
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
  const run = store.load(runId);
  const packet = buildTeamPacket({
    goal: run.goal,
    discovery: discoveryText(store, runId),
    interview: interviewContext(store, runId),
    tasks: tasks.tasks,
  });
  store.writeArtifact(runId, "team-packet.json", `${JSON.stringify(packet, null, 2)}\n`);
  const compactFindings = (prior?.findings || []).map((item) => `${item.severity}: ${item.title}`).join("\n");
  const prompt =
    prior && prior.verdict === "rejected"
      ? repairPrompt(contractFor(task, tasks), compactFindings, packet.context)
      : builderPrompt(contractFor(task, tasks), packet.context);
  let cwd = opts.workspace;
  let worktree: ReturnType<typeof createWorktree> | undefined;
  if (opts.worktree) {
    worktree = createWorktree(opts.workspace, runId, task.id);
    if (worktree.created) {
      cwd = worktree.path;
      store.appendEvent(runId, "worktree_created", { path: worktree.path, branch: worktree.branch }, { task_id: task.id });
    }
  }
  const result = await spawnSubagent(
    {
      role: "builder",
      contract: contractFor(task, tasks),
      permission,
      cwd,
      prompt,
    },
    { client, store, runId, sessionOpts: sessionOptsOf(opts, { isolated: Boolean(worktree?.created) }) },
  );
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
    const skipDiscover = shouldSkipDiscover({
      workflow: opts.workflow || workflow.id,
      forceDiscover: Boolean(opts.discover),
      goal: run.goal,
      workspace: opts.workspace,
    });
    if (skipDiscover) {
      emit(opts, "phase DISCOVER (skipped: goal already concrete)");
      const acceptance = store.loadTasks(runId).acceptance;
      const body = skippedDiscoverText(run.goal, acceptance);
      store.writeTextEvidence(runId, "log", "discover.md", body, {
        notes: "skipped discover; goal already concrete + detected test/build; not a repo map",
      });
      store.writeArtifact(
        runId,
        "exec-snapshot-discover.json",
        `${JSON.stringify(
          {
            skipped: true,
            reason: "goal already concrete",
            assistant_text: "",
            yield_status: null,
            acceptance,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      emit(opts, "phase DISCOVER");
      const result = await execRole(
        client,
        store,
        runId,
        {
          cwd: opts.workspace,
          prompt: explorerPrompt(run.goal, interviewContext(store, runId)),
          role: "explorer",
          permission: permission === "full" ? "ask" : permission,
        },
        opts,
      );
      await persistExec(store, runId, "discover", result);
      store.writeTextEvidence(runId, "log", "discover.md", discoverEvidenceText(result), {
        notes: "explorer yield.summary / assistant JSON / short crash note; not native stacks",
      });
      const discoverKind = planningYieldKind(result);
      if (discoverKind !== "ok") {
        return rejectPlanningYield(store, runId, "DISCOVER", result, opts, discoverKind);
      }
    }
    run = store.load(runId);
  }

  if (shouldRun(store.load(runId).phase, "PLAN", ctrl.resumeFrom) && ctrl.stopAfter !== "INTAKE") {
    store.setPhase(runId, "PLAN");
    emit(opts, "phase PLAN");
    const discoverBody = discoveryText(store, runId);
    const result = await execRole(
      client,
      store,
      runId,
      {
        cwd: opts.workspace,
        prompt: opts.team
          ? plannerTeamPrompt(run.goal, discoverBody, interviewContext(store, runId))
          : plannerPrompt(run.goal, discoverBody, interviewContext(store, runId)),
        role: "planner",
        permission: "ask",
      },
      opts,
    );
    await persistExec(store, runId, "plan", result);
    const planKind = planningYieldKind(result);
    if (planKind !== "ok") {
      return rejectPlanningYield(store, runId, "PLAN", result, opts, planKind);
    }
    store.writePlan(runId, planMarkdown(run.goal, discoverBody, yieldSummary(result, "planner yield")));
    store.writeTasks(runId, tasksFromPlanner(runId, run.goal, result, store.loadTasks(runId)));
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
      const planned = store.load(runId);
      emitHostSessionHints(planned, (line) => emit(opts, line));
      return planned;
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
  const finished = store.load(runId);
  emitHostSessionHints(finished, (line) => emit(opts, line));
  return finished;
}

async function verifyPhase(
  store: RunStore,
  runId: string,
  opts: OrchestratorOptions,
  client?: McodeClient,
): Promise<"accepted" | "rejected"> {
  store.setPhase(runId, "VERIFY", "active");
  emit(opts, "phase VERIFY (deterministic first)");
  let det = await runDeterministicVerify(store, runId, opts.workspace);
  const workspaceStale = det.findings.some(
    (item) => item.title.startsWith("Stale content hash") && !isEvidenceStorePath(item),
  );
  if (workspaceStale) {
    emit(opts, "stale content hash; re-running deterministic tests");
    det = await runDeterministicVerify(store, runId, opts.workspace);
  }
  const extra: Findings["findings"] = [];
  if (opts.llmVerify !== false && client) {
    try {
      const run = store.load(runId);
      const judged = await execRole(
        client,
        store,
        runId,
        {
          cwd: opts.workspace,
          prompt: judgePrompt(run.goal, store.loadPlan(runId), det),
          role: "verifier",
          permission: "ask",
          files: judgeEvidenceFiles(store, runId),
        },
        opts,
      );
      await persistExec(store, runId, "verify-llm", judged);
      if (judged.yield.findings.length) {
        for (const [i, item] of judged.yield.findings.entries()) {
          extra.push({
            id: `F${det.findings.length + i + 1}`,
            severity: item.severity,
            title: item.title,
            detail: item.detail,
            evidence: item.evidence,
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
