import type { RunRecord } from "./types.js";
import { RunStore } from "./store.js";
import { ProcessMcode, resolveMcodeInvocation, type McodeClient } from "./mcode.js";
import { McodeMissingError } from "./util.js";
import { explorerPrompt } from "./prompts.js";
import { applyRequestedSession, emitHostSessionHints } from "./session.js";
import { spawnSubagent } from "./subagent.js";
import { writeExecPhaseSnapshots } from "./yield.js";
import { loadWorkflow } from "./workflows.js";

export interface ResearchOptions {
  workspace: string;
  goal?: string;
  runId?: string;
  mcode?: McodeClient;
  permission?: "ask" | "smart" | "full" | "off";
  session?: string;
  noSession?: boolean;
  continue?: boolean;
}

function requireClient(opts: ResearchOptions, store: RunStore, runId: string): McodeClient {
  if (opts.mcode) return opts.mcode;
  try {
    resolveMcodeInvocation();
    return new ProcessMcode();
  } catch (error) {
    if (error instanceof McodeMissingError) {
      store.appendEvent(runId, "tool_called", { error: "mcode_missing" });
    }
    throw error;
  }
}

/** DISCOVER-only. Explorer. No builder. No product edits. */
export async function runResearch(opts: ResearchOptions): Promise<RunRecord> {
  loadWorkflow("research");
  const store = new RunStore(opts.workspace);
  const run = opts.runId ? store.load(opts.runId) : store.create(opts.goal || "");
  store.patchRun(run.run_id, { workflow: "research" });
  applyRequestedSession(store, run.run_id, opts);
  store.setPhase(run.run_id, "DISCOVER");
  const client = requireClient(opts, store, run.run_id);
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: {
        task_id: "research",
        objective: run.goal,
        acceptance: ["Write a research note. Do not edit product files."],
        constraints: ["DISCOVER only", "Do not spawn", "Do not Accept"],
      },
      permission: opts.permission === "full" ? "ask" : opts.permission || "ask",
      cwd: opts.workspace,
      prompt: explorerPrompt(run.goal),
    },
    { client, store, runId: run.run_id, sessionOpts: opts },
  );
  const note = `# Research\n\nTopic: ${run.goal}\n\nThis run is DISCOVER-only. No builder. No product edits.\n\n## Explorer\n\n${result.yield.summary || "(no explorer yield)"}\n`;
  store.writeArtifact(run.run_id, "research.md", note);
  store.writeTextEvidence(run.run_id, "log", "research.md", note, { notes: "research" });
  writeExecPhaseSnapshots(store, run.run_id, "discover", result, {
    yieldStatus: result.yield.status,
    hashes: result.yield.file_hashes,
  });
  store.appendEvent(run.run_id, "research_completed", { role: "explorer", builder: false });
  store.evidenceReport(run.run_id);
  const finished = store.load(run.run_id);
  emitHostSessionHints(finished, () => undefined);
  return finished;
}
