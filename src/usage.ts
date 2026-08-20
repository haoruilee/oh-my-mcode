import type { StreamEvent } from "./mcode.js";
import type { UsageTotals } from "./types.js";

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
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
  const cost =
    asNumber(rec.cost_usd) ??
    asNumber(rec.total_cost_usd) ??
    asNumber(rec.cost) ??
    asNumber(rec.total_cost);
  if (input === undefined && output === undefined && total === undefined && cost === undefined) return undefined;
  const usage: UsageTotals = {};
  if (input !== undefined) usage.input_tokens = input;
  if (output !== undefined) usage.output_tokens = output;
  if (total !== undefined) usage.total_tokens = total;
  else if (input !== undefined || output !== undefined) usage.total_tokens = (input || 0) + (output || 0);
  if (cost !== undefined) usage.cost_usd = cost;
  return usage;
}

function walk(value: unknown, depth = 0): UsageTotals | undefined {
  if (value == null || depth > 6) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (rec.usage && typeof rec.usage === "object" && !Array.isArray(rec.usage)) {
    const nested = fromRecord(rec.usage as Record<string, unknown>);
    if (nested) return nested;
  }
  const direct = fromRecord(rec);
  if (direct && (rec.usage || rec.input_tokens !== undefined || rec.prompt_tokens !== undefined || rec.cost_usd !== undefined)) {
    return direct;
  }
  for (const key of ["result", "metadata", "message", "data"]) {
    if (rec[key] !== undefined) {
      const found = walk(rec[key], depth + 1);
      if (found) return found;
    }
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
    const found = walk(blob);
    if (!found) continue;
    merged = {
      input_tokens: found.input_tokens ?? merged?.input_tokens,
      output_tokens: found.output_tokens ?? merged?.output_tokens,
      total_tokens: found.total_tokens ?? merged?.total_tokens,
      cost_usd: found.cost_usd ?? merged?.cost_usd,
    };
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
  const cost =
    current.cost_usd !== undefined || next.cost_usd !== undefined
      ? (current.cost_usd || 0) + (next.cost_usd || 0)
      : undefined;
  const merged: UsageTotals = {};
  if (input) merged.input_tokens = input;
  if (output) merged.output_tokens = output;
  if (total) merged.total_tokens = total;
  if (cost !== undefined) merged.cost_usd = cost;
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
  if (usage.cost_usd != null) parts.push(`$${usage.cost_usd}`);
  return parts.join(" · ") || "n/a if unknown";
}
