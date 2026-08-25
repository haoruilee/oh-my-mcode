import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { CliError } from "./util.js";

/** Planner/task/acceptance/run path ids. `T1`, `A1`, `execute-T2`, `run_…`. */
export const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function isSafeId(id: string): boolean {
  return typeof id === "string" && SAFE_ID_RE.test(id);
}

/**
 * Keep a legal id, otherwise a stable fallback (`T1` / `A1` / `id_sanitized`).
 * Does not invent a path. Callers still `assertUnder` after resolve.
 */
export function safeId(id: string | undefined, fallback: string): string {
  if (id && isSafeId(id)) return id;
  if (isSafeId(fallback)) return fallback;
  return "id_sanitized";
}

/**
 * After `path.resolve`, dest must be root or start with root + sep.
 * If dest (or an existing ancestor still under root) is a symlink whose
 * realpath leaves root, refuse.
 */
export function assertUnder(root: string, dest: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedDest = path.resolve(dest);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(prefix)) {
    throw new CliError(`path escapes root: ${dest}`);
  }
  if (existsSync(resolvedDest)) {
    assertRealUnder(resolvedRoot, resolvedDest, dest);
    return resolvedDest;
  }
  let cursor = path.dirname(resolvedDest);
  while (cursor.startsWith(prefix) || cursor === resolvedRoot) {
    if (existsSync(cursor)) {
      assertRealUnder(resolvedRoot, cursor, dest);
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolvedDest;
}

function assertRealUnder(resolvedRoot: string, existing: string, dest: string): void {
  const realRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
  const realExisting = realpathSync(existing);
  const realPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realExisting !== realRoot && !realExisting.startsWith(realPrefix)) {
    throw new CliError(`path escapes root via symlink: ${dest}`);
  }
}

/** Workspace-relative path that is not absolute and does not contain `..`. */
export function confinedWorkspaceRel(workspace: string, rel: string): string | undefined {
  if (!rel || typeof rel !== "string") return undefined;
  if (path.isAbsolute(rel)) return undefined;
  const parts = rel.split(/[\\/]/);
  if (parts.includes("..")) return undefined;
  try {
    return assertUnder(workspace, path.resolve(workspace, rel));
  } catch {
    return undefined;
  }
}

/** Single path segment for evidence / snapshot filenames. No separators or `..`. */
export function assertSafeDestName(name: string): string {
  if (!name || name !== path.basename(name) || name.includes("..") || name === "." || name === "..") {
    throw new CliError(`unsafe evidence name: ${name}`);
  }
  return name;
}
