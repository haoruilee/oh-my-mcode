import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { McodeMissingError, packageRoot, parseJsonObject, which } from "./util.js";
import type { Permission, Role, UsageTotals } from "./types.js";
import { extractUsage } from "./usage.js";
import { extractStructuredOutput } from "./yield.js";

export interface ExecRequest {
  cwd: string;
  prompt: string;
  role: Role;
  permission: Permission;
  timeoutMs?: number;
  session?: string;
  continue?: boolean;
  outputSchema?: string;
  files?: string[];
  maxSteps?: number;
  onEvent?: (event: StreamEvent) => void;
}

export interface StreamEvent {
  raw: unknown;
  type?: string;
  text?: string;
  tool?: string;
  role?: string;
}

export interface ExecResult {
  text: string;
  events: StreamEvent[];
  exitCode: number;
  /**
   * Our timer fired and/or `classifyHostExit(exitCode)==="timeout"`.
   * Independent of exitCode — a child can theoretically exit 0 after trapping
   * SIGTERM. Callers that need a clean finish check `exitCode===0 && !timedOut`.
   */
  timedOut?: boolean;
  /** Node `close` signal, e.g. SIGTERM / SIGABRT. */
  signal?: string;
  rawLines: string[];
  usage?: UsageTotals;
  structuredOutput?: { data?: unknown };
  wall_ms?: number;
  first_token_ms?: number;
  /** Host stderr. Live 0.2.1 invocation (exit 2) writes the reason here and nowhere else. */
  stderr?: string;
}

export interface McodeClient {
  exec(req: ExecRequest): Promise<ExecResult>;
}

export function resolveMcodeInvocation(): { command: string; prefixArgs: string[] } {
  const override = process.env.OMM_MCODE;
  if (override) {
    if (override.endsWith(".mjs") || override.endsWith(".js") || override.endsWith(".ts")) {
      return { command: process.execPath, prefixArgs: [override] };
    }
    return { command: override, prefixArgs: [] };
  }
  const found = which("mcode");
  if (!found) throw new McodeMissingError();
  return { command: found, prefixArgs: [] };
}

export function mcodeExists(): boolean {
  if (process.env.OMM_MCODE && existsSync(process.env.OMM_MCODE)) return true;
  return Boolean(which("mcode"));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  const rec = asRecord(value);
  if (rec) {
    for (const key of ["text", "content", "answer", "result", "message", "output"]) {
      if (key in rec) {
        const inner = asText(rec[key]);
        if (inner) return inner;
      }
    }
  }
  return "";
}

function eventRole(rec: Record<string, unknown> | undefined, fallback?: string): string | undefined {
  if (typeof rec?.role === "string" && rec.role.trim()) return rec.role.trim();
  const message = asRecord(rec?.message);
  if (typeof message?.role === "string" && message.role.trim()) return message.role.trim();
  return fallback;
}

function assistantContent(rec: Record<string, unknown> | undefined): string {
  if (!rec) return "";
  if (typeof rec.content === "string") return rec.content;
  const message = asRecord(rec.message);
  if (typeof message?.content === "string") return message.content;
  if (typeof rec.text === "string") return rec.text;
  return "";
}

/** Live mcode 0.2.1 `--output-schema` is an internal error (exit 70). Opt in only. */
export function hostOutputSchemaEnabled(): boolean {
  return process.env.OMM_HOST_OUTPUT_SCHEMA === "1";
}

export function parseStreamLine(line: string): StreamEvent {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type : typeof raw.event === "string" ? raw.event : undefined;
    const tool =
      typeof raw.tool === "string"
        ? raw.tool
        : typeof raw.name === "string"
          ? raw.name
          : typeof raw.toolName === "string"
            ? raw.toolName
            : undefined;
    return { raw, type, text: asText(raw), tool, role: eventRole(raw) };
  } catch {
    return { raw: line, type: "text", text: line };
  }
}

