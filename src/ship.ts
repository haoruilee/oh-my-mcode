import { spawnSync } from "node:child_process";
import { CliError } from "./util.js";
import { RunStore } from "./store.js";
import { loadWorkflow } from "./workflows.js";
import type { RunRecord } from "./types.js";

export interface ShipOptions {
  workspace: string;
  runId?: string;
  commit?: boolean;
}

export interface ShipResult {
  run: RunRecord;
  notesPath: string;
  notes: string;
  commands: string[];
  committed: boolean;
  pushed: boolean;
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: (result.status ?? 1) === 0, stdout: (result.stdout || result.stderr || "").trim() };
}

function porcelain(workspace: string): string[] {
  const result = git(["status", "--porcelain"], workspace);
  if (!result.ok) return [];
  return result.stdout.split("\n").filter(Boolean);
}

export async function runShip(opts: ShipOptions): Promise<ShipResult> {
  loadWorkflow("ship");
  const store = new RunStore(opts.workspace);
  const runId = store.resolveId(opts.runId);
  const run = store.load(runId);
  if (run.status !== "accepted") {
    throw new CliError(`ship refuses non-accepted runs (status=${run.status})`);
  }

  const findings = store.loadFindings(runId);
  const evidence = store.loadEvidence(runId);
  const summary = store.readArtifact(runId, "summary.md");
  const notes = [
    `# Release notes`,
    ``,
    `Run: \`${run.run_id}\``,
    `Goal: ${run.goal}`,
    `Status: ${run.status}`,
    ``,
    `## Evidence`,
    ``,
    findings ? `Verifier: **${findings.verdict}** — ${findings.summary}` : `_no findings.json_`,
    ``,
    `Evidence files: ${evidence.items.length}`,
    ``,
    `## Suggested next steps`,
    ``,
    `Role = Release. Default is notes + commands. This command does not mark Accepted.`,
    ``,
    summary ? `See also \`summary.md\` in the run store.` : "",
    ``,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");

  const notesPath = store.writeArtifact(runId, "release.md", notes);
  store.writeTextEvidence(runId, "other", "release.md", notes, { notes: "ship" });

  const commands = [
    `git add -A`,
    `git commit -m "ship ${run.run_id}: ${run.goal.slice(0, 60).replace(/"/g, "")}"`,
    `git push`,
    `gh pr create --title "${run.goal.slice(0, 60).replace(/"/g, "")}" --body "Accepted run ${run.run_id}. See .minimax/runs/${run.run_id}/summary.md"`,
  ];

  let committed = false;
  let pushed = false;
  if (opts.commit) {
    const inside = git(["rev-parse", "--is-inside-work-tree"], opts.workspace);
    if (inside.ok) {
      const dirty = porcelain(opts.workspace);
      const merge = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], opts.workspace);
      if (!merge.ok && dirty.length > 0) {
        const commit = git(
          ["commit", "-am", `ship ${run.run_id}: ${run.goal.slice(0, 72)}`],
          opts.workspace,
        );
        committed = commit.ok;
      }
      const cleanAfter = porcelain(opts.workspace);
      if (committed && cleanAfter.length === 0) {
        const push = git(["push"], opts.workspace);
        pushed = push.ok;
      }
    }
  }

  store.setPhase(runId, "RELEASE");
  store.appendEvent(runId, "ship_prepared", {
    committed,
    pushed,
    commit_requested: Boolean(opts.commit),
    commands,
  });
  store.evidenceReport(runId);
  return { run: store.load(runId), notesPath, notes, commands, committed, pushed };
}

export function formatShip(result: ShipResult): string {
  const lines = [
    result.notes.trim(),
    ``,
    `Suggested commands (not run${result.committed ? " except local commit" : ""}):`,
    ...result.commands.map((cmd) => `  ${cmd}`),
  ];
  if (result.committed) lines.push(``, `Committed locally.`);
  if (result.pushed) lines.push(`Pushed.`);
  if (result.committed && !result.pushed) {
    lines.push(`Push skipped (tree not clean enough, or push failed).`);
  }
  return lines.join("\n");
}
