import { existsSync } from "node:fs";
import path from "node:path";
import type { ExecRequest, ExecResult, McodeClient, StreamEvent } from "./mcode.js";
import { applyRoleDefaults } from "./mcode.js";
import type { RunRecord } from "./types.js";
import type { RunStore } from "./store.js";
import { execWithRepair } from "./tool-repair.js";
import { extractUsage, mergeUsage } from "./usage.js";

export interface SessionOpts {
  noSession?: boolean;
  /** Parallel team worktrees use a different cwd; do not inherit the run session. */
  isolated?: boolean;
  session?: string;
  continue?: boolean;
}

export function synthesizeSessionToken(runId: string): string {
  return `omm_${runId}`;
}

/** Tokens we used to invent before the host returned a session id. Do not send these. */
export function isSynthesizedSessionToken(id: string): boolean {
  return id.startsWith("omm_run_");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Pull a host session id from stream-json. Prefer session / session_id / sessionId;
 * accept `id` only on exec.result / metadata (not random event ids).
 */
export function extractHostSessionId(result: ExecResult): string | undefined {
  const blobs: unknown[] = [
    ...result.events.map((event) => event.raw),
    ...result.rawLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    }),
  ];
  for (const blob of blobs) {
    const found = findSessionId(blob);
    if (found) return found;
  }
  return undefined;
}

function findSessionId(value: unknown, depth = 0, allowBareId = false): string | undefined {
  if (value == null || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSessionId(item, depth + 1, allowBareId);
      if (found) return found;
    }
    return undefined;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;

  for (const key of ["session", "session_id", "sessionId", "host_session_id"]) {
    const found = stringId(rec[key]);
    if (found) return found;
  }
  if (allowBareId) {
    const found = stringId(rec.id);
    if (found && !found.startsWith("evt_")) return found;
  }

  if (rec.metadata !== undefined) {
    const found = findSessionId(rec.metadata, depth + 1, true);
    if (found) return found;
  }
  if (rec.result !== undefined) {
    const found = findSessionId(rec.result, depth + 1, true);
    if (found) return found;
  }
  if (rec.exec !== undefined) {
    const found = findSessionId(rec.exec, depth + 1, true);
    if (found) return found;
  }

  for (const [key, child] of Object.entries(rec)) {
    if (key === "metadata" || key === "result" || key === "exec") continue;
    const found = findSessionId(child, depth + 1, false);
    if (found) return found;
  }
  return undefined;
}

export function applyRequestedSession(store: RunStore, runId: string, opts: SessionOpts): void {
  if (opts.noSession) return;
  if (opts.session) {
    const current = store.load(runId);
    if (current.host_session_id === opts.session) return;
    store.patchRun(runId, {
      host_session_id: opts.session,
      host_session_source: "user",
    });
    store.appendEvent(runId, "host_session_bound", {
      host_session_id: opts.session,
      source: "user",
      sent: { session: opts.session, continue: Boolean(opts.continue) },
    });
    return;
  }
  if (opts.continue) {
    const current = store.load(runId);
    if (!current.host_continue) store.patchRun(runId, { host_continue: true });
  }
}

export function applyHostSession(store: RunStore, runId: string, req: ExecRequest, opts: SessionOpts): ExecRequest {
  const next: ExecRequest = { ...req };
  if (opts.noSession) {
    delete next.session;
    delete next.continue;
    return next;
  }
  if (opts.isolated) {
    // Own cwd (git worktree): host sessions are latest-in-cwd; do not reuse the parent run session.
    delete next.session;
    delete next.continue;
    return next;
  }
  const run = store.load(runId);
  const reusable =
    Boolean(run.host_session_id) &&
    run.host_session_source !== "synthesized" &&
    !isSynthesizedSessionToken(run.host_session_id || "");
  if (reusable && run.host_session_id) {
    next.session = run.host_session_id;
    if (run.host_continue) next.continue = true;
    return next;
  }
  // First turn (and leftover synthesized ids): no fake --session / --continue.
  // User-requested --continue is host_continue without source=synthesized.
  if (run.host_continue && run.host_session_source !== "synthesized") next.continue = true;
  return next;
}

export function rememberHostSession(
  store: RunStore,
  runId: string,
  result: ExecResult,
  sent: ExecRequest,
  opts: SessionOpts,
): void {
  if (opts.noSession || opts.isolated) return;
  const run = store.load(runId);
  if (run.host_session_id && run.host_session_source !== "synthesized") return;
  const extracted = extractHostSessionId(result);
  if (!extracted) return;
  store.patchRun(runId, {
    host_session_id: extracted,
    host_continue: Boolean(sent.continue) || Boolean(run.host_continue),
    host_session_source: "host",
  });
  store.appendEvent(runId, "host_session_bound", {
    host_session_id: extracted,
    source: "host",
    sent: {
      session: sent.session,
      continue: Boolean(sent.continue),
    },
  });
}

export function judgeEvidenceFiles(store: RunStore, runId: string): string[] {
  const files: string[] = [];
  const dir = store.dir(runId);
  const summary = path.join(dir, "summary.md");
  if (existsSync(summary)) files.push(summary);
  const evidence = store.loadEvidence(runId);
  const latest = [...evidence.items]
    .reverse()
    .find((item) => item.kind === "test" || item.kind === "command" || item.path.endsWith(".log") || item.path.endsWith(".md"));
  if (latest) {
    const full = path.join(dir, latest.path);
    if (existsSync(full) && !files.includes(full)) files.push(full);
  }
  return files;
}

function maybeAppendToolCalled(store: RunStore, runId: string, event: StreamEvent): void {
  const type = (event.type || "").toLowerCase();
  if (!event.tool && !type.includes("tool")) return;
  store.appendEvent(runId, "tool_called", {
    tool: event.tool,
    type: event.type,
    live: true,
  });
}

export async function execTracked(
  client: McodeClient,
  store: RunStore,
  runId: string,
  req: ExecRequest,
  opts: SessionOpts = {},
): Promise<ExecResult> {
  const prepared = applyHostSession(store, runId, applyRoleDefaults(req), opts);
  const userOnEvent = prepared.onEvent;
  prepared.onEvent = (event) => {
    userOnEvent?.(event);
    maybeAppendToolCalled(store, runId, event);
  };
  const result = await execWithRepair(client, prepared, { store, runId });
  rememberHostSession(store, runId, result, prepared, opts);
  const usage = result.usage || extractUsage(result.events, result.rawLines);
  if (usage) {
    result.usage = usage;
    const current = store.load(runId);
    store.patchRun(runId, { usage: mergeUsage(current.usage, usage) });
  }
  return result;
}

export function formatHostSessionHints(run: RunRecord): string[] {
  if (!run.host_session_id) return [];
  if (run.host_session_source === "synthesized" || isSynthesizedSessionToken(run.host_session_id)) return [];
  return [`mcode --session ${run.host_session_id}`, `mcode --continue`];
}

export function emitHostSessionHints(run: RunRecord, write: (line: string) => void): void {
  for (const line of formatHostSessionHints(run)) write(line);
}
