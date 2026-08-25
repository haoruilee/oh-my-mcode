import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { assertRunId, assertUnder, safeId } from "./safe-path.js";

export interface WorktreeInfo {
  path: string;
  branch: string;
  created: boolean;
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string; status: number } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: (result.status ?? 1) === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  };
}

export function isGitRepo(workspace: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], workspace).ok;
}

export function worktreePath(workspace: string, runId: string, taskId: string): string {
  const root = path.resolve(workspace, ".minimax", "worktrees");
  const dest = path.resolve(root, assertRunId(runId), safeId(taskId, "id_sanitized"));
  return assertUnder(root, dest);
}

export function worktreeBranch(runId: string, taskId: string): string {
  return `omm/${assertRunId(runId)}/${safeId(taskId, "id_sanitized")}`;
}

export function createWorktree(workspace: string, runId: string, taskId: string): WorktreeInfo {
  const dest = worktreePath(workspace, runId, taskId);
  const branch = worktreeBranch(runId, taskId);
  if (!isGitRepo(workspace)) {
    return { path: workspace, branch, created: false };
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    return { path: dest, branch, created: true };
  }
  const added = git(["worktree", "add", "-b", branch, dest, "HEAD"], workspace);
  if (!added.ok) {
    const reused = git(["worktree", "add", dest, branch], workspace);
    if (!reused.ok) return { path: workspace, branch, created: false };
  }
  return { path: dest, branch, created: true };
}

export function mergeWorktree(workspace: string, runId: string, taskId: string): { merged: boolean; message: string } {
  const dest = worktreePath(workspace, runId, taskId);
  const branch = worktreeBranch(runId, taskId);
  if (!isGitRepo(workspace) || !existsSync(dest)) {
    return { merged: false, message: "no worktree to merge" };
  }
  const merged = git(["merge", "--no-ff", "--no-edit", branch], workspace);
  if (!merged.ok) {
    git(["merge", "--abort"], workspace);
    return { merged: false, message: merged.stderr || merged.stdout || "merge failed" };
  }
  removeWorktree(workspace, runId, taskId);
  return { merged: true, message: "merged" };
}

export function removeWorktree(workspace: string, runId: string, taskId: string): void {
  const dest = worktreePath(workspace, runId, taskId);
  if (isGitRepo(workspace) && existsSync(dest)) {
    git(["worktree", "remove", "--force", dest], workspace);
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  const branch = worktreeBranch(runId, taskId);
  git(["branch", "-D", branch], workspace);
}

export function cleanupRunWorktrees(workspace: string, runId: string): void {
  const trees = path.resolve(workspace, ".minimax", "worktrees");
  const root = assertUnder(trees, path.resolve(trees, assertRunId(runId)));
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    removeWorktree(workspace, runId, name);
  }
  rmSync(root, { recursive: true, force: true });
}
