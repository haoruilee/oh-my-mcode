import type { AcceptanceItem, AcceptanceKind, AcceptanceSource, FindingClass } from "./types.js";
import { detectProjectCommands } from "./verify.js";

/** Goal text that names a runnable check. Do not invent a command. */
const NAMED_CHECKS: Array<{ re: RegExp; command: string; kind: AcceptanceKind }> = [
  { re: /\bnpm run build\b/i, command: "npm run build", kind: "build" },
  { re: /\bnpm run test\b/i, command: "npm test", kind: "test" },
  { re: /\bnpm test\b/i, command: "npm test", kind: "test" },
  { re: /\bgo test\b/i, command: "go test ./...", kind: "test" },
  { re: /\bcargo test\b/i, command: "cargo test", kind: "test" },
  { re: /\bcargo build\b/i, command: "cargo build", kind: "build" },
  { re: /\bpytest\b/i, command: "pytest", kind: "test" },
  { re: /\bmake test\b/i, command: "make test", kind: "test" },
  { re: /\bnode --test\b/i, command: "node --test", kind: "test" },
];

const FILE_RE = /\b[\w./-]+\.(?:js|cjs|mjs|ts|tsx|jsx|go|rs|py|md|json)\b/;
const FUNC_RE = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/;

export function namedCheckInGoal(goal: string): { command: string; kind: AcceptanceKind } | undefined {
  for (const row of NAMED_CHECKS) {
    if (row.re.test(goal)) return { command: row.command, kind: row.kind };
  }
  return undefined;
}

/** Goal names a file, function, or test command — concrete enough to skip explorer on `max`. */
export function goalLooksConcrete(goal: string): boolean {
  const text = goal.trim();
  if (!text) return false;
  return Boolean(namedCheckInGoal(text) || FILE_RE.test(text) || FUNC_RE.test(text));
}

/** Goal names a check a verifier can run (command, or file+export / function). */
export function goalNamesVerifiableCheck(goal: string): boolean {
  const text = goal.trim();
  if (!text) return false;
  if (namedCheckInGoal(text)) return true;
  if (FUNC_RE.test(text)) return true;
  return FILE_RE.test(text) && /\bexport\b/i.test(text);
}

export function hasRunnableAcceptance(items: AcceptanceItem[] | undefined): boolean {
  return Boolean(items?.some((item) => typeof item.command === "string" && item.command.trim()));
}

export function seedGoalAcceptance(workspace: string, goal: string): AcceptanceItem[] {
  const named = namedCheckInGoal(goal);
  const detected = detectProjectCommands(workspace);
  const fromGoal = goalNamesVerifiableCheck(goal);
  const command = named?.command || detected.test || detected.build;
  if (!command) {
    return [
      {
        id: "A1",
        criterion: "Need a runnable test or build command before Accept.",
        kind: "manual",
      },
    ];
  }
  const kind: AcceptanceKind =
    named?.kind || (detected.build && command === detected.build && command !== detected.test ? "build" : "test");
  const source: AcceptanceSource = fromGoal ? "goal" : "detected";
  const criterion = fromGoal ? summarizeGoalCriterion(goal, command) : `Command succeeds: ${command}`;
  return [{ id: "A1", criterion, kind, command, source }];
}

function summarizeGoalCriterion(goal: string, command: string): string {
  const trimmed = goal.trim();
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 180)}… (${command})`;
}

/**
 * Planner may add tasks; it must not drop a seeded runnable command,
 * and must not invent a command when goal+workspace have none.
 */
export function mergeAcceptance(seeded: AcceptanceItem[], planned: AcceptanceItem[]): AcceptanceItem[] {
  if (!hasRunnableAcceptance(seeded)) {
    return seeded.length > 0 ? seeded : planned;
  }
  const plannedRunnable = planned.filter((item) => item.command?.trim());
  if (plannedRunnable.length > 0) {
    return planned.map((item) => {
      if (!item.command?.trim()) return item;
      const match = seeded.find((seed) => seed.command === item.command);
      return { ...item, source: item.source || match?.source };
    });
  }
  return seeded;
}

export function formatAcceptanceAnnouncement(runId: string, items: AcceptanceItem[]): string[] {
  const lines = [`run ${runId}`, "acceptance (how we will know we are done):"];
  if (items.length === 0) {
    lines.push("  (none — cannot Accept without a runnable test/build)");
    return lines;
  }
  for (const item of items) {
    const src = item.source ? ` source=${item.source}` : "";
    const cmd = item.command?.trim() ? ` command=${item.command}` : " (no command — no Accept path)";
    lines.push(`  ${item.id}:${src}${cmd} — ${item.criterion}`);
  }
  return lines;
}

export function shouldSkipDiscover(input: {
  workflow?: string;
  forceDiscover?: boolean;
  goal: string;
  workspace: string;
}): boolean {
  if (input.forceDiscover) return false;
  if ((input.workflow || "max") === "plan") return false;
  if (!goalLooksConcrete(input.goal)) return false;
  const detected = detectProjectCommands(input.workspace);
  return Boolean(detected.test || detected.build);
}

export function skippedDiscoverText(goal: string, items: AcceptanceItem[]): string {
  const lines = [
    "skipped: goal already concrete",
    "",
    "No explorer host exec. This note is not a repo map. Do not invent files we did not read.",
    "",
    `Goal: ${goal}`,
    "",
    "Acceptance:",
  ];
  if (items.length === 0) lines.push("- (none)");
  for (const item of items) {
    const src = item.source ? ` [${item.source}]` : "";
    const cmd = item.command ? ` (${item.command})` : "";
    lines.push(`- ${item.id}${src}${cmd}: ${item.criterion}`);
  }
  return `${lines.join("\n")}\n`;
}

export function classifyFinding(input: { title: string; hostCrash?: boolean }): FindingClass | undefined {
  if (input.hostCrash) return "host_crash";
  if (/^No automated test\/build command detected/i.test(input.title)) return "no_test";
  if (/^Command failed:/i.test(input.title)) return "command_failed";
  if (/^Stale content hash:/i.test(input.title)) return "stale_workspace";
  return undefined;
}
