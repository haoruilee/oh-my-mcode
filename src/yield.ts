import { existsSync } from "node:fs";
import path from "node:path";
import { packageRoot, parseJsonObject } from "./util.js";
import type { FindingSeverity, UsageTotals } from "./types.js";
import { classifyHostExit, type ExecResult, type HostExitKind } from "./mcode.js";
import type { RunStore } from "./store.js";

export const YIELD_STATUSES = ["ok", "blocked", "failed"] as const;
export type YieldStatus = (typeof YIELD_STATUSES)[number];

export interface WorkerFinding {
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: string[];
}

export interface WorkerYield {
  status: YieldStatus;
  summary: string;
  findings: WorkerFinding[];
  artifacts: string[];
  file_hashes?: Record<string, string>;
}

export const SCHEMA_MODE = "strict" as const;

export function workerYieldSchemaPath(): string {
  return path.join(packageRoot(), "schemas", "worker-yield.schema.json");
}

export function yieldSchemaAvailable(): boolean {
  return existsSync(workerYieldSchemaPath());
}

export function emptyFailedYield(summary: string, detail: string): WorkerYield {
  return {
    status: "failed",
    summary,
    findings: [{ severity: "blocker", title: summary, detail, evidence: [] }],
    artifacts: [],
  };
}

export function okYield(summary: string, artifacts: string[] = []): WorkerYield {
  return { status: "ok", summary, findings: [], artifacts };
}

export function looksLikeYield(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return "status" in rec && "summary" in rec && "findings" in rec && "artifacts" in rec;
}

export function looksLikePlannerGraph(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.tasks) && Array.isArray(rec.acceptance);
}

function asFinding(value: unknown): WorkerFinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const severity = rec.severity;
  if (severity !== "blocker" && severity !== "major" && severity !== "minor" && severity !== "note") return undefined;
  if (typeof rec.title !== "string" || !rec.title.trim()) return undefined;
  if (typeof rec.detail !== "string") return undefined;
  const evidence = Array.isArray(rec.evidence) ? rec.evidence.map((item) => String(item)) : undefined;
  if (!evidence) return undefined;
  return { severity, title: rec.title, detail: rec.detail, evidence };
}

export function validateWorkerYield(value: unknown): { ok: true; data: WorkerYield } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "yield must be a JSON object" };
  }
  const rec = value as Record<string, unknown>;
  const extra = Object.keys(rec).filter((key) => !["status", "summary", "findings", "artifacts", "file_hashes"].includes(key));
  if (extra.length) return { ok: false, error: `unexpected yield keys: ${extra.join(", ")}` };
  if (!YIELD_STATUSES.includes(rec.status as YieldStatus)) {
    return { ok: false, error: 'status must be "ok" | "blocked" | "failed"' };
  }
  if (typeof rec.summary !== "string" || !rec.summary.trim()) {
    return { ok: false, error: "summary must be a non-empty string" };
  }
  if (!Array.isArray(rec.findings)) return { ok: false, error: "findings must be an array" };
  const findings: WorkerFinding[] = [];
  for (const [i, item] of rec.findings.entries()) {
    const finding = asFinding(item);
    if (!finding) return { ok: false, error: `findings[${i}] invalid (need severity,title,detail,evidence[])` };
    findings.push(finding);
  }
  if (!Array.isArray(rec.artifacts) || rec.artifacts.some((item) => typeof item !== "string")) {
    return { ok: false, error: "artifacts must be string[]" };
  }
  let fileHashes: Record<string, string> | undefined;
  if (rec.file_hashes !== undefined) {
    if (!rec.file_hashes || typeof rec.file_hashes !== "object" || Array.isArray(rec.file_hashes)) {
      return { ok: false, error: "file_hashes must be an object of string→sha256" };
    }
    fileHashes = {};
    for (const [key, val] of Object.entries(rec.file_hashes as Record<string, unknown>)) {
      if (typeof val !== "string") return { ok: false, error: `file_hashes.${key} must be a string` };
      fileHashes[key] = val;
    }
  }
  return {
    ok: true,
    data: {
      status: rec.status as YieldStatus,
      summary: rec.summary,
      findings,
      artifacts: rec.artifacts as string[],
      file_hashes: fileHashes,
    },
  };
}

