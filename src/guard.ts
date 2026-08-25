import { createHash } from "node:crypto";
import type { Findings } from "./types.js";

export type GuardBlockCode = "repeat-finding" | "repair-cap";

export type GuardAction =
  | { action: "repair"; fingerprint: string }
  | { action: "block"; code: GuardBlockCode; message: string; fingerprint: string };

export const INJECTED_TEXT_MAX_CHARS = 4000;

/** Same fingerprint as the previous VERIFY `signatureOf` — titles, then summary. */
export function findingFingerprint(findings: Findings): string {
  const key = findings.findings
    .map((item) => item.title)
    .sort()
    .join("|");
  return createHash("sha256")
    .update(key || findings.summary)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Loop-hygiene only. First fail → repair. Exact same fingerprint as last VERIFY
 * → block `repeat-finding` (stop on first repeat; no extra host exec). Over
 * maxRounds → block `repair-cap`. No remind-and-repair: an extra `mcode exec`
 * still costs 17–20k host input tokens.
 */
export function decideRepair(input: {
  fingerprint: string;
  lastFingerprint?: string;
  repairsIncludingThis: number;
  maxRounds: number;
}): GuardAction {
  const { fingerprint } = input;
  if (input.lastFingerprint !== undefined && input.lastFingerprint === fingerprint) {
    return {
      action: "block",
      code: "repeat-finding",
      message: "repeated failure signature; stopping repair loop",
      fingerprint,
    };
  }
  if (input.repairsIncludingThis > input.maxRounds) {
    return {
      action: "block",
      code: "repair-cap",
      message: `repair limit reached (${input.maxRounds})`,
      fingerprint,
    };
  }
  return { action: "repair", fingerprint };
}

/**
 * Deterministic head+tail prune for findings injected into the next builder
 * prompt. Not a compaction seam: no LLM summary, no `compaction/*` events.
 */
export function pruneInjectedText(text: string, maxChars = INJECTED_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const estimate = `… (+${text.length} chars omitted)`;
  const keep = Math.max(0, maxChars - estimate.length);
  const headLen = Math.ceil(keep / 2);
  const tailLen = Math.floor(keep / 2);
  const omitted = Math.max(0, text.length - headLen - tailLen);
  const marker = `… (+${omitted} chars omitted)`;
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(-tailLen) : "";
  return `${head}${marker}${tail}`;
}
