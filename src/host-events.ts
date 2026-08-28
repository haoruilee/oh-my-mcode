/**
 * Closed catalog of mcode stream-json event kinds we may see on 0.2.4+.
 * Exact 0.2.4 type strings were not captured in-repo; aliases below are what we accept.
 * We stay on `mcode exec`. This is not an ACP client and does not start a host Goal loop.
 */
import type { ExecResult, StreamEvent } from "./mcode.js";
import type { HostGoalFacts, HostModel, UsageTotals } from "./types.js";
import { extractHostModel, extractUsage } from "./usage.js";

export const HOST_EVENT_CLASSES = ["session", "usage", "yield", "goal", "model", "tool", "noise"] as const;
export type HostEventClass = (typeof HOST_EVENT_CLASSES)[number];

/**
 * Alias table. Live 0.2.1 fixtures use `delta` / `message` / `exec.result`.
 * Changelog 0.2.4 names Goal settlement/budget, compaction, queue, Steer, tool_trim
 * without publishing the stream `type` strings — accept these closed aliases and
 * store `type` as-is.
 */
export const HOST_EVENT_ALIASES: Record<HostEventClass, readonly string[]> = {
  session: ["session", "session_id", "sessionid", "host_session"],
  usage: ["usage", "token_usage", "tokenusage"],
  yield: ["assistant", "delta", "exec.result", "exec_result", "result"],
  goal: ["goal", "goal_settled", "goal_budget", "goal.settled", "goal.budget", "host_goal"],
  model: ["model"],
  tool: ["tool", "tool_use", "tooluse", "tool_result", "tool-call", "tool_call"],
  noise: ["stderr", "compaction", "compact", "tool_trim", "tool-trim", "queue", "steer", "message"],
};

/** Record-only kinds: log `host_event`, do not spawn, steer, compact, or settle our goal. */
export const HOST_EVENT_RECORD_ONLY = [
  "compaction",
  "compact",
  "tool_trim",
  "tool-trim",
  "queue",
  "steer",
  "goal",
  "goal_settled",
  "goal_budget",
  "goal.settled",
  "goal.budget",
  "host_goal",
] as const;

