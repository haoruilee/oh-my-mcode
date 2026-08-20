import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "./util.js";
import type { TaskContract } from "./types.js";

function roleFile(name: string): string {
  const filePath = path.join(packageRoot(), "agents", `${name}.md`);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export function clipRole(name: string, max = 1800): string {
  return clip(roleFile(name), max);
}

function clip(text: string, max = 1800): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}

export function explorerPrompt(goal: string): string {
  return `Role: Explorer (read-only).
${clip(roleFile("explorer"))}

Goal: ${goal}

Search the workspace. Do not edit files. Return:
- relevant paths
- existing test/build commands
- top risks
Keep it under 40 lines.`;
}

export function plannerPrompt(goal: string, discovery: string): string {
  return `Role: Planner (write plan artifacts only; do not edit product code).
${clip(roleFile("planner"))}

Goal: ${goal}

Discovery notes:
${clip(discovery, 1200)}

Write:
1) A short markdown plan (context, DAG, risks, rollback)
2) A JSON object in a fenced \`\`\`json block with shape:
{"tasks":[{"id":"T1","title":"...","role":"builder","depends_on":[],"allowed_files":[]}],"acceptance":[{"id":"A1","criterion":"...","kind":"test","command":"..."}]}

Acceptance must be runnable commands. One builder task per change. Do not implement.`;
}

export function plannerTeamPrompt(goal: string, discovery: string): string {
  return `${plannerPrompt(goal, discovery)}

Team mode: emit a DAG with roles explorer/planner/builder/verifier/release.
Independent builder tasks (no shared files, empty depends_on) MAY run in parallel.
Do not nest sub-agents. The TypeScript orchestrator is the only scheduler.
Builders never mark Accepted.`;
}

export function reviewerPrompt(input: {
  goal: string;
  plan: string;
  evidenceCount: number;
  currentStatus: string;
  diff: string;
  roleContract: string;
}): string {
  return `Role: Reviewer (read-only overlay). You cannot Accept.
${input.roleContract}

Goal: ${input.goal}
Current status: ${input.currentStatus}
Evidence files: ${input.evidenceCount}

Plan:
${clip(input.plan, 800)}

Diff stat:
${clip(input.diff || "(none)", 400)}

Write findings only. Reply with JSON:
{"findings":[{"title":"...","detail":"...","severity":"note"}],"notes":["review cannot Accept"]}
Do not edit files. Do not set Accepted.`;
}

export function builderPrompt(contract: TaskContract): string {
  return `Role: Builder. One task only. No scope creep. Do not mark Accepted.
${clip(roleFile("builder"))}

# Task ${contract.task_id}
Objective: ${contract.objective}
${contract.allowed_files?.length ? `Allowed files: ${contract.allowed_files.join(", ")}` : ""}
Acceptance:
${contract.acceptance.map((line) => `- ${line}`).join("\n")}
Constraints:
${contract.constraints.map((line) => `- ${line}`).join("\n")}

Implement this task. Run relevant tests if cheap. Summarize files changed.
Do not spawn sub-agents. The orchestrator is the only scheduler.`;
}

export function verifierPrompt(input: {
  goal: string;
  plan: string;
  acceptance: string[];
  commands: string[];
}): string {
  return `Role: Verifier. READ-ONLY. Do not edit, create, or delete files. Do not run formatters that write.
${clip(roleFile("verifier"))}

Goal: ${input.goal}

Plan:
${clip(input.plan, 800)}

Deterministic results (already run by oh-my-mcode, not by you):
${input.acceptance.map((line) => `- ${line}`).join("\n")}
Commands: ${input.commands.join(" | ") || "(none)"}

Judge leftovers only: missed acceptance, unsafe change, missing evidence.
Reply with JSON: {"blockers":[{"title":"...","detail":"..."}],"notes":["..."]}
If nothing leftover, {"blockers":[],"notes":["deterministic evidence is sufficient"]}.`;
}

export function repairPrompt(contract: TaskContract, findings: string): string {
  return `${builderPrompt(contract)}

Previous verifier findings to fix (and only these):
${clip(findings, 1200)}`;
}
