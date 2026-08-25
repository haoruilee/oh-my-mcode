import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { confinedWorkspaceRel } from "./safe-path.js";

export function sha256Bytes(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return sha256Bytes(readFileSync(filePath));
}

export function hashWorkspaceFiles(workspace: string, relPaths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relPaths) {
    const full = confinedWorkspaceRel(workspace, rel);
    if (!full) continue;
    const hash = sha256File(full);
    if (hash) out[rel] = hash;
  }
  return out;
}

export function hashesMatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  return expected.toLowerCase() === actual.toLowerCase();
}

export interface StaleHash {
  path: string;
  expected: string;
  actual?: string;
}

export function staleFileHashes(workspace: string, expected: Record<string, string>): StaleHash[] {
  const stale: StaleHash[] = [];
  for (const [rel, hash] of Object.entries(expected)) {
    const full = confinedWorkspaceRel(workspace, rel);
    if (!full) continue;
    const actual = sha256File(full);
    if (!hashesMatch(hash, actual)) stale.push({ path: rel, expected: hash, actual });
  }
  return stale;
}