/** Documented mcode 0.2.1 cli exit codes. Exit 1 is crash / incomplete stream, not timeout. */
export const HOST_EXIT = {
  success: 0,
  crash: 1,
  invocation: 2,
  config: 3,
  runtime: 4,
  blocked: 5,
  timeout: 6,
  limit: 7,
  internal: 70,
  cancelled: 130,
} as const;

export type HostExitKind = keyof typeof HOST_EXIT;

export function classifyHostExit(code: number): HostExitKind | "unknown" {
  if (code === HOST_EXIT.success) return "success";
  if (code === HOST_EXIT.crash) return "crash";
  if (code === HOST_EXIT.invocation) return "invocation";
  if (code === HOST_EXIT.config) return "config";
  if (code === HOST_EXIT.runtime) return "runtime";
  if (code === HOST_EXIT.blocked) return "blocked";
  if (code === HOST_EXIT.timeout) return "timeout";
  if (code === HOST_EXIT.limit) return "limit";
  if (code === HOST_EXIT.internal) return "internal";
  if (code === HOST_EXIT.cancelled) return "cancelled";
  return "unknown";
}

/**
 * Node `close` is `(code, signal)`. After our SIGTERM, `code` is often `null`
 * and `signal` is `SIGTERM` — that is a timeout, not crash exit 1.
 * Host-side timeout is still exit 6 even when our timer never fired.
 */
export function finalizeHostExit(input: {
  code: number | null;
  signal?: NodeJS.Signals | string | null;
  killedByTimer: boolean;
}): Pick<ExecResult, "exitCode" | "timedOut" | "signal"> {
  const exitCode =
    typeof input.code === "number" ? input.code : input.killedByTimer ? HOST_EXIT.timeout : HOST_EXIT.crash;
  const timedOut = input.killedByTimer || classifyHostExit(exitCode) === "timeout";
  const signal = input.signal ? String(input.signal) : undefined;
  return { exitCode, timedOut, ...(signal ? { signal } : {}) };
}

/**
 * Live mcode 0.2.1 / Node 24.19.0: better-sqlite3 GC abort (`Statement::~Statement`,
 * `RemoveEnvironmentCleanupHook` assert `(env) != nullptr`, SIGABRT).
 * Exit 1 alone is crash / incomplete. Native-crash retry requires these signatures.
 */
export const HOST_NATIVE_CRASH_RE =
  /better-sqlite3|RemoveEnvironmentCleanupHook|Statement::~Statement|SIGABRT|\(env\)\s*!=\s*nullptr/i;

export function hostStderrText(result: Pick<ExecResult, "stderr" | "events">): string {
  if (result.stderr?.trim()) return result.stderr.trim();
  return (result.events || [])
    .filter((event) => event.type === "stderr")
    .map((event) => (event.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function isHostNativeCrash(
  result: Pick<ExecResult, "exitCode" | "stderr" | "events" | "timedOut" | "signal">,
): boolean {
  if (result.timedOut && result.signal === "SIGTERM") return false;
  return classifyHostExit(result.exitCode) === "crash" && HOST_NATIVE_CRASH_RE.test(hostStderrText(result));
}

export const ROLE_EXEC_DEFAULTS: Record<
  Role,
  { permission?: Permission; timeoutMs: number; maxSteps: number }
> = {
  explorer: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 20 }, // tiny repo + one JSON step; do not drop
  planner: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 16 },
  builder: { timeoutMs: 15 * 60 * 1000, maxSteps: 48 },
  verifier: { permission: "ask", timeoutMs: 5 * 60 * 1000, maxSteps: 20 },
  release: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 12 },
};

export function plannerOutputSchemaPath(): string {
  return path.join(packageRoot(), "schemas", "planner-output.schema.json");
}

/**
 * mcode 0.2.1 `--output-schema <json>` wants a JSON object string, not a path.
 * Kept for `OMM_HOST_OUTPUT_SCHEMA=1` experiments. Missing / invalid → omit the flag.
 * Default exec does not send this flag: live 0.2.1 returns exit 70 (internal) on the schema path.
 */
