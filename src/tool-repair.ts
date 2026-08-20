import type { ExecRequest, ExecResult, McodeClient } from "./mcode.js";
import type { RunStore } from "./store.js";

export type ToolFailureKind = "ok" | "spawn" | "parse" | "timeout" | "nonzero";

export class ToolBlockedError extends Error {
  readonly kind: ToolFailureKind;
  readonly attempts: number;
  constructor(kind: ToolFailureKind, attempts: number, message: string) {
    super(message);
    this.name = "ToolBlockedError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

export function classifyError(error: unknown): ToolFailureKind {
  const err = error as NodeJS.ErrnoException & { name?: string };
  if (!err) return "nonzero";
  if (err.code === "ENOENT" || err.code === "EACCES" || err.name === "McodeMissingError") return "spawn";
  if (err.name === "SyntaxError" || /json|parse/i.test(err.message || "")) return "parse";
  if (/timed? ?out/i.test(err.message || "")) return "timeout";
  return "nonzero";
}

export function classifyExecResult(result: ExecResult): ToolFailureKind {
  const stderr = result.events
    .filter((event) => event.type === "stderr")
    .map((event) => event.text || "")
    .join("\n");
  if (/enoent|not found|spawn/i.test(stderr)) return "spawn";
  const parsed = result.events.filter((event) => event.type && event.type !== "text" && event.type !== "stderr");
  if (result.rawLines.length > 0 && result.text.trim() === "" && parsed.length === 0) return "parse";
  if (result.exitCode === 0) return "ok";
  return "nonzero";
}

async function attempt(client: McodeClient, req: ExecRequest): Promise<{
  result?: ExecResult;
  kind: ToolFailureKind;
  error?: unknown;
}> {
  try {
    const result = await client.exec(req);
    return { result, kind: classifyExecResult(result) };
  } catch (error) {
    return { kind: classifyError(error), error };
  }
}

/**
 * One retry on spawn/parse failures, then block. No infinite retry.
 * Records repair_requested / tool failure events when a store is provided.
 */
export async function execWithRepair(
  client: McodeClient,
  req: ExecRequest,
  rec?: { store: RunStore; runId: string },
): Promise<ExecResult> {
  const first = await attempt(client, req);
  if (first.kind === "ok" && first.result) return first.result;

  const retryable = first.kind === "spawn" || first.kind === "parse";
  if (retryable) {
    rec?.store.appendEvent(rec.runId, "repair_requested", {
      tool: true,
      kind: first.kind,
      attempt: 1,
    });
    const second = await attempt(client, req);
    if (second.kind === "ok" && second.result) return second.result;
    rec?.store.appendEvent(rec.runId, "repair_requested", {
      tool: true,
      kind: second.kind,
      attempt: 2,
      blocked: true,
    });
    if (second.error) {
      throw new ToolBlockedError(second.kind, 2, `mcode exec blocked after retry (${second.kind}): ${(second.error as Error).message}`);
    }
    if (second.result) return second.result;
  }

  if (first.kind !== "ok") {
    rec?.store.appendEvent(rec.runId, "repair_requested", {
      tool: true,
      kind: first.kind,
      attempt: 1,
      blocked: !retryable,
    });
  }
  if (first.error) {
    throw first.kind === "spawn" || first.kind === "parse"
      ? new ToolBlockedError(first.kind, 1, `mcode exec failed (${first.kind}): ${(first.error as Error).message}`)
      : first.error;
  }
  if (first.result) return first.result;
  throw new ToolBlockedError(first.kind, 1, `mcode exec failed (${first.kind})`);
}