function parseObjectAt(text: string, start: number): unknown {
  if (text[start] !== "{") return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function extractJsonCandidate(text: string): unknown {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (looksLikeYield(parsed) && !looksLikePlannerGraph(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  const rec = parseJsonObject(text, {});
  if (looksLikeYield(rec) && !looksLikePlannerGraph(rec)) return rec;
  const candidates: unknown[] = [];
  if (Object.keys(rec).length > 0) candidates.push(rec);
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const parsed = parseObjectAt(text, i);
    if (parsed !== undefined) candidates.push(parsed);
  }
  const yields = candidates.filter((item) => looksLikeYield(item) && !looksLikePlannerGraph(item));
  return yields.at(-1) ?? candidates[0];
}

/** Parse host `exec.result.answer` (object or JSON string) or assistant text. */
export function coerceJsonValue(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return extractJsonCandidate(trimmed);
  }
}

function eventRecord(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

function execResultAnswer(rec: Record<string, unknown>): unknown {
  const type = typeof rec.type === "string" ? rec.type : "";
  if (type === "exec.result" || type === "exec_result" || rec.answer !== undefined) {
    return coerceJsonValue(rec.answer);
  }
  return undefined;
}

/**
 * Parent reads `exec.result.answer`, assistant JSON, or `structuredOutput.data`.
 * Never dump raw host JSONL into the next prompt. Planner task graphs are not yields.
 */
export function extractStructuredYield(result: ExecResult): unknown {
  const candidates: unknown[] = [];
  if (result.structuredOutput && typeof result.structuredOutput === "object" && "data" in result.structuredOutput) {
    candidates.push(result.structuredOutput.data);
  }
  for (const event of result.events || []) {
    const rec = eventRecord(event.raw);
    if (!rec) continue;
    if (rec.structuredOutput && typeof rec.structuredOutput === "object") {
      const so = rec.structuredOutput as Record<string, unknown>;
      if ("data" in so) candidates.push(so.data);
    }
    const answer = execResultAnswer(rec);
    if (answer !== undefined) candidates.push(answer);
    if (rec.type === "result" && rec.data !== undefined) candidates.push(rec.data);
  }
  const fromText = extractJsonCandidate(result.text || "");
  if (fromText !== undefined) candidates.push(fromText);
  return candidates.find((item) => looksLikeYield(item) && !looksLikePlannerGraph(item));
}

export function extractExecResultAnswer(result: ExecResult): unknown {
  for (const event of result.events || []) {
    const rec = eventRecord(event.raw);
    if (!rec) continue;
    const answer = execResultAnswer(rec);
    if (answer !== undefined) return answer;
    if (rec.result && typeof rec.result === "object") {
      const nested = execResultAnswer(rec.result as Record<string, unknown>);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

export interface ExecSnapshot {
  assistant_text: string;
  exec_result_answer?: unknown;
  file_hashes?: Record<string, string>;
  exit_code: number;
  host_exit?: HostExitKind | "unknown";
  stderr?: string;
  usage?: UsageTotals;
  yield_status?: YieldStatus | null;
}

export interface ExecWithReminder extends ExecResult {
  firstExec?: ExecResult;
  reminderExec?: ExecResult;
}

export function collectStderr(result: ExecResult): string {
  if (result.stderr?.trim()) return result.stderr.trim();
  return (result.events || [])
    .filter((event) => event.type === "stderr")
    .map((event) => (event.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function reminderHasAssistantText(result: ExecResult): boolean {
  return Boolean((result.text || "").trim());
}

/** Typed evidence. Not raw host JSONL. Exit 2 (invocation) keeps stderr so the next live fail is readable. */
export function buildExecSnapshot(
  result: ExecResult,
  extra: { hashes?: Record<string, string>; yieldStatus?: YieldStatus | null } = {},
): ExecSnapshot {
  const answer = extractExecResultAnswer(result);
  const stderr = collectStderr(result);
  const snapshot: ExecSnapshot = {
    assistant_text: (result.text || "").trim(),
    exit_code: result.exitCode,
    host_exit: classifyHostExit(result.exitCode),
    yield_status: extra.yieldStatus ?? null,
  };
  if (answer !== undefined) snapshot.exec_result_answer = answer;
  if (extra.hashes && Object.keys(extra.hashes).length > 0) snapshot.file_hashes = extra.hashes;
  if (result.usage) snapshot.usage = result.usage;
  if (stderr) snapshot.stderr = stderr;
  return snapshot;
}

export function writeExecPhaseSnapshots(
  store: RunStore,
  runId: string,
  phase: string,
  result: ExecWithReminder,
  extra: { hashes?: Record<string, string>; yieldStatus?: YieldStatus | null } = {},
): void {
  const first = result.firstExec ?? result;
  const reminder = result.reminderExec;
  const firstSnap = buildExecSnapshot(first, {
    hashes: extra.hashes,
    yieldStatus: reminder ? null : extra.yieldStatus,
  });
  store.writeArtifact(runId, `exec-snapshot-${phase}.json`, `${JSON.stringify(firstSnap, null, 2)}\n`);
  store.writeTextEvidence(runId, "log", `exec-snapshot-${phase}.json`, JSON.stringify(firstSnap), {
    command: `mcode exec (${phase})`,
    notes: "typed exec snapshot (assistant text / exec.result.answer / stderr); not raw JSONL",
    exit_code: first.exitCode,
  });
  if (!reminder) return;
  const remSnap = buildExecSnapshot(reminder, { hashes: extra.hashes, yieldStatus: extra.yieldStatus });
  store.writeArtifact(runId, `exec-snapshot-${phase}-reminder.json`, `${JSON.stringify(remSnap, null, 2)}\n`);
  store.writeTextEvidence(runId, "log", `exec-snapshot-${phase}-reminder.json`, JSON.stringify(remSnap), {
    command: `mcode exec (${phase} reminder)`,
    notes: reminderHasAssistantText(reminder)
      ? "typed reminder snapshot"
      : "empty reminder; first snapshot kept (assistant_text not overwritten)",
    exit_code: reminder.exitCode,
  });
}

export function extractStructuredOutput(events: { raw?: unknown }[]): { data?: unknown } | undefined {
  for (const event of events) {
    const rec = eventRecord(event.raw);
    if (!rec) continue;
    if (rec.structuredOutput && typeof rec.structuredOutput === "object") {
      return rec.structuredOutput as { data?: unknown };
    }
    const answer = execResultAnswer(rec);
    if (answer !== undefined) return { data: answer };
    if (rec.type === "result" && rec.data !== undefined) return { data: rec.data };
    if (rec.result && typeof rec.result === "object") {
      const inner = rec.result as Record<string, unknown>;
      if (inner.structuredOutput && typeof inner.structuredOutput === "object") {
        return inner.structuredOutput as { data?: unknown };
      }
      if (inner.data !== undefined) return { data: inner.data };
      const nestedAnswer = execResultAnswer(inner);
      if (nestedAnswer !== undefined) return { data: nestedAnswer };
    }
  }
  return undefined;
}

export function parseWorkerYield(result: ExecResult): { ok: true; data: WorkerYield } | { ok: false; error: string } {
  const candidate = extractStructuredYield(result);
  if (candidate === undefined) {
    return {
      ok: false,
      error: "worker did not write a schema-valid yield (schemaMode=strict; expected exec.result.answer, assistant JSON, or structuredOutput.data)",
    };
  }
  return validateWorkerYield(candidate);
}

export function yieldReminder(error: string): string {
  return `Yield failed schemaMode=strict: ${error}. Same session continuation. Do not use tools. Do not hash files. Reply with only the yield JSON object {"status":"ok"|"blocked"|"failed","summary":"...","findings":[{"severity":"...","title":"...","detail":"...","evidence":[]}],"artifacts":[]} — no prose, no toolUse. Last message is only that JSON. Do not spawn. Do not dump files or raw JSONL.`;
}

export function yieldContractLine(): string {
  return 'Yield JSON (required, schemaMode=strict): {"status":"ok"|"blocked"|"failed","summary":"...","findings":[{"severity":"note","title":"...","detail":"...","evidence":[]}],"artifacts":[],"file_hashes":{}}';
}
