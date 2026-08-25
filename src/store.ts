import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CliError, newEventId, newRunId, nowIso, writeAtomic, writeJson } from "./util.js";
import type {
  AcceptanceItem,
  EvidenceIndex,
  EvidenceKind,
  EvidenceRecord,
  EventType,
  Findings,
  GoalBlockReason,
  GoalSnapshot,
  Phase,
  RunEvent,
  RunRecord,
  RunStatus,
  TaskGraph,
} from "./types.js";
import { EVENT_TYPES, PHASES, STATUSES } from "./types.js";
import { hashesMatch, sha256Bytes, sha256File, type StaleHash } from "./hash.js";
import { seedGoalAcceptance } from "./acceptance.js";
import { assertSafeDestName, assertUnder, isSafeId, safeId } from "./safe-path.js";
import {
  blockGoal as applyBlockGoal,
  completeGoal as applyCompleteGoal,
  createGoalSnapshot,
  DEFAULT_GOAL_MAX_ROUNDS,
  goalChangedPayload,
  startGoalRound as applyStartGoalRound,
  type GoalOperation,
} from "./goal.js";

function nextEvidenceId(items: EvidenceRecord[]): string {
  let max = 0;
  for (const item of items) {
    const match = /^E(\d+)$/.exec(item.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `E${max + 1}`;
}

/** Last index row per destination path wins. Superseded rows are ignored. */
function latestEvidenceByPath(items: EvidenceRecord[]): EvidenceRecord[] {
  const latest = new Map<string, EvidenceRecord>();
  for (const item of items) latest.set(item.path, item);
  return [...latest.values()];
}

function emptyTasks(runId: string): TaskGraph {
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

export class RunStore {
  readonly workspace: string;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
  }

  runsRoot(): string {
    return path.join(this.workspace, ".minimax", "runs");
  }

  dir(runId: string): string {
    const id = isSafeId(runId) ? runId : safeId(runId, "id_sanitized");
    const dest = path.resolve(this.runsRoot(), id);
    return assertUnder(this.runsRoot(), dest);
  }

  listIds(): string[] {
    const root = this.runsRoot();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => name.startsWith("run_") && existsSync(path.join(root, name, "run.json")))
      .sort((a, b) => {
        const aTime = statSync(path.join(root, a, "run.json")).mtimeMs;
        const bTime = statSync(path.join(root, b, "run.json")).mtimeMs;
        return bTime - aTime;
      });
  }

  latestId(): string | undefined {
    return this.listIds()[0];
  }

  resolveId(runId?: string): string {
    if (runId) return runId;
    if (process.env.OMM_RUN_ID) return process.env.OMM_RUN_ID;
    const latest = this.latestId();
    if (!latest) throw new CliError("no runs in this workspace; create one first");
    return latest;
  }

  create(goal: string, extra: { maxRepairs?: number } = {}): RunRecord {
    const trimmed = goal.trim();
    if (!trimmed) throw new CliError("create requires a goal");
    const runId = newRunId();
    const dir = this.dir(runId);
    if (existsSync(dir)) throw new CliError(`run already exists: ${runId}`);
    mkdirSync(path.join(dir, "evidence"), { recursive: true });
    const created = nowIso();
    const maxRounds = extra.maxRepairs ?? DEFAULT_GOAL_MAX_ROUNDS;
    const goal_state = createGoalSnapshot(runId, trimmed, maxRounds);
    const run: RunRecord = {
      run_id: runId,
      goal: trimmed,
      goal_state,
      phase: "INTAKE",
      status: "active",
      created_at: created,
      updated_at: created,
      workspace: this.workspace,
      repair_count: 0,
      ...(extra.maxRepairs != null ? { max_repairs: extra.maxRepairs } : {}),
    };
    writeJson(path.join(dir, "run.json"), run);
    writeAtomic(path.join(dir, "plan.md"), `# Plan\n\nGoal: ${run.goal}\n\n_Planner has not written this file yet._\n`);
    const tasks = emptyTasks(runId);
    tasks.acceptance = seedGoalAcceptance(this.workspace, trimmed);
    writeJson(path.join(dir, "tasks.json"), tasks);
    writeJson(path.join(dir, "evidence/index.json"), { run_id: runId, items: [] } satisfies EvidenceIndex);
    this.appendEventUnlocked(dir, {
      id: newEventId(),
      ts: created,
      type: "run_created",
      run_id: runId,
      phase: "INTAKE",
      payload: { goal: run.goal, acceptance: tasks.acceptance },
    });
    this.appendEventUnlocked(dir, {
      id: newEventId(),
      ts: created,
      type: "goal_changed",
      run_id: runId,
      phase: "INTAKE",
      payload: goalChangedPayload("create", goal_state),
    });
    return run;
  }

  load(runId: string): RunRecord {
    const filePath = path.join(this.dir(runId), "run.json");
    if (!existsSync(filePath)) throw new CliError(`run.json not found: ${filePath}`);
    return JSON.parse(readFileSync(filePath, "utf8")) as RunRecord;
  }

  loadTasks(runId: string): TaskGraph {
    return JSON.parse(readFileSync(path.join(this.dir(runId), "tasks.json"), "utf8")) as TaskGraph;
  }

  loadFindings(runId: string): Findings | undefined {
    const filePath = path.join(this.dir(runId), "findings.json");
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, "utf8")) as Findings;
  }

  loadEvidence(runId: string): EvidenceIndex {
    const filePath = path.join(this.dir(runId), "evidence/index.json");
    if (!existsSync(filePath)) return { run_id: runId, items: [] };
    return JSON.parse(readFileSync(filePath, "utf8")) as EvidenceIndex;
  }

  loadPlan(runId: string): string {
    const filePath = path.join(this.dir(runId), "plan.md");
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  }

  loadEvents(runId: string): RunEvent[] {
    const filePath = path.join(this.dir(runId), "events.jsonl");
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
  }

  withLock<T>(runId: string, fn: () => T): T {
    const dir = this.dir(runId);
    mkdirSync(dir, { recursive: true });
    const lockPath = path.join(dir, ".lock");
    if (existsSync(lockPath)) {
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      if (ageMs < 30_000) throw new CliError(`run directory is locked: ${lockPath}`);
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

  private touch(runId: string, patch: Partial<RunRecord>): RunRecord {
    const current = this.load(runId);
    const next: RunRecord = { ...current, ...patch, updated_at: nowIso() };
    writeJson(path.join(this.dir(runId), "run.json"), next);
    return next;
  }

  patchRun(runId: string, patch: Partial<RunRecord>): RunRecord {
    return this.withLock(runId, () => this.touch(runId, patch));
  }

  private writeGoalUnlocked(
    runId: string,
    snapshot: GoalSnapshot,
    operation: GoalOperation,
    extra: Partial<RunRecord> = {},
  ): GoalSnapshot {
    const next = this.touch(runId, { ...extra, goal_state: snapshot });
    this.appendEventUnlocked(this.dir(runId), {
      id: newEventId(),
      ts: next.updated_at,
      type: "goal_changed",
      run_id: runId,
      phase: next.phase,
      payload: goalChangedPayload(operation, snapshot),
    });
    return snapshot;
  }

  private requireGoal(runId: string): GoalSnapshot {
    const current = this.load(runId).goal_state;
    if (!current) throw new CliError(`run has no goal_state: ${runId}`);
    return current;
  }

  completeGoal(runId: string, expectedRevision: number): GoalSnapshot {
    return this.withLock(runId, () => this.completeGoalUnlocked(runId, expectedRevision));
  }

  blockGoal(runId: string, expectedRevision: number, reason: GoalBlockReason): GoalSnapshot {
    return this.withLock(runId, () => {
      const next = applyBlockGoal(this.requireGoal(runId), expectedRevision, reason);
      return this.writeGoalUnlocked(runId, next, "block", { status: "blocked" });
    });
  }

  startGoalRound(runId: string, expectedRevision: number): GoalSnapshot {
    return this.withLock(runId, () => {
      const next = applyStartGoalRound(this.requireGoal(runId), expectedRevision);
      return this.writeGoalUnlocked(runId, next, "start_round");
    });
  }

  private completeGoalUnlocked(runId: string, expectedRevision: number): GoalSnapshot {
    const next = applyCompleteGoal(this.requireGoal(runId), expectedRevision);
    return this.writeGoalUnlocked(runId, next, "complete");
  }

  readArtifact(runId: string, relativePath: string): string {
    const root = this.dir(runId);
    const full = assertUnder(root, path.resolve(root, relativePath));
    if (!existsSync(full)) return "";
    return readFileSync(full, "utf8");
  }

  private appendEventUnlocked(dir: string, event: RunEvent): void {
    const filePath = path.join(dir, "events.jsonl");
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    writeAtomic(filePath, `${existing}${JSON.stringify(event)}\n`);
  }

  appendEvent(
    runId: string,
    type: EventType,
    payload: Record<string, unknown> = {},
    extra: { task_id?: string; phase?: Phase } = {},
  ): RunEvent {
    if (!EVENT_TYPES.includes(type)) throw new CliError(`unknown event type: ${type}`);
    return this.withLock(runId, () => {
      const run = this.load(runId);
      const event: RunEvent = {
        id: newEventId(),
        ts: nowIso(),
        type,
        run_id: runId,
        phase: extra.phase || run.phase,
        payload,
      };
      if (extra.task_id) event.task_id = extra.task_id;
      this.appendEventUnlocked(this.dir(runId), event);
      this.touch(runId, {});
      return event;
    });
  }

  setPhase(runId: string, phase: Phase, status?: RunStatus): RunRecord {
    if (!PHASES.includes(phase)) throw new CliError(`unknown phase: ${phase}`);
    if (status && !STATUSES.includes(status)) throw new CliError(`unknown status: ${status}`);
    return this.withLock(runId, () => {
      const current = this.load(runId);
      if (current.phase === "ACCEPT" && phase !== "ACCEPT" && phase !== "RELEASE") {
        throw new CliError("accepted runs can only move to RELEASE");
      }
      const nextStatus = status || current.status;
      const next = this.touch(runId, { phase, status: nextStatus });
      this.appendEventUnlocked(this.dir(runId), {
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

  writePlan(runId: string, markdown: string): void {
    this.withLock(runId, () => {
      writeAtomic(path.join(this.dir(runId), "plan.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      this.touch(runId, {});
    });
  }

  writeArtifact(runId: string, relativePath: string, contents: string): string {
    return this.withLock(runId, () => {
      const root = this.dir(runId);
      const dest = assertUnder(root, path.resolve(root, relativePath));
      writeAtomic(dest, contents.endsWith("\n") ? contents : `${contents}\n`);
      this.touch(runId, {});
      return dest;
    });
  }

  cancel(runId: string, reason = "user cancelled"): RunRecord {
    return this.withLock(runId, () => {
      const current = this.load(runId);
      if (current.status === "accepted") {
        throw new CliError("accepted runs cannot be cancelled; use ship to release");
      }
      const next = this.touch(runId, { status: "cancelled" });
      const tasksPath = path.join(this.dir(runId), "tasks.json");
      if (existsSync(tasksPath)) {
        const tasks = this.loadTasks(runId);
        let changed = false;
        for (const task of tasks.tasks) {
          if (task.status === "pending" || task.status === "in_progress") {
            task.status = "cancelled";
            changed = true;
            this.appendEventUnlocked(this.dir(runId), {
              id: newEventId(),
              ts: next.updated_at,
              type: "task_cancelled",
              run_id: runId,
              phase: next.phase,
              task_id: task.id,
              payload: { title: task.title, reason },
            });
          }
        }
        if (changed) {
          writeJson(tasksPath, { ...tasks, updated_at: nowIso() });
        }
      }
      this.appendEventUnlocked(this.dir(runId), {
        id: newEventId(),
        ts: next.updated_at,
        type: "run_cancelled",
        run_id: runId,
        phase: next.phase,
        payload: { reason, from_status: current.status },
      });
      return next;
    });
  }

  writeTasks(runId: string, tasks: TaskGraph): TaskGraph {
    return this.withLock(runId, () => {
      const next: TaskGraph = { ...tasks, run_id: runId, updated_at: nowIso() };
      writeJson(path.join(this.dir(runId), "tasks.json"), next);
      this.touch(runId, {});
      return next;
    });
  }

  addEvidence(
    runId: string,
    kind: EvidenceKind,
    src: string,
    extra: { command?: string; exit_code?: number; notes?: string; name?: string } = {},
  ): EvidenceRecord {
    if (!existsSync(src)) throw new CliError(`evidence source not found: ${src}`);
    return this.withLock(runId, () => {
      const index = this.loadEvidence(runId);
      const destName = assertSafeDestName(extra.name || `${nextEvidenceId(index.items)}-${path.basename(src)}`);
      const destRel = path.posix.join("evidence", destName);
      const existing = index.items.find((item) => item.path === destRel);
      const id = existing?.id ?? nextEvidenceId(index.items);
      const evidenceRoot = path.join(this.dir(runId), "evidence");
      const destAbs = assertUnder(evidenceRoot, path.resolve(evidenceRoot, destName));
      copyFileSync(src, destAbs);
      const record: EvidenceRecord = {
        id,
        kind,
        path: destRel,
        recorded_at: nowIso(),
      };
      if (extra.command) record.command = extra.command;
      if (extra.exit_code !== undefined) record.exit_code = extra.exit_code;
      if (extra.notes) record.notes = extra.notes;
      const digest = sha256File(assertUnder(this.dir(runId), path.resolve(this.dir(runId), destRel)));
      if (digest) record.sha256 = digest;
      if (existing) {
        index.items = index.items.map((item) => (item.path === destRel ? record : item));
      } else {
        index.items.push(record);
      }
      writeJson(path.join(this.dir(runId), "evidence/index.json"), index);
      const eventType: EventType = kind === "test" ? "test_ran" : "tool_called";
      this.appendEventUnlocked(this.dir(runId), {
        id: newEventId(),
        ts: record.recorded_at,
        type: eventType,
        run_id: runId,
        phase: this.load(runId).phase,
        payload: { ...record },
      });
      this.touch(runId, {});
      return record;
    });
  }

  writeTextEvidence(
    runId: string,
    kind: EvidenceKind,
    name: string,
    contents: string,
    extra: { command?: string; exit_code?: number; notes?: string } = {},
  ): EvidenceRecord {
    assertSafeDestName(name);
    const tmp = path.join(this.dir(runId), "evidence", `.incoming-${process.pid}`);
    mkdirSync(path.dirname(tmp), { recursive: true });
    writeFileSync(tmp, contents.endsWith("\n") ? contents : `${contents}\n`);
    try {
      return this.addEvidence(runId, kind, tmp, { ...extra, name });
    } finally {
      if (existsSync(tmp)) rmSync(tmp);
    }
  }

  evidenceFilesExist(runId: string): boolean {
    const index = this.loadEvidence(runId);
    if (index.items.length === 0) return false;
    return index.items.every((item) => {
      try {
        return existsSync(assertUnder(this.dir(runId), path.resolve(this.dir(runId), item.path)));
      } catch {
        return false;
      }
    });
  }

  staleEvidence(runId: string): StaleHash[] {
    const stale: StaleHash[] = [];
    for (const item of latestEvidenceByPath(this.loadEvidence(runId).items)) {
      if (!item.sha256) continue;
      let actual: string | undefined;
      try {
        actual = sha256File(assertUnder(this.dir(runId), path.resolve(this.dir(runId), item.path)));
      } catch {
        actual = undefined;
      }
      if (!hashesMatch(item.sha256, actual)) {
        stale.push({ path: item.path, expected: item.sha256, actual });
      }
    }
    return stale;
  }

  /** Update sha256 / recorded_at for the latest index row of each path. Events stay as-is. */
  refreshEvidenceHashes(runId: string, paths: string[]): EvidenceRecord[] {
    const want = new Set(paths);
    return this.withLock(runId, () => {
      const index = this.loadEvidence(runId);
      const refreshed: EvidenceRecord[] = [];
      for (const item of latestEvidenceByPath(index.items)) {
        if (!want.has(item.path)) continue;
        let digest: string | undefined;
        try {
          digest = sha256File(assertUnder(this.dir(runId), path.resolve(this.dir(runId), item.path)));
        } catch {
          digest = undefined;
        }
        if (!digest) continue;
        item.sha256 = digest;
        item.recorded_at = nowIso();
        refreshed.push(item);
      }
      if (refreshed.length > 0) {
        writeJson(path.join(this.dir(runId), "evidence/index.json"), index);
        this.touch(runId, {});
      }
      return refreshed;
    });
  }

  loadFileHashes(runId: string): Record<string, string> {
    const raw = this.readArtifact(runId, "file-hashes.json");
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  }

  mergeFileHashes(runId: string, hashes?: Record<string, string>): Record<string, string> {
    if (!hashes || Object.keys(hashes).length === 0) return this.loadFileHashes(runId);
    const merged = { ...this.loadFileHashes(runId), ...hashes };
    this.writeArtifact(runId, "file-hashes.json", `${JSON.stringify(merged, null, 2)}\n`);
    return merged;
  }

  writeFindings(runId: string, findings: Findings): { run: RunRecord; findings: Findings } {
    findings.run_id = runId;
    if (!findings.checked_at) findings.checked_at = nowIso();
    if (findings.verdict !== "accepted" && findings.verdict !== "rejected") {
      throw new CliError("findings.verdict must be accepted or rejected");
    }
    if (findings.verdict === "accepted") {
      if (!this.evidenceFilesExist(runId)) {
        throw new CliError("cannot mark Accepted without evidence files");
      }
      const stale = this.staleEvidence(runId);
      if (stale.length > 0) {
        throw new CliError(
          `cannot mark Accepted on stale evidence (${stale.map((item) => item.path).join(", ")})`,
        );
      }
      const failed = (findings.acceptance || []).filter((item) => item.result !== "pass");
      if (failed.length > 0) {
        throw new CliError(`cannot mark Accepted while acceptance is not all pass (${failed.map((a) => a.id).join(", ")})`);
      }
      const blockers = (findings.findings || []).filter((f) => f.severity === "blocker" || f.severity === "major");
      if (blockers.length > 0) {
        throw new CliError("cannot mark Accepted with blocker/major findings");
      }
    }
    for (const finding of findings.findings || []) {
      if (finding.sha256) continue;
      const material =
        (finding.evidence || []).map((rel) => this.readArtifact(runId, rel)).join("\n") ||
        `${finding.title}\n${finding.detail}`;
      finding.sha256 = sha256Bytes(material);
    }
    return this.withLock(runId, () => {
      writeJson(path.join(this.dir(runId), "findings.json"), findings);
      const status: RunStatus = findings.verdict === "accepted" ? "accepted" : "rejected";
      const phase: Phase = findings.verdict === "accepted" ? "ACCEPT" : "REPAIR";
      const current = this.load(runId);
      const completed =
        findings.verdict === "accepted" && current.goal_state
          ? applyCompleteGoal(current.goal_state, current.goal_state.revision)
          : undefined;
      const next = this.touch(runId, { status, phase, ...(completed ? { goal_state: completed } : {}) });
      if (completed) {
        this.appendEventUnlocked(this.dir(runId), {
          id: newEventId(),
          ts: next.updated_at,
          type: "goal_changed",
          run_id: runId,
          phase,
          payload: goalChangedPayload("complete", completed),
        });
      }
      const dir = this.dir(runId);
      this.appendEventUnlocked(dir, {
        id: newEventId(),
        ts: next.updated_at,
        type: "finding_emitted",
        run_id: runId,
        phase,
        payload: { verdict: findings.verdict, finding_count: findings.findings?.length || 0 },
      });
      this.appendEventUnlocked(dir, {
        id: newEventId(),
        ts: next.updated_at,
        type: findings.verdict === "accepted" ? "run_accepted" : "run_rejected",
        run_id: runId,
        phase,
        payload: { summary: findings.summary },
      });
      if (findings.verdict === "rejected") {
        this.appendEventUnlocked(dir, {
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
        this.appendEventUnlocked(dir, {
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

  evidenceReport(runId: string): { run_id: string; path: string; status: RunStatus; phase: Phase } {
    const dir = this.dir(runId);
    const run = this.load(runId);
    const tasks = existsSync(path.join(dir, "tasks.json")) ? this.loadTasks(runId) : undefined;
    const findings = this.loadFindings(runId);
    const evidence = this.loadEvidence(runId);
    const events = this.loadEvents(runId);
    const acceptance: AcceptanceItem[] = findings?.acceptance || tasks?.acceptance || [];
    const lines = [
      `# Evidence report`,
      ``,
      `- run_id: \`${run.run_id}\``,
      `- goal: ${run.goal}`,
      `- phase: ${run.phase}`,
      `- status: ${run.status}`,
      `- created_at: ${run.created_at}`,
      `- updated_at: ${run.updated_at}`,
      `- host_session_id: ${run.host_session_id || "_none_"}`,
      ``,
      `## Acceptance`,
      ``,
    ];
    for (const item of acceptance) {
      const result = item.result ? ` **${item.result}**` : "";
      lines.push(`- ${item.id}: ${item.criterion}${result}`);
    }
    if (acceptance.length === 0) lines.push(`- _none recorded_`);
    lines.push(``, `## Findings`, ``);
    if (findings) {
      lines.push(`Verdict: **${findings.verdict}** — ${findings.summary}`, ``);
      if (findings.findings.length === 0) lines.push(`- none`);
      else for (const finding of findings.findings) lines.push(`- ${finding.id} (${finding.severity}): ${finding.title}`);
    } else {
      lines.push(`_Verifier has not written findings.json._`);
    }
    const repeated = events.find((event) => event.type === "repair_requested" && event.payload?.stop === "repeated_failure");
    const maxed = events.find((event) => event.type === "repair_requested" && event.payload?.stop === "max_repairs");
    const goalBlocked = run.goal_state?.phase === "blocked" ? run.goal_state.blockedReason : undefined;
    if (repeated || maxed || run.last_failure_signature || goalBlocked) {
      lines.push(``, `## Escalation`, ``);
      if (goalBlocked) {
        lines.push(`- Goal blocked (\`${goalBlocked.code}\`): ${goalBlocked.message}`);
      }
      if (repeated) {
        lines.push(
          `- Repeated failure signature \`${String(repeated.payload.signature || run.last_failure_signature || "")}\`. Repair loop stopped. Human intervention required.`,
        );
      }
      if (maxed) {
        lines.push(`- Repair limit reached (${String(maxed.payload.repairs || run.repair_count || "")}).`);
      }
      if (run.ralph) {
        lines.push(`- Ralph mode was on; the run did not reach Accepted within the repair bound.`);
      }
    }
    lines.push(``, `## Evidence files`, ``);
    if (evidence.items.length === 0) lines.push(`- none`);
    else {
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
    const reportPath = path.join(dir, "summary.md");
    writeAtomic(reportPath, lines.join("\n"));
    return { run_id: runId, path: reportPath, status: run.status, phase: run.phase };
  }
}
