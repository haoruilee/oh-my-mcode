/**
 * Parse `mcode --version` and map CLI versions to harness capability flags.
 * Documented host as of 2026-08-28 is CLI 0.2.7. We do not scrape a live binary.
 */

export interface HostVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export const HOST_DOCUMENTED_VERSION = "0.2.7";
export const HOST_STRUCTURED_EXEC_SINCE: HostVersion = { major: 0, minor: 2, patch: 4, raw: "0.2.4" };
export const HOST_LEGACY_OUTPUT_SCHEMA_CRASH: HostVersion = { major: 0, minor: 2, patch: 1, raw: "0.2.1" };

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

/**
 * Tolerate `0.2.7`, `@minimax-ai/code@0.2.7`, and extra surrounding text.
 * First `x.y.z` wins. Unparsed → undefined (doctor stays honest).
 */
export function parseHostVersion(text: string): HostVersion | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const match = text.match(SEMVER_RE);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) return undefined;
  return { major, minor, patch, raw: `${major}.${minor}.${patch}` };
}

export function compareHostVersion(a: HostVersion, b: Pick<HostVersion, "major" | "minor" | "patch">): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function hostVersionAtLeast(
  version: HostVersion | undefined,
  minimum: Pick<HostVersion, "major" | "minor" | "patch">,
): boolean {
  return Boolean(version && compareHostVersion(version, minimum) >= 0);
}

export function formatHostVersion(version: HostVersion | undefined): string {
  return version ? version.raw : "unknown";
}

export interface HostCapabilities {
  structuredExec: boolean;
  outputSchemaDocumented: boolean;
  /** Live 0.2.1 `--output-schema` was host-internal exit 70. */
  legacyOutputSchemaCrash: boolean;
  notes: string[];
}

export const OUTPUT_SCHEMA_OMIT_NOTE =
  "documented since 0.2.4; we omit --output-schema until a live rematch proves it is not exit 70";

export const LEGACY_OUTPUT_SCHEMA_CRASH_NOTE =
  "0.2.1 --output-schema is host-internal exit 70";

/**
 * Capability flags from a parsed version. Missing/unparsed version → all false.
 * Never auto-enables `--output-schema`. `OMM_HOST_OUTPUT_SCHEMA=1` remains the probe.
 */
export function hostCapabilities(version: HostVersion | undefined): HostCapabilities {
  if (!version) {
    return {
      structuredExec: false,
      outputSchemaDocumented: false,
      legacyOutputSchemaCrash: false,
      notes: ["unparsed host version"],
    };
  }
  const structuredExec = hostVersionAtLeast(version, HOST_STRUCTURED_EXEC_SINCE);
  const outputSchemaDocumented = structuredExec;
  const legacyOutputSchemaCrash =
    version.major === HOST_LEGACY_OUTPUT_SCHEMA_CRASH.major &&
    version.minor === HOST_LEGACY_OUTPUT_SCHEMA_CRASH.minor &&
    version.patch === HOST_LEGACY_OUTPUT_SCHEMA_CRASH.patch;
  const notes: string[] = [];
  if (legacyOutputSchemaCrash) notes.push(LEGACY_OUTPUT_SCHEMA_CRASH_NOTE);
  if (outputSchemaDocumented) notes.push(OUTPUT_SCHEMA_OMIT_NOTE);
  else if (!structuredExec) notes.push("structured exec events documented from 0.2.4");
  return { structuredExec, outputSchemaDocumented, legacyOutputSchemaCrash, notes };
}

export function formatHostCapabilities(caps: HostCapabilities): string {
  const flags = [
    `structuredExec=${caps.structuredExec ? "yes" : "no"}`,
    `outputSchemaDocumented=${caps.outputSchemaDocumented ? "yes" : "no"}`,
    `legacyOutputSchemaCrash=${caps.legacyOutputSchemaCrash ? "yes" : "no"}`,
  ];
  const note = caps.notes[0] ? ` — ${caps.notes[0]}` : "";
  return `${flags.join(" ")}${note}`;
}
