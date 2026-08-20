import type { RunRecord } from "./types.js";
import { RunStore } from "./store.js";
import { ProcessMcode, resolveMcodeInvocation, type McodeClient } from "./mcode.js";
import { McodeMissingError } from "./util.js";
import { explorerPrompt } from "./prompts.js";
import { execWithRepair } from "./tool-repair.js";
import { loadWorkflow } from "./workflows.js";

export interface ResearchOptions {
  workspace: string;
  goal?: string;
  runId?: string;
  mcode?: McodeClient;
  permission?: "ask" | "smart" | "full" | "off";
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
  store.setPhase(run.run_id, "DISCOVER");
  const client = requireClient(opts, store, run.run_id);
  const result = await execWithRepair(
    client,
    {
      cwd: opts.workspace,
      prompt: explorerPrompt(run.goal),
      role: "explorer",
      permission: opts.permission === "full" ? "ask" : opts.permission || "ask",
    },
    { store, runId: run.run_id },
  );
  const note = `# Research\n\nTopic: ${run.goal}\n\nThis run is DISCOVER-only. No builder. No product edits.\n\n## Explorer\n\n${result.text || "(no explorer output)"}\n`;
  store.writeArtifact(run.run_id, "research.md", note);
  store.writeTextEvidence(run.run_id, "log", "research.md", note, { notes: "research" });
  store.writeTextEvidence(run.run_id, "log", "mcode-discover.jsonl", result.rawLines.join("\n") || result.text || "(empty)", {
    command: "mcode exec (discover)",
    exit_code: result.exitCode,
  });
  store.appendEvent(run.run_id, "research_completed", { role: "explorer", builder: false });
  store.evidenceReport(run.run_id);
  return store.load(run.run_id);
}
