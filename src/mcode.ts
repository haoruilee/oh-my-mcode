import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { McodeMissingError, which } from "./util.js";
import type { Permission, Role } from "./types.js";

export interface ExecRequest {
  cwd: string;
  prompt: string;
  role: Role;
  permission: Permission;
  timeoutMs?: number;
  session?: string;
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
    args.push(req.prompt);

    const rawLines: string[] = [];
    const events: StreamEvent[] = [];

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
          events.push(parseStreamLine(line));
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
          events.push(parseStreamLine(buffer));
        }
        if (stderr.trim()) {
          events.push({ raw: stderr, type: "stderr", text: stderr.trim() });
        }
        resolve(code ?? 1);
      });
    });

    return {
      text: collectAssistantText(events),
      events,
      exitCode,
      rawLines,
    };
  }
}

export class StubMcode implements McodeClient {
  constructor(private readonly handler: (req: ExecRequest) => ExecResult | Promise<ExecResult>) {}
  exec(req: ExecRequest): Promise<ExecResult> {
    return Promise.resolve(this.handler(req));
  }
}
