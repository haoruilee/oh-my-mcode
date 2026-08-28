import { existsSync } from "node:fs";
import path from "node:path";
import type { ExecRequest, ExecResult, McodeClient, StreamEvent } from "./mcode.js";
import { applyRoleDefaults, sessionXorContinue } from "./mcode.js";
import type { HostGoalFacts, RunRecord } from "./types.js";
import type { RunStore } from "./store.js";
import { execWithRepair } from "./tool-repair.js";
import { extractUsage, mergeUsage } from "./usage.js";
import {
  classifyHostEvent,
  extractStructuredExec,
  shouldRecordHostEvent,
} from "./host-events.js";

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
  return id.startsWith("omm_run_") || id.startsWith("omm_");
}

/** Live 0.2.1 host session ids look like `mvs_<hex>`. */
export const HOST_SESSION_ID_RE = /\bmvs_[A-Za-z0-9]+\b/;
export const HOST_SESSION_REMINDER_RE = /YOUR SESSION ID:\s*(mvs_[A-Za-z0-9]+)/i;

export function decodeHostCursor(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractMvsSessionId(text: string): string | undefined {
  const decoded = decodeHostCursor(text);
  const reminder = decoded.match(HOST_SESSION_REMINDER_RE);
  if (reminder?.[1] && !isSynthesizedSessionToken(reminder[1])) return reminder[1];
  const fromCursor = decoded.match(/(?:sse1:)?session(?::|%3A)(mvs_[A-Za-z0-9]+)/i);
  if (fromCursor?.[1] && !isSynthesizedSessionToken(fromCursor[1])) return fromCursor[1];
  const found = decoded.match(HOST_SESSION_ID_RE);
  if (found?.[0] && !isSynthesizedSessionToken(found[0])) return found[0];
  return undefined;
}

/**
 * Bind a host session id from structured fields only (`exec.result` / `metadata` /
 * session-like events / host `cursor`). Never from `result.text`, assistant
 * content, or `YOUR SESSION ID:` prose. Never a bare `session_id` that is not `mvs_*`.
 */
export function extractHostSessionId(result: ExecResult): string | undefined {
  return extractStructuredExec(result).sessionId;
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
    // Prefer --session <mvs_>. Host 0.2.1 rejects --session AND --continue (invocation, exit 2).
    const legal = sessionXorContinue({ session: run.host_session_id });
    next.session = legal.session;
    delete next.continue;
    return next;
  }
  // First turn (and leftover synthesized ids): no fake --session.
  // --continue is user-requested, or a reminder that has no mvs_ yet.
  const legal = sessionXorContinue({
    session: next.session && !isSynthesizedSessionToken(next.session) ? next.session : undefined,
    continue:
      Boolean(next.continue) || Boolean(run.host_continue && run.host_session_source !== "synthesized"),
  });
  if (legal.session) {
    next.session = legal.session;
    delete next.continue;
  } else if (legal.continue) {
    delete next.session;
    next.continue = true;
  } else {
    delete next.session;
    delete next.continue;
  }
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

/** Record goal/compaction/queue/steer. Do not spawn or settle our goal. */
function maybeAppendHostEvent(store: RunStore, runId: string, event: StreamEvent): void {
  if (!shouldRecordHostEvent(event)) return;
  store.appendEvent(runId, "host_event", {
    type: event.type,
    class: classifyHostEvent(event),
  });
}

function overlayHostGoal(current: HostGoalFacts | undefined, next: HostGoalFacts | undefined): HostGoalFacts | undefined {
  if (!next) return current;
  if (!current) return { ...next };
  return {
    phase: next.phase ?? current.phase,
    budget: next.budget ?? current.budget,
    settled: next.settled ?? current.settled,
  };
}

function rememberHostStructured(store: RunStore, runId: string, result: ExecResult): void {
  const structured = extractStructuredExec(result);
  if (!structured.goal) return;
  if (
    structured.goal.budget === undefined &&
    structured.goal.settled === undefined &&
    !structured.goal.phase
  ) {
    return;
  }
  const current = store.load(runId);
  const host_goal = overlayHostGoal(current.host_goal, structured.goal);
  if (host_goal) store.patchRun(runId, { host_goal });
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
    maybeAppendHostEvent(store, runId, event);
  };
  const result = await execWithRepair(client, prepared, { store, runId });
  rememberHostSession(store, runId, result, prepared, opts);
  rememberHostStructured(store, runId, result);
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