export interface StructuredExec {
  sessionId?: string;
  model?: HostModel;
  goal?: HostGoalFacts;
  usage?: UsageTotals;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decodeHostCursor(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function inventedSession(id: string): boolean {
  return id.startsWith("omm_run_") || id.startsWith("omm_");
}

/**
 * Bindable host session: exact `mvs_[A-Za-z0-9]+`, or a host cursor
 * (`sse1:session%3Amvs_…`). Never a prose scrape. Never `omm_*`.
 */
export function bindableHostSessionId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || inventedSession(trimmed)) return undefined;
  if (/^mvs_[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  const decoded = decodeHostCursor(trimmed);
  const fromCursor = decoded.match(/(?:sse1:)?session(?::|%3A)(mvs_[A-Za-z0-9]+)/i);
  if (fromCursor?.[1] && !inventedSession(fromCursor[1])) return fromCursor[1];
  return undefined;
}

export function hostEventTypeOf(event: StreamEvent | { type?: string; raw?: unknown; event?: string }): string {
  const rec = asRecord(event.raw);
  const type =
    (typeof event.type === "string" && event.type) ||
    (typeof rec?.type === "string" && rec.type) ||
    (typeof rec?.event === "string" && rec.event) ||
    "";
  return type.toLowerCase();
}

function aliasesInclude(cls: HostEventClass, type: string): boolean {
  return HOST_EVENT_ALIASES[cls].includes(type);
}

export function classifyHostEvent(event: StreamEvent | { type?: string; raw?: unknown }): HostEventClass {
  const type = hostEventTypeOf(event);
  if (aliasesInclude("session", type)) return "session";
  if (aliasesInclude("usage", type)) return "usage";
  if (aliasesInclude("yield", type)) return "yield";
  if (aliasesInclude("goal", type)) return "goal";
  if (aliasesInclude("model", type)) return "model";
  if (aliasesInclude("tool", type)) return "tool";
  if (type === "message") {
    const rec = asRecord(event.raw);
    const message = asRecord(rec?.message);
    if (message?.usage || rec?.usage) return "usage";
    if (rec?.cursor || rec?.session || rec?.sessionId || rec?.session_id) return "session";
    return "noise";
  }
  return "noise";
}

export function shouldRecordHostEvent(event: StreamEvent | { type?: string; raw?: unknown }): boolean {
  const type = hostEventTypeOf(event);
  if ((HOST_EVENT_RECORD_ONLY as readonly string[]).includes(type)) return true;
  return classifyHostEvent(event) === "goal";
}

function isExecResultType(type: string): boolean {
  return type === "exec.result" || type === "exec_result" || type === "result";
}

function isSessionLikeType(type: string): boolean {
  return aliasesInclude("session", type);
}

function sessionFromStructuredRecord(rec: Record<string, unknown>, type: string): string | undefined {
  if (typeof rec.cursor === "string") {
    const fromCursor = bindableHostSessionId(rec.cursor);
    if (fromCursor) return fromCursor;
  }
  const allowKeys = isExecResultType(type) || isSessionLikeType(type);
  if (!allowKeys) return undefined;
  for (const key of ["session", "session_id", "sessionId", "host_session_id"]) {
    if (typeof rec[key] !== "string") continue;
    const found = bindableHostSessionId(rec[key]);
    if (found) return found;
  }
  if (typeof rec.id === "string") {
    const found = bindableHostSessionId(rec.id);
    if (found) return found;
  }
  return undefined;
}

function goalFromRecord(rec: Record<string, unknown>, type: string): HostGoalFacts | undefined {
  const nested = asRecord(rec.goal);
  const src = nested ?? rec;
  const goal: HostGoalFacts = {};
  if (typeof src.phase === "string" && src.phase.trim()) goal.phase = src.phase.trim();
  if (src.budget !== undefined) goal.budget = src.budget;
  if (typeof src.settled === "boolean" || typeof src.settled === "string") goal.settled = src.settled;
  if (type === "goal_settled" && goal.settled === undefined) goal.settled = true;
  return Object.keys(goal).length ? goal : undefined;
}

function overlayGoal(base: HostGoalFacts | undefined, next: HostGoalFacts | undefined): HostGoalFacts | undefined {
  if (!next) return base;
  if (!base) return { ...next };
  return {
    phase: next.phase ?? base.phase,
    budget: next.budget ?? base.budget,
    settled: next.settled ?? base.settled,
  };
}

function structuredBlobs(result: Pick<ExecResult, "events" | "rawLines">): unknown[] {
  const blobs: unknown[] = result.events.map((event) => event.raw);
  for (const line of result.rawLines || []) {
    try {
      blobs.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  return blobs;
}

function walkStructuredSession(value: unknown, depth = 0, fromMetadata = false): string | undefined {
  if (value == null || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkStructuredSession(item, depth + 1, fromMetadata);
      if (found) return found;
    }
    return undefined;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;
  const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
  const foundHere = sessionFromStructuredRecord(rec, fromMetadata ? "exec.result" : type);
  if (foundHere) return foundHere;
  if (rec.metadata !== undefined) {
    const found = walkStructuredSession(rec.metadata, depth + 1, true);
    if (found) return found;
  }
  if (rec.result !== undefined) {
    const found = walkStructuredSession(rec.result, depth + 1, true);
    if (found) return found;
  }
  if (rec.exec !== undefined) {
    const found = walkStructuredSession(rec.exec, depth + 1, true);
    if (found) return found;
  }
  return undefined;
}

function walkStructuredGoal(value: unknown, depth = 0): HostGoalFacts | undefined {
  if (value == null || depth > 8) return undefined;
  if (Array.isArray(value)) {
    let acc: HostGoalFacts | undefined;
    for (const item of value) acc = overlayGoal(acc, walkStructuredGoal(item, depth + 1));
    return acc;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;
  const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
  let acc = aliasesInclude("goal", type) || rec.goal !== undefined ? goalFromRecord(rec, type) : undefined;
  if (rec.metadata !== undefined) acc = overlayGoal(acc, walkStructuredGoal(rec.metadata, depth + 1));
  if (rec.result !== undefined) acc = overlayGoal(acc, walkStructuredGoal(rec.result, depth + 1));
  if (rec.exec !== undefined) acc = overlayGoal(acc, walkStructuredGoal(rec.exec, depth + 1));
  return acc;
}

function modelFromStructured(result: Pick<ExecResult, "events" | "rawLines">): HostModel | undefined {
  const fromExec = extractHostModel(result.events, result.rawLines);
  if (fromExec) return fromExec;
  for (const blob of structuredBlobs(result)) {
    const rec = asRecord(blob);
    if (!rec) continue;
    const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
    if (type !== "model") continue;
    const nested = asRecord(rec.model) ?? rec;
    const model: HostModel = {};
    if (typeof nested.providerId === "string") model.providerId = nested.providerId;
    if (typeof nested.modelId === "string") model.modelId = nested.modelId;
    if (typeof nested.variant === "string") model.variant = nested.variant;
    if (Object.keys(model).length) return model;
  }
  return undefined;
}

/**
 * Pull session / model / goal / usage from structured fields only
 * (`exec.result`, `metadata`, typed events). Never from assistant prose.
 */
export function extractStructuredExec(result: Pick<ExecResult, "events" | "rawLines" | "text" | "usage">): StructuredExec {
  const blobs = structuredBlobs(result);
  let sessionId: string | undefined;
  for (const event of result.events) {
    const rec = asRecord(event.raw);
    if (!rec) continue;
    const found = sessionFromStructuredRecord(rec, hostEventTypeOf(event));
    if (found) {
      sessionId = found;
      break;
    }
    if (rec.metadata !== undefined) {
      const fromMeta = walkStructuredSession(rec.metadata, 0, true);
      if (fromMeta) {
        sessionId = fromMeta;
        break;
      }
    }
  }
  if (!sessionId) {
    for (const blob of blobs) {
      const found = walkStructuredSession(blob);
      if (found) {
        sessionId = found;
        break;
      }
    }
  }
  let goal: HostGoalFacts | undefined;
  for (const event of result.events) {
    const rec = asRecord(event.raw);
    if (!rec) continue;
    const type = hostEventTypeOf(event);
    if (classifyHostEvent(event) === "goal" || rec.goal !== undefined) {
      goal = overlayGoal(goal, goalFromRecord(rec, type));
    }
    if (rec.metadata !== undefined) goal = overlayGoal(goal, walkStructuredGoal(rec.metadata));
  }
  if (!goal) {
    for (const blob of blobs) goal = overlayGoal(goal, walkStructuredGoal(blob));
  }
  const usage = result.usage || extractUsage(result.events, result.rawLines);
  const model = modelFromStructured(result) ?? usage?.model;
  const out: StructuredExec = {};
  if (sessionId) out.sessionId = sessionId;
  if (model) out.model = model;
  if (goal) out.goal = goal;
  if (usage) out.usage = usage;
  return out;
}