export function readOutputSchemaArg(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const fromText = (text: string): string | undefined => {
    const rec = parseJsonObject(text, {});
    return Object.keys(rec).length > 0 ? JSON.stringify(rec) : undefined;
  };
  if (trimmed.startsWith("{")) return fromText(trimmed);
  if (!existsSync(value)) return undefined;
  try {
    return fromText(readFileSync(value, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Host `--timeout` parser (`chm` in mcode 0.2.1 `@minimax-ai/code` cli.js):
 * `/^(\d+)(ms|s|m|h)?$/i` — missing unit → multiplier 1 → milliseconds.
 * A bare integer like `180` is 180ms, not 180s. That is why live `plan` bound
 * a real host session (`mvs_…`) then discover failed with exit 6 (`Sw.timeout`).
 * Role defaults stay milliseconds internally; argv must carry a unit suffix.
 */
export const HOST_TIMEOUT_PARSE_RE = /^(\d+)(ms|s|m|h)?$/i;
export const HOST_TIMEOUT_ARG_RE = /^\d+(ms|s|m|h)$/i;
export const HOST_PERMISSIONS = ["ask", "smart", "full", "off"] as const;

/**
 * Live mcode 0.2.1 `@minimax-ai/code` cli.js:
 * `if (e.session && e.continue) throw o_("--session and --continue are mutually exclusive.")`
 * `function o_(t, e) { return new vp("invocation", t, e) }` → `Sw.invocation = 2`.
 * `--permission off` is in the host enum (`ask|smart|full|off`); it is not the exit-2 cause.
 */
export const HOST_SESSION_CONTINUE_EXCLUSIVE =
  "--session and --continue are mutually exclusive.";

export function sessionXorContinue(
  req: Pick<ExecRequest, "session" | "continue">,
): Pick<ExecRequest, "session" | "continue"> {
  const session = typeof req.session === "string" && req.session.trim() ? req.session.trim() : undefined;
  if (session) return { session };
  if (req.continue) return { continue: true };
  return {};
}

export function execArgvHasSession(argv: string[]): boolean {
  return argv.includes("--session");
}

export function execArgvHasContinue(argv: string[]): boolean {
  return argv.includes("--continue");
}

/** Legal 0.2.1 session selection: `--session` XOR `--continue`, not both. */
export function isLegalHostSessionArgv(argv: string[]): boolean {
  return !(execArgvHasSession(argv) && execArgvHasContinue(argv));
}

export function formatHostTimeout(timeoutMs: number): string {
  return `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
}

export function buildExecArgs(req: ExecRequest, prefixArgs: string[] = []): string[] {
  const args = [
    ...prefixArgs,
    "exec",
    "--cwd",
    req.cwd,
    "--output-format",
    "stream-json",
    "--permission",
    req.permission,
  ];
  const sessionFlags = sessionXorContinue(req);
  if (sessionFlags.session) args.push("--session", sessionFlags.session);
  else if (sessionFlags.continue) args.push("--continue");
  const schema = hostOutputSchemaEnabled() ? readOutputSchemaArg(req.outputSchema) : undefined;
  if (schema) args.push("--output-schema", schema);
  for (const file of req.files || []) args.push("--file", file);
  if (req.maxSteps && req.maxSteps > 0) args.push("--max-steps", String(req.maxSteps));
  if (req.timeoutMs && req.timeoutMs > 0) args.push("--timeout", formatHostTimeout(req.timeoutMs));
  args.push(req.prompt);
  return args;
}

export function applyRoleDefaults(req: ExecRequest): ExecRequest {
  const defaults = ROLE_EXEC_DEFAULTS[req.role];
  return {
    ...req,
    permission: req.permission || defaults.permission || "ask",
    timeoutMs: req.timeoutMs ?? defaults.timeoutMs,
    maxSteps: req.maxSteps ?? defaults.maxSteps,
    outputSchema:
      req.outputSchema ??
      (hostOutputSchemaEnabled() && req.role === "planner" && existsSync(plannerOutputSchemaPath())
        ? plannerOutputSchemaPath()
        : req.outputSchema),
  };
}

/**
 * Stitch mcode 0.2.1 assistant `delta.content` (no inserted newlines) and the
 * final `message.content` when role=assistant. Ignore user-role messages so
 * the prompt's example yield JSON cannot win a greedy `{...}` match.
 */
export function collectAssistantText(events: StreamEvent[]): string {
  const deltas: string[] = [];
  let assistantMessage = "";
  const legacy: string[] = [];
  for (const event of events) {
    const rec = asRecord(event.raw);
    const type = (event.type || (typeof rec?.type === "string" ? rec.type : "") || "").toLowerCase();
    const role = eventRole(rec, event.role);
    if (role === "user" || type === "user") continue;
    if (type.includes("tool") || type.includes("error") || type === "stderr") continue;
    if (type === "delta") {
      if (role && role !== "assistant") continue;
      const content = typeof rec?.content === "string" ? rec.content : "";
      if (content) deltas.push(content);
      continue;
    }
    if (type === "message") {
      if (role === "assistant") {
        const content = assistantContent(rec);
        if (content) assistantMessage = content;
      }
      continue;
    }
    if (type === "exec.result" || type === "exec_result") continue;
    const text = typeof rec?.text === "string" ? rec.text : event.text || "";
    if (text) legacy.push(text);
  }
  if (assistantMessage.trim()) return assistantMessage.trim();
  if (deltas.length > 0) return deltas.join("").trim();
  return legacy.join("\n").trim();
}

/** Spawn/parse failures are classified and retried once in `tool-repair.ts` (execWithRepair). */
export class ProcessMcode implements McodeClient {
  async exec(req: ExecRequest): Promise<ExecResult> {
    const prepared = applyRoleDefaults(req);
    const { command, prefixArgs } = resolveMcodeInvocation();
    const args = buildExecArgs(prepared, prefixArgs);

    const rawLines: string[] = [];
    const events: StreamEvent[] = [];
    const started = Date.now();
    let first_token_ms: number | undefined;
    let stderr = "";

    const closed = await new Promise<Pick<ExecResult, "exitCode" | "timedOut" | "signal">>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: req.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";
      let killedByTimer = false;
      const onChunk = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          if (!line.trim()) continue;
          rawLines.push(line);
          const event = parseStreamLine(line);
          events.push(event);
          if (first_token_ms == null && (event.type === "delta" || event.type === "assistant" || event.text)) {
            first_token_ms = Date.now() - started;
          }
          req.onEvent?.(event);
        }
      };
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const timer =
        prepared.timeoutMs && prepared.timeoutMs > 0
          ? setTimeout(() => {
              killedByTimer = true;
              child.kill("SIGTERM");
            }, prepared.timeoutMs)
          : undefined;
      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new McodeMissingError());
          return;
        }
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        if (buffer.trim()) {
          rawLines.push(buffer);
          const event = parseStreamLine(buffer);
          events.push(event);
          req.onEvent?.(event);
        }
        if (stderr.trim()) {
          const event = { raw: stderr, type: "stderr", text: stderr.trim() };
          events.push(event);
          req.onEvent?.(event);
        }
        resolve(finalizeHostExit({ code, signal, killedByTimer }));
      });
    });

    const wall_ms = Date.now() - started;
    const usage = extractUsage(events, rawLines);
    if (usage && usage.first_token_ms == null && first_token_ms != null) usage.first_token_ms = first_token_ms;
    const stderrText = stderr.trim();
    return {
      text: collectAssistantText(events),
      events,
      exitCode: closed.exitCode,
      timedOut: closed.timedOut,
      ...(closed.signal ? { signal: closed.signal } : {}),
      rawLines,
      usage,
      structuredOutput: extractStructuredOutput(events),
      wall_ms,
      first_token_ms: usage?.first_token_ms ?? first_token_ms,
      ...(stderrText ? { stderr: stderrText } : {}),
    };
  }
}

export class StubMcode implements McodeClient {
  constructor(private readonly handler: (req: ExecRequest) => ExecResult | Promise<ExecResult>) {}
  async exec(req: ExecRequest): Promise<ExecResult> {
    const result = await this.handler(req);
    if (req.onEvent) {
      for (const event of result.events) req.onEvent(event);
    }
    return result;
  }
}
