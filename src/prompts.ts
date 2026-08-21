import type { TaskContract } from "./types.js";
import { yieldContractLine } from "./yield.js";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function measurePrompt(text: string): { chars: number; est_tokens: number } {
  return { chars: text.length, est_tokens: estimateTokens(text) };
}

export function tpsProbePrompt(): string {
  return [
    "Reply with exactly the word pong.",
    "Then write two short sentences confirming you used no tools and edited no files.",
    "Do not use tools. Do not edit files. Do not spawn.",
  ].join(" ");
}

function packetBlock(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `\n${label}: ${trimmed}\n`;
}

/** Contract-only. Point at paths. Host already has read. Do not paste file bodies. */
export function explorerPrompt(goal: string, interview = ""): string {
  return `Role: explorer (read-only).
Goal: ${goal}
${packetBlock("Interview path", interview ? "interview.md" : "")}
Allowed: read/search. Do not edit product files. Do not spawn.
Return paths, test/build commands, top risks.
Greenfield / empty product tree: yield status ok with note findings (no src, suggested new files, test/build commands). Do not use status blocked because the repo is empty.
blocked is only for missing permission or missing tools.
Once you have paths, commands, and risks, the LAST message is ONLY the yield JSON. No more tools. Do not hash files unless the yield already includes file_hashes and you are done.
${yieldContractLine()}`;
}

export function plannerPrompt(goal: string, discovery: string, interview = ""): string {
  return `Role: planner (plan artifacts only; no product edits).
Goal: ${goal}
${packetBlock("Interview path", interview ? "interview.md" : "")}
Discovery (summary only; host can read files):
${discovery.trim() ? discovery.trim().slice(0, 400) : "(none)"}
Write plan.md + tasks JSON with runnable acceptance. Do not implement. Do not spawn.
${yieldContractLine()}`;
}

export function plannerTeamPrompt(goal: string, discovery: string, interview = ""): string {
  return `${plannerPrompt(goal, discovery, interview)}
Team packet: emit independent builder tasks (empty depends_on) for the orchestrator to fan out. No nested workers.`;
}

export function reviewerPrompt(input: {
  goal: string;
  plan: string;
  evidenceCount: number;
  currentStatus: string;
  diff: string;
}): string {
  return `Role: reviewer (read-only). Cannot Accept.
Goal: ${input.goal}
Status: ${input.currentStatus}
Evidence files: ${input.evidenceCount}
Plan path: plan.md
Diff stat: ${input.diff ? input.diff.split("\n")[0] : "(none)"}
${yieldContractLine()}
Do not edit. Do not Accept.`;
}

export function builderPrompt(contract: TaskContract, context = ""): string {
  return `Role: builder. One task. Do not mark Accepted. Do not spawn.
Task: ${contract.task_id}
Objective: ${contract.objective}
${contract.allowed_files?.length ? `Allowed files: ${contract.allowed_files.join(", ")}` : "Allowed files: (contract; host can read)"}
Acceptance:
${contract.acceptance.map((line) => `- ${line}`).join("\n") || "- (see tasks.json)"}
Constraints:
${contract.constraints.map((line) => `- ${line}`).join("\n")}
${packetBlock("Shared context", context)}
Point at paths. Do not paste file bodies. Host already has read.
${yieldContractLine()}`;
}

export function verifierPrompt(input: {
  goal: string;
  plan: string;
  acceptance: string[];
  commands: string[];
}): string {
  return `Role: verifier. READ-ONLY. Do not edit. Do not Accept here — TypeScript writes findings.
Goal: ${input.goal}
Plan path: plan.md
Deterministic results (already run):
${input.acceptance.map((line) => `- ${line}`).join("\n")}
Commands: ${input.commands.join(" | ") || "(none)"}
Judge leftovers only. Point at evidence paths.
${yieldContractLine()}`;
}

export function repairPrompt(contract: TaskContract, findings: string, context = ""): string {
  return `${builderPrompt(contract, context)}
Repair only these findings (structured, not prose dump):
${findings.slice(0, 800)}`;
}
