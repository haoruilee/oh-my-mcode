import { spawnSync } from "node:child_process";
import type { FindingItem, RunRecord } from "./types.js";
import { nowIso } from "./util.js";
import { RunStore } from "./store.js";
import { ProcessMcode, type McodeClient } from "./mcode.js";
import { applyRequestedSession, execTracked, judgeEvidenceFiles } from "./session.js";
import { loadWorkflow } from "./workflows.js";
import { clipRole, reviewerPrompt } from "./prompts.js";

export interface ReviewOptions {
  workspace: string;
  runId?: string;
  mcode?: McodeClient;
  permission?: "ask" | "smart" | "full" | "off";
  session?: string;
  noSession?: boolean;
  continue?: boolean;
}

export interface ReviewReport {
  run_id: string;
  reviewed_at: string;
  can_accept: false;
  summary: string;
  findings: FindingItem[];
  evidence_files: number;
  phase: string;
  status: string;
}

function gitDiff(workspace: string): string {
  const result = spawnSync("git", ["diff", "--stat"], { cwd: workspace, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) return "";
  return (result.stdout || "").trim();
}

export async function runReview(opts: ReviewOptions): Promise<{ run: RunRecord; review: ReviewReport }> {
  loadWorkflow("review");
  const store = new RunStore(opts.workspace);
  const runId = store.resolveId(opts.runId);
  const run = store.load(runId);
  const plan = store.loadPlan(runId);
  const evidence = store.loadEvidence(runId);
  const findings = store.loadFindings(runId);
  const diff = gitDiff(opts.workspace);
  const extra: FindingItem[] = [];

  applyRequestedSession(store, runId, opts);
  const client = opts.mcode || (process.env.OMM_MCODE ? new ProcessMcode() : undefined);
  if (client) {
    try {
      const result = await execTracked(
        client,
        store,
        runId,
        {
          cwd: opts.workspace,
          prompt: reviewerPrompt({
            goal: run.goal,
            plan,
            evidenceCount: evidence.items.length,
            currentStatus: run.status,
            diff,
            roleContract: clipRole("verifier"),
          }),
          role: "verifier",
          permission: "ask",
          files: judgeEvidenceFiles(store, runId),
        },
        opts,
      );
      store.writeTextEvidence(runId, "log", "review-llm.md", result.text || "(empty review)", {
        notes: "read-only review; cannot Accept",
      });
      const fence = result.text.match(/```json\s*([\s\S]*?)```/i);
      if (fence?.[1]) {
        const parsed = JSON.parse(fence[1]) as { findings?: { title: string; detail: string; severity?: string }[] };
        for (const [i, item] of (parsed.findings || []).entries()) {
          extra.push({
            id: `F${i + 1}`,
            severity: (item.severity as FindingItem["severity"]) || "note",
            title: item.title,
            detail: item.detail,
          });
        }
      }
    } catch {
      extra.push({
        id: "F1",
        severity: "note",
        title: "LLM review skipped",
        detail: "Local evidence review only.",
      });
    }
  }

  if (evidence.items.length === 0) {
    extra.push({
      id: `F${extra.length + 1}`,
      severity: "major",
      title: "No evidence files",
      detail: "Review cannot recommend Accept; evidence is missing.",
    });
  }

  const review: ReviewReport = {
    run_id: runId,
    reviewed_at: nowIso(),
    can_accept: false,
    summary:
      extra.length > 0
        ? `Read-only review of ${run.run_id}: ${extra[0]?.title}. Review cannot Accept.`
        : `Read-only review of ${run.run_id}. ${evidence.items.length} evidence files. Review cannot Accept.`,
    findings: extra,
    evidence_files: evidence.items.length,
    phase: run.phase,
    status: run.status,
  };

  store.writeArtifact(
    runId,
    "review.json",
    `${JSON.stringify(review, null, 2)}\n`,
  );
  store.writeArtifact(
    runId,
    "review.md",
    `# Review (read-only)\n\nRun: ${runId}\nStatus: ${run.status}\nPhase: ${run.phase}\n\nReview **cannot Accept**.\n\n## Existing verifier findings\n\n${findings ? `${findings.verdict}: ${findings.summary}` : "_none_"}\n\n## Diff stat\n\n${diff || "_none_"}\n\n## Notes\n\n${review.summary}\n`,
  );
  store.writeTextEvidence(runId, "log", "review.md", store.readArtifact(runId, "review.md"), {
    notes: "review",
  });
  store.appendEvent(runId, "review_completed", { can_accept: false, finding_count: extra.length });
  return { run: store.load(runId), review };
}
