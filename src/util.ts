import { randomBytes } from "node:crypto";
import { constants, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Package root for npx / global / checkout. Walks up from this module
 * (`import.meta.url`), never `process.cwd()`. Tests may set OMM_PACKAGE_ROOT.
 */
export function packageRoot(): string {
  if (process.env.OMM_PACKAGE_ROOT) return path.resolve(process.env.OMM_PACKAGE_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "plugin.json")) && existsSync(path.join(dir, ".minimax-plugin/plugin.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function writeAtomic(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, filePath);
}

export function writeJson(filePath: string, value: unknown): void {
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function crockford32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

export function newRunId(): string {
  const time = BigInt(Date.now());
  const timeBytes = Buffer.alloc(6);
  let remaining = time;
  for (let i = 5; i >= 0; i -= 1) {
    timeBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return `run_${crockford32(timeBytes).slice(0, 10)}${crockford32(randomBytes(10)).slice(0, 16)}`;
}

export function newEventId(): string {
  return `evt_${crockford32(Buffer.concat([Buffer.from(Date.now().toString()), randomBytes(8)])).slice(0, 20)}`;
}

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class McodeMissingError extends CliError {
  constructor(message = "mcode is not on PATH. Install MiniMax Code CLI (@minimax-ai/code) 0.2.7+.") {
    super(message, 2);
    this.name = "McodeMissingError";
  }
}

export function parseJsonObject(text: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : fallback;
  } catch {
    return fallback;
  }
}

export async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [Y/n] `, resolve);
  });
  rl.close();
  return !/^(n|no)$/i.test(answer.trim());
}

export async function promptLine(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliError("promptLine requires a TTY; pass --answers or --constraint");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} `, resolve);
  });
  rl.close();
  return answer.trim();
}

export function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function which(bin: string): string | undefined {
  const pathEnv = process.env.PATH || "";
  const parts = pathEnv.split(path.delimiter);
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of parts) {
    for (const suffix of ext) {
      const candidate = path.join(dir, bin + suffix);
      try {
        const st = statSync(candidate);
        if (st.isFile() && (process.platform === "win32" || st.mode & constants.S_IXUSR)) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
  }
  return undefined;
}
