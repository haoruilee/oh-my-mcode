import type { RunEvent, RunRecord } from "./types.js";
import { RunStore } from "./store.js";
import { attachHud, loadHud, renderHud } from "./hud.js";
import { runVerifyOnly, type OrchestratorOptions } from "./orchestrator.js";
import { runInterview, type InterviewAnswers, type InterviewRecord } from "./interview.js";
import { cleanupRunWorktrees } from "./worktree.js";

export type HarnessOp =
  | { op: "create"; goal: string }
  | { op: "show"; runId?: string }
  | { op: "list" }
  | { op: "status"; runId?: string; attach?: boolean }
  | { op: "verify"; runId?: string } & Partial<OrchestratorOptions>
  | {
      op: "interview";
      goal?: string;
      runId?: string;
      answers?: InterviewAnswers;
      answersPath?: string;
      constraints?: string[];
      interactive?: boolean;
    }
  | { op: "cancel"; runId?: string; reason?: string };

export interface HarnessResult {
  op: HarnessOp["op"];
  run?: RunRecord;
  runs?: Array<Pick<RunRecord, "run_id" | "goal" | "phase" | "status" | "updated_at">>;
  interview?: InterviewRecord;
  hud?: string;
  events?: RunEvent[];
}

export type HarnessListener = (event: RunEvent) => void;

/**
 * One core session per thread (run). CLI commands and MCP tools are submissions.
 * events.jsonl is the event queue. Surfaces subscribe; they do not own the store.
 */
export class Harness {
  readonly store: RunStore;
  readonly workspace: string;
  private readonly listeners = new Set<HarnessListener>();
  private boundRunId?: string;

  constructor(workspace: string, store?: RunStore) {
    this.workspace = workspace;
    this.store = store || new RunStore(workspace);
  }

  subscribe(listener: HarnessListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  bind(runId: string): { runId: string; workspace: string } {
    this.store.load(runId);
    this.boundRunId = runId;
    return { runId, workspace: this.workspace };
  }

  emit(runId: string, type: RunEvent["type"], payload: Record<string, unknown> = {}, extra: { task_id?: string } = {}): RunEvent {
    const event = this.store.appendEvent(runId, type, payload, extra);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  async submit(op: HarnessOp): Promise<HarnessResult> {
    if (op.op === "create") {
      const run = this.store.create(op.goal);
      this.boundRunId = run.run_id;
      const events = this.store.loadEvents(run.run_id);
      for (const event of events) {
        for (const listener of this.listeners) listener(event);
      }
      return { op: "create", run, events };
    }
    if (op.op === "show") {
      const runId = this.store.resolveId(op.runId || this.boundRunId);
      this.boundRunId = runId;
      return { op: "show", run: this.store.load(runId), events: this.store.loadEvents(runId) };
    }
    if (op.op === "list") {
      const runs = this.store.listIds().map((id) => {
        const run = this.store.load(id);
        return {
          run_id: run.run_id,
          goal: run.goal,
          phase: run.phase,
          status: run.status,
          updated_at: run.updated_at,
        };
      });
      return { op: "list", runs };
    }
    if (op.op === "status") {
      const runId = this.store.resolveId(op.runId || this.boundRunId);
      this.boundRunId = runId;
      const hud = op.attach ? attachHud(this.store, runId) : renderHud(loadHud(this.store, runId));
      return { op: "status", run: this.store.load(runId), hud, events: this.store.loadEvents(runId) };
    }
    if (op.op === "verify") {
      const run = await runVerifyOnly({
        workspace: this.workspace,
        runId: op.runId || this.boundRunId,
        permission: op.permission,
        llmVerify: op.llmVerify,
        mcode: op.mcode,
        session: op.session,
        noSession: op.noSession,
        continue: op.continue,
      });
      this.boundRunId = run.run_id;
      return { op: "verify", run };
    }
    if (op.op === "interview") {
      const result = await runInterview({
        workspace: this.workspace,
        goal: op.goal,
        runId: op.runId || this.boundRunId,
        answers: op.answers,
        answersPath: op.answersPath,
        constraints: op.constraints,
        interactive: op.interactive,
      });
      this.boundRunId = result.run.run_id;
      return { op: "interview", run: result.run, interview: result.interview };
    }
    if (op.op === "cancel") {
      const runId = this.store.resolveId(op.runId || this.boundRunId);
      const run = this.store.cancel(runId, op.reason);
      cleanupRunWorktrees(this.workspace, runId);
      this.boundRunId = runId;
      return { op: "cancel", run };
    }
    throw new Error("unknown harness op");
  }
}

export function createHarness(workspace: string, store?: RunStore): Harness {
  return new Harness(workspace, store);
}
