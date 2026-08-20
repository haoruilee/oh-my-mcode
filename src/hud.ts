import type { Phase, Role, RunEvent, RunRecord, TaskGraph, TaskItem } from "./types.js";
import { RunStore } from "./store.js";

const PHASE_ORDER: Phase[] = [
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

function markForRole(role: Role, run: RunRecord, tasks: TaskGraph): string {
  const roleTasks = tasks.tasks.filter((task) => task.role === role);
  if (roleTasks.some((task) => task.status === "in_progress")) return "◉";
  if (roleTasks.length > 0 && roleTasks.every((task) => task.status === "done")) return "✓";
  if (roleTasks.some((task) => task.status === "done")) return "◉";
  const idx = PHASE_ORDER.indexOf(run.phase);
  if (role === "explorer") return idx > PHASE_ORDER.indexOf("DISCOVER") || run.phase === "DISCOVER" && run.status !== "active" ? "✓" : idx >= PHASE_ORDER.indexOf("DISCOVER") ? "◉" : "○";
  if (role === "planner") return idx > PHASE_ORDER.indexOf("PLAN") ? "✓" : idx >= PHASE_ORDER.indexOf("PLAN") ? "◉" : "○";
  if (role === "builder") return idx > PHASE_ORDER.indexOf("EXECUTE") ? "✓" : idx === PHASE_ORDER.indexOf("EXECUTE") || idx === PHASE_ORDER.indexOf("REPAIR") ? "◉" : "○";
  if (role === "verifier") {
    if (run.status === "accepted" || run.phase === "ACCEPT" || run.phase === "RELEASE") return "✓";
    if (run.phase === "VERIFY") return "◉";
    return idx > PHASE_ORDER.indexOf("VERIFY") ? "✓" : "...";
  }
  if (role === "release") return run.phase === "RELEASE" ? "✓" : "○";
  return "○";
}

function taskMark(task: TaskItem): string {
  if (task.status === "done") return "✓";
  if (task.status === "in_progress") return "◉";
  if (task.status === "cancelled") return "×";
  if (task.status === "blocked") return "…";
  return "○";
}

export interface HudModel {
  run: RunRecord;
  tasks: TaskGraph;
  events: RunEvent[];
  evidenceCount: number;
  maxRepairs: number;
}

export function loadHud(store: RunStore, runId: string, maxRepairs = 3): HudModel {
  return {
    run: store.load(runId),
    tasks: store.loadTasks(runId),
    events: store.loadEvents(runId),
    evidenceCount: store.loadEvidence(runId).items.length,
    maxRepairs: store.load(runId).max_repairs ?? maxRepairs,
  };
}

export function renderHud(model: HudModel): string {
  const { run, tasks, events, evidenceCount, maxRepairs } = model;
  const status = run.status === "active" ? "running" : run.status;
  const explorer = markForRole("explorer", run, tasks);
  const planner = markForRole("planner", run, tasks);
  const builder = markForRole("builder", run, tasks);
  const verifier = markForRole("verifier", run, tasks);
  const lines = [
    `Run: ${run.run_id}  Phase: ${run.phase}  Status: ${status}`,
    `Goal: ${run.goal}`,
    `Explorer ${explorer}  Planner ${planner}  Builder ${builder}  Verifier ${verifier}`,
    `Tasks:`,
  ];
  const visible = tasks.tasks.filter((task) => task.role === "builder" || task.status !== "pending" || task.title !== "Intake and restated goal");
  const listed = visible.length > 0 ? visible : tasks.tasks;
  for (const task of listed.slice(0, 12)) {
    lines.push(`  ${taskMark(task)} ${task.title}`);
  }
  if (listed.length === 0) lines.push(`  ○ (none)`);
  const last = events.slice(-3);
  if (last.length > 0) {
    lines.push(`Events:`);
    for (const event of last) {
      lines.push(`  ${event.type}${event.task_id ? ` ${event.task_id}` : ""}`);
    }
  }
  lines.push(
    `Evidence: ${evidenceCount} files  Repairs: ${run.repair_count || 0}/${maxRepairs}  Cache/cost: n/a if unknown`,
  );
  return lines.join("\n");
}

export function attachHud(store: RunStore, runId: string, maxRepairs = 3): string {
  store.appendEvent(runId, "hud_attached", { source: "cli" });
  return renderHud(loadHud(store, runId, maxRepairs));
}

export async function watchHud(
  store: RunStore,
  runId: string,
  opts: { maxRepairs?: number; intervalMs?: number; write?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const write = opts.write || ((text) => process.stdout.write(`${text}\n`));
  const intervalMs = opts.intervalMs ?? 1000;
  write(attachHud(store, runId, opts.maxRepairs));
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (opts.signal?.aborted) {
        clearInterval(timer);
        resolve();
        return;
      }
      write(renderHud(loadHud(store, runId, opts.maxRepairs)));
      const run = store.load(runId);
      if (run.status === "accepted" || run.status === "cancelled" || run.phase === "RELEASE") {
        clearInterval(timer);
        resolve();
      }
    }, intervalMs);
    opts.signal?.addEventListener("abort", () => {
      clearInterval(timer);
      resolve();
    });
  });
}
