import type { StreamEvent } from "./mcode.js";
import type { HostModel, UsageTotals } from "./types.js";

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function hostModel(value: unknown): HostModel | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const model: HostModel = {};
  if (typeof rec.providerId === "string") model.providerId = rec.providerId;
  if (typeof rec.modelId === "string") model.modelId = rec.modelId;
  if (typeof rec.variant === "string") model.variant = rec.variant;
  return Object.keys(model).length ? model : undefined;
}

function fromRecord(rec: Record<string, unknown>): UsageTotals | undefined {
  const input =
    asNumber(rec.input_tokens) ??
    asNumber(rec.prompt_tokens) ??
    asNumber(rec.inputTokens) ??
    asNumber(rec.promptTokens);
  const output =
    asNumber(rec.output_tokens) ??
    asNumber(rec.completion_tokens) ??
    asNumber(rec.outputTokens) ??
    asNumber(rec.completionTokens);
  const total = asNumber(rec.total_tokens) ?? asNumber(rec.totalTokens);
  const cache =
    asNumber(rec.cache_read_tokens) ??
    asNumber(rec.cacheReadTokens) ??
    asNumber(rec.cache_read) ??
    asNumber(rec.cacheRead);
  const cost =
    asNumber(rec.cost_usd) ??
    asNumber(rec.total_cost_usd) ??
    asNumber(rec.cost) ??
    asNumber(rec.total_cost);
  const requestDuration = asNumber(rec.request_duration_ms) ?? asNumber(rec.requestDurationMs);
  const duration = asNumber(rec.duration_ms) ?? asNumber(rec.durationMs);
  const thinking = asNumber(rec.thinking_duration_ms) ?? asNumber(rec.thinkingDurationMs);
  const first = asNumber(rec.first_token_ms) ?? asNumber(rec.firstTokenMs);
  if (
    input === undefined &&
    output === undefined &&
    total === undefined &&
    cache === undefined &&
    cost === undefined &&
    requestDuration === undefined &&
    duration === undefined &&
    thinking === undefined &&
    first === undefined
  ) {
    return undefined;
  }
  const usage: UsageTotals = {};
  if (input !== undefined) usage.input_tokens = input;
  if (output !== undefined) usage.output_tokens = output;
  if (total !== undefined) usage.total_tokens = total;
  else if (input !== undefined || output !== undefined) usage.total_tokens = (input || 0) + (output || 0);
  if (cache !== undefined) usage.cache_read_tokens = cache;
  if (cost !== undefined) usage.cost_usd = cost;
  if (requestDuration !== undefined) usage.request_duration_ms = requestDuration;
  if (duration !== undefined) usage.duration_ms = duration;
  if (thinking !== undefined) usage.thinking_duration_ms = thinking;
  if (first !== undefined) usage.first_token_ms = first;
  return usage;
}

function overlay(base: UsageTotals | undefined, next: UsageTotals | undefined): UsageTotals | undefined {
  if (!next) return base;
  if (!base) return { ...next };
  return {
    input_tokens: next.input_tokens ?? base.input_tokens,
    output_tokens: next.output_tokens ?? base.output_tokens,
    total_tokens: next.total_tokens ?? base.total_tokens,
    cache_read_tokens: next.cache_read_tokens ?? base.cache_read_tokens,
    cost_usd: next.cost_usd ?? base.cost_usd,
    request_duration_ms: next.request_duration_ms ?? base.request_duration_ms,
    duration_ms: next.duration_ms ?? base.duration_ms,
    thinking_duration_ms: next.thinking_duration_ms ?? base.thinking_duration_ms,
    first_token_ms: next.first_token_ms ?? base.first_token_ms,
    model: next.model ?? base.model,
  };
}

/** MiniMax mcode 0.2.1: type=message with message.usage camelCase tokens. */
function fromMessageEvent(rec: Record<string, unknown>): UsageTotals | undefined {
  const message = asRecord(rec.message) ?? rec;
  const usageRec = asRecord(message.usage);
  const usage = usageRec ? fromRecord(usageRec) : fromRecord(message);
  if (!usage) return undefined;
  const thinking = asNumber(message.thinkingDurationMs) ?? asNumber(rec.thinkingDurationMs);
  if (thinking !== undefined) usage.thinking_duration_ms = thinking;
  return usage;
}

