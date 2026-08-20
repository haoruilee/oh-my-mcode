import type { TaskGraph, TaskItem } from "./types.js";

export function readyBuilders(tasks: TaskGraph): TaskItem[] {
  const done = new Set(tasks.tasks.filter((task) => task.status === "done").map((task) => task.id));
  return tasks.tasks.filter(
    (task) =>
      task.role === "builder" &&
      (task.status === "pending" || task.status === "in_progress") &&
      task.depends_on.every((id) => done.has(id)),
  );
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length) as R[];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Drain independent builder waves. The orchestrator is the only scheduler —
 * execute() must not spawn grandchild agents.
 */
export async function drainBuilderWaves(
  loadTasks: () => TaskGraph,
  execute: (task: TaskItem) => Promise<void>,
  concurrency: number,
  onWave?: (wave: TaskItem[]) => void,
): Promise<number> {
  let executed = 0;
  const seen = new Set<string>();
  for (let safety = 0; safety < 32; safety += 1) {
    const ready = readyBuilders(loadTasks()).filter((task) => !seen.has(task.id));
    if (ready.length === 0) break;
    for (const task of ready) seen.add(task.id);
    onWave?.(ready);
    await mapPool(ready, concurrency, async (task) => {
      await execute(task);
      executed += 1;
    });
  }
  return executed;
}
