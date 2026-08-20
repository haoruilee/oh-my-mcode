import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { McodeMissingError, packageRoot, which } from "./util.js";
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
}

export interface ExecResult {
  text: string;
  events: StreamEvent[];
  exitCode: number;
  rawLines: string[];
  usage?: UsageTotals;
  structuredOutput?: { data?: unknown };
  wall_ms?: number;
  first_token_ms?: number;
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

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["text", "content", "result", "message", "output"]) {
      if (key in rec) {
        const inner = asText(rec[key]);
        if (inner) return inner;
      }
    }
  }
  return "";
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
    return { raw, type, text: asText(raw), tool };
  } catch {
    return { raw: line, type: "text", text: line };
  }
}

export const ROLE_EXEC_DEFAULTS: Record<
  Role,
  { permission?: Permission; timeoutMs: number; maxSteps: number }
> = {
  explorer: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 20 },
  planner: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 16 },
  builder: { timeoutMs: 15 * 60 * 1000, maxSteps: 48 },
  verifier: { permission: "ask", timeoutMs: 5 * 60 * 1000, maxSteps: 20 },
  release: { permission: "ask", timeoutMs: 3 * 60 * 1000, maxSteps: 12 },
};

export function plannerOutputSchemaPath(): string {
  return path.join(packageRoot(), "schemas", "planner-output.schema.json");
}

export function applyRoleDefaults(req: ExecRequest): ExecRequest {
  const defaults = ROLE_EXEC_DEFAULTS[req.role];
  return {
    ...req,
    permission: req.permission || defaults.permission || "ask",
    timeoutMs: req.timeoutMs ?? defaults.timeoutMs,
    maxSteps: req.maxSteps ?? defaults.maxSteps,
    outputSchema:
      req.outputSchema ?? (req.role === "planner" && existsSync(plannerOutputSchemaPath()) ? plannerOutputSchemaPath() : req.outputSchema),
  };
}

export function collectAssistantText(events: StreamEvent[]): string {
  const chunks = events
    .filter((event) => {
      const type = (event.type || "").toLowerCase();
      if (type.includes("tool") || type.includes("error")) return false;
      return Boolean(event.text);
    })
    .map((event) => event.text || "");
  if (chunks.length > 0) return chunks.join("\n").trim();
  return events
    .map((event) => event.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Spawn/parse failures are classified and retried once in `tool-repair.ts` (execWithRepair). */
export class ProcessMcode implements McodeClient {
  async exec(req: ExecRequest): Promise<ExecResult> {
    const { command, prefixArgs } = resolveMcodeInvocation();
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
    if (req.session) args.push("--session", req.session);
    if (req.continue) args.push("--continue");
    if (req.outputSchema) args.push("--output-schema", req.outputSchema);
    for (const file of req.files || []) args.push("--file", file);
    if (req.maxSteps && req.maxSteps > 0) args.push("--max-steps", String(req.maxSteps));
    if (req.timeoutMs && req.timeoutMs > 0) args.push("--timeout", String(Math.max(1, Math.ceil(req.timeoutMs / 1000))));
    args.push(req.prompt);

    const rawLines: string[] = [];
    const events: StreamEvent[] = [];
    const started = Date.now();
    let first_token_ms: number | undefined;

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: req.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      let buffer = "";
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
        req.timeoutMs && req.timeoutMs > 0
          ? setTimeout(() => {
              child.kill("SIGTERM");
            }, req.timeoutMs)
          : undefined;
      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new McodeMissingError());
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
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
        resolve(code ?? 1);
      });
    });

    const wall_ms = Date.now() - started;
    const usage = extractUsage(events, rawLines);
    if (usage && usage.first_token_ms == null && first_token_ms != null) usage.first_token_ms = first_token_ms;
    return {
      text: collectAssistantText(events),
      events,
      exitCode,
      rawLines,
      usage,
      structuredOutput: extractStructuredOutput(events),
      wall_ms,
      first_token_ms: usage?.first_token_ms ?? first_token_ms,
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