/** MiniMax mcode 0.2.1: type=exec.result with durationMs + model. */
function fromExecResult(rec: Record<string, unknown>): UsageTotals | undefined {
  const usage: UsageTotals = {};
  const duration = asNumber(rec.durationMs) ?? asNumber(rec.duration_ms);
  if (duration !== undefined) usage.duration_ms = duration;
  const model = hostModel(rec.model);
  if (model) usage.model = model;
  return Object.keys(usage).length ? usage : undefined;
}

function walk(value: unknown, depth = 0): UsageTotals | undefined {
  if (value == null || depth > 6) return undefined;
  if (Array.isArray(value)) {
    let acc: UsageTotals | undefined;
    for (const item of value) acc = overlay(acc, walk(item, depth + 1));
    return acc;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;

  const type = typeof rec.type === "string" ? rec.type : "";
  if (type === "message" || rec.message) {
    const fromMsg = fromMessageEvent(rec);
    if (fromMsg && (fromMsg.input_tokens != null || fromMsg.output_tokens != null || fromMsg.request_duration_ms != null)) {
      return overlay(fromMsg, walk(rec.model, depth + 1));
    }
  }
  if (type === "exec.result" || type === "exec_result" || type === "result") {
    return overlay(fromExecResult(rec), rec.usage ? fromRecord(asRecord(rec.usage) || {}) : undefined);
  }

  if (rec.usage && typeof rec.usage === "object" && !Array.isArray(rec.usage)) {
    const nested = fromRecord(rec.usage as Record<string, unknown>);
    if (nested) {
      const thinking = asNumber(rec.thinkingDurationMs) ?? asNumber(asRecord(rec.message)?.thinkingDurationMs);
      if (thinking !== undefined) nested.thinking_duration_ms = thinking;
      return nested;
    }
  }
  const direct = fromRecord(rec);
  if (
    direct &&
    (rec.usage ||
      rec.input_tokens !== undefined ||
      rec.inputTokens !== undefined ||
      rec.prompt_tokens !== undefined ||
      rec.cost_usd !== undefined ||
      rec.requestDurationMs !== undefined ||
      rec.duration_ms !== undefined ||
      rec.durationMs !== undefined ||
      rec.first_token_ms !== undefined)
  ) {
    return direct;
  }
  let acc: UsageTotals | undefined;
  for (const key of ["result", "metadata", "message", "data"]) {
    if (rec[key] !== undefined) acc = overlay(acc, walk(rec[key], depth + 1));
  }
  return acc;
}

function eventTimestamp(rec: Record<string, unknown>): number | undefined {
  return (
    asNumber(rec.timestamp) ??
    asNumber(rec.ts) ??
    asNumber(asRecord(rec.message)?.timestamp) ??
    asNumber(asRecord(rec.message)?.ts)
  );
}

/**
 * First thinking/content delta minus the user-message timestamp (mcode 0.2.1).
 */
export function extractFirstTokenMs(events: StreamEvent[]): number | undefined {
  let userTs: number | undefined;
  let firstDeltaTs: number | undefined;
  for (const event of events) {
    const rec = asRecord(event.raw);
    if (!rec) continue;
    const type = typeof rec.type === "string" ? rec.type : event.type || "";
    const message = asRecord(rec.message);
    const role = typeof message?.role === "string" ? message.role : typeof rec.role === "string" ? rec.role : "";
    if ((type === "message" || type === "user") && role === "user") {
      userTs = eventTimestamp(rec) ?? userTs;
    }
    const hasDelta =
      type === "delta" && (typeof rec.thinking === "string" || typeof rec.content === "string" || rec.finish === true);
    if (hasDelta && firstDeltaTs == null) {
      firstDeltaTs = eventTimestamp(rec);
    }
  }
  if (userTs != null && firstDeltaTs != null) return Math.max(0, firstDeltaTs - userTs);
  return undefined;
}

export function extractHostModel(events: StreamEvent[], rawLines: string[] = []): HostModel | undefined {
  const blobs: unknown[] = [...events.map((event) => event.raw)];
  for (const line of rawLines) {
    try {
      blobs.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  for (const blob of blobs) {
    const rec = asRecord(blob);
    if (!rec) continue;
    if (rec.type === "exec.result" || rec.type === "exec_result") {
      const model = hostModel(rec.model);
      if (model) return model;
    }
    const nested = hostModel(asRecord(rec.model));
    if (nested) return nested;
  }
  return undefined;
}

export function extractUsage(events: StreamEvent[], rawLines: string[] = []): UsageTotals | undefined {
  const blobs: unknown[] = [...events.map((event) => event.raw)];
  for (const line of rawLines) {
    try {
      blobs.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  let merged: UsageTotals | undefined;
  for (const blob of blobs) {
    merged = overlay(merged, walk(blob));
  }
  const first = extractFirstTokenMs(events);
  if (first != null) {
    merged = overlay(merged, { first_token_ms: first });
  }
  const model = extractHostModel(events, rawLines);
  if (model) {
    merged = overlay(merged, { model });
  }
  return merged;
}

export function mergeUsage(current: UsageTotals | undefined, next: UsageTotals | undefined): UsageTotals | undefined {
  if (!current) return next;
  if (!next) return current;
  const input = (current.input_tokens || 0) + (next.input_tokens || 0);
  const output = (current.output_tokens || 0) + (next.output_tokens || 0);
  const total =
    current.total_tokens !== undefined || next.total_tokens !== undefined
      ? (current.total_tokens || 0) + (next.total_tokens || 0)
      : input + output || undefined;
  const cache =
    current.cache_read_tokens !== undefined || next.cache_read_tokens !== undefined
      ? (current.cache_read_tokens || 0) + (next.cache_read_tokens || 0)
      : undefined;
  const cost =
    current.cost_usd !== undefined || next.cost_usd !== undefined
      ? (current.cost_usd || 0) + (next.cost_usd || 0)
      : undefined;
  const merged: UsageTotals = {};
  if (input) merged.input_tokens = input;
  if (output) merged.output_tokens = output;
  if (total) merged.total_tokens = total;
  if (cache !== undefined) merged.cache_read_tokens = cache;
  if (cost !== undefined) merged.cost_usd = cost;
  if (current.request_duration_ms != null || next.request_duration_ms != null) {
    merged.request_duration_ms = (current.request_duration_ms || 0) + (next.request_duration_ms || 0);
  }
  if (current.duration_ms != null || next.duration_ms != null) {
    merged.duration_ms = (current.duration_ms || 0) + (next.duration_ms || 0);
  }
  if (current.thinking_duration_ms != null || next.thinking_duration_ms != null) {
    merged.thinking_duration_ms = (current.thinking_duration_ms || 0) + (next.thinking_duration_ms || 0);
  }
  if (current.first_token_ms != null) merged.first_token_ms = current.first_token_ms;
  else if (next.first_token_ms != null) merged.first_token_ms = next.first_token_ms;
  merged.model = next.model ?? current.model;
  return Object.keys(merged).length ? merged : undefined;
}

export function formatUsage(usage?: UsageTotals): string {
  if (!usage || (usage.input_tokens == null && usage.output_tokens == null && usage.total_tokens == null && usage.cost_usd == null)) {
    return "n/a if unknown";
  }
  const parts: string[] = [];
  if (usage.input_tokens != null || usage.output_tokens != null) {
    parts.push(`${usage.input_tokens ?? "?"} in / ${usage.output_tokens ?? "?"} out`);
  } else if (usage.total_tokens != null) {
    parts.push(`${usage.total_tokens} tokens`);
  }
  if (usage.cache_read_tokens != null) parts.push(`${usage.cache_read_tokens} cache-read`);
  if (usage.cost_usd != null) parts.push(`$${usage.cost_usd}`);
  return parts.join(" · ") || "n/a if unknown";
}
