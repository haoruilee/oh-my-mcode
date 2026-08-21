import { AsyncLocalStorage } from "node:async_hooks";
import { CliError } from "./util.js";
import type { Permission, Role, TaskContract } from "./types.js";
import {
  applyRoleDefaults,
  classifyHostExit,
  hostOutputSchemaEnabled,
  sessionXorContinue,
  type ExecRequest,
  type ExecResult,
  type McodeClient,
} from "./mcode.js";
import { execTracked, extractHostSessionId, isSynthesizedSessionToken, type SessionOpts } from "./session.js";
import type { RunStore } from "./store.js";
import { builderPrompt } from "./prompts.js";
import {
  collectStderr,
  emptyFailedYield,
  looksLikePlannerGraph,
  parseWorkerYield,
  workerYieldSchemaPath,
  yieldReminder,
  yieldSchemaAvailable,
  type ExecWithReminder,
  type WorkerYield,
} from "./yield.js";

/** Reminder exec: one text-only step. Host permission `off` is legal on 0.2.1 and cannot start a tool loop. */
export const YIELD_REMINDER_MAX_STEPS = 1;
export const YIELD_REMINDER_PERMISSION: Permission = "off";

export interface SpawnRequest {
  role: Role;
  contract: TaskContract;
  session?: string;
  continue?: boolean;
  permission: Permission;
  cwd: string;
  prompt?: string;
  files?: string[];
  timeoutMs?: number;
  maxSteps?: number;
  outputSchema?: string;
}

export interface SpawnContext {
  client: McodeClient;
  store?: RunStore;
  runId?: string;
  sessionOpts?: SessionOpts;
}

export interface SpawnResult extends ExecWithReminder {
  yield: WorkerYield;
}

interface SpawnFrame {
  role: Role;
  depth: number;
}

const spawnFrame = new AsyncLocalStorage<SpawnFrame>();

export function currentSpawnDepth(): number {
  return spawnFrame.getStore()?.depth ?? 0;
}

export function currentSpawnRole(): Role | undefined {
  return spawnFrame.getStore()?.role;
}

function plannerFallbackYield(result: ExecResult): WorkerYield | undefined {
  const data = result.structuredOutput && typeof result.structuredOutput === "object" ? result.structuredOutput.data : undefined;
  if (looksLikePlannerGraph(data)) {
    return { status: "ok", summary: "planner wrote task graph", findings: [], artifacts: ["plan.md", "tasks.json"] };
  }
  return undefined;
}

function resolveYield(result: ExecResult, role: Role): { ok: true; data: WorkerYield } | { ok: false; error: string } {
  const parsed = parseWorkerYield(result);
  if (parsed.ok) return parsed;
  if (role === "planner") {
    const fallback = plannerFallbackYield(result);
    if (fallback) return { ok: true, data: fallback };
  }
  return parsed;
}

/**
 * One harness-spawned role worker → one `mcode exec`.
 * Workers do not receive this function. Nested spawn throws.
 * Parent validates yield in TypeScript (`schemaMode: strict`).
 * Host `--output-schema` is opt-in (`OMM_HOST_OUTPUT_SCHEMA=1`); live 0.2.1 exits 70 on that path.
 */
export async function spawnSubagent(req: SpawnRequest, ctx: SpawnContext): Promise<SpawnResult> {
  const parent = spawnFrame.getStore();
  if (parent && parent.depth >= 1) {
    throw new CliError(
      `subagents cannot spawn grandchildren (parent role=${parent.role}; orchestrator is the only scheduler)`,
    );
  }
  return spawnFrame.run({ role: req.role, depth: 1 }, async () => spawnOnce(req, ctx));
}

/**
 * One reminder after an invalid yield. Same host session, text only.
 * Live 0.2.1: `--session` and `--continue` are mutually exclusive (invocation, exit 2).
 * Prefer `--session <mvs_>`. `--continue` only when no session id exists.
 * `--permission off` is in the host enum; it is not the exit-2 cause.
 */
export function yieldReminderRequest(req: SpawnRequest, first: ExecResult): SpawnRequest {
  const hostSession = extractHostSessionId(first);
  const candidate = hostSession && !isSynthesizedSessionToken(hostSession) ? hostSession : req.session;
  const session = candidate && !isSynthesizedSessionToken(candidate) ? candidate : undefined;
  const legal = sessionXorContinue({ session, continue: !session });
  return {
    ...req,
    session: legal.session,
    continue: legal.continue,
    maxSteps: YIELD_REMINDER_MAX_STEPS,
    permission: YIELD_REMINDER_PERMISSION,
  };
}

async function execOnce(req: SpawnRequest, ctx: SpawnContext, prompt: string): Promise<ExecResult> {
  const execReq: ExecRequest = applyRoleDefaults({
    cwd: req.cwd,
    prompt,
    role: req.role,
    permission: req.permission,
    session: req.session,
    continue: req.continue,
    files: req.files,
    timeoutMs: req.timeoutMs,
    maxSteps: req.maxSteps,
    outputSchema: req.outputSchema,
  });
  if (
    hostOutputSchemaEnabled() &&
    !execReq.outputSchema &&
    req.role !== "planner" &&
    yieldSchemaAvailable()
  ) {
    execReq.outputSchema = workerYieldSchemaPath();
  }
  if (ctx.store && ctx.runId) {
    return execTracked(ctx.client, ctx.store, ctx.runId, execReq, ctx.sessionOpts);
  }
  return ctx.client.exec(execReq);
}

async function spawnOnce(req: SpawnRequest, ctx: SpawnContext): Promise<SpawnResult> {
  if (ctx.store && ctx.runId) {
    ctx.store.appendEvent(
      ctx.runId,
      "subagent_spawned",
      {
        role: req.role,
        task_id: req.contract.task_id,
        grandchildren: false,
        depth: 1,
        schemaMode: "strict",
      },
      { task_id: req.contract.task_id },
    );
  }

  const prompt = req.prompt || builderPrompt(req.contract);
  const first = await execOnce(req, ctx, prompt);
  let parsed = resolveYield(first, req.role);
  let reminder: ExecResult | undefined;
  if (!parsed.ok) {
    // Continuation only. Do not re-send the explore contract (that invited a tool loop).
    // Do not dump first-exec JSONL or assistant prose into this prompt.
    reminder = await execOnce(yieldReminderRequest(req, first), ctx, yieldReminder(parsed.error));
    parsed = resolveYield(reminder, req.role);
  }
  const assistant = (first.text || "").trim() || (reminder?.text || "").trim();
  const reminderStderr = reminder ? collectStderr(reminder) : "";
  const reminderExit = reminder ? classifyHostExit(reminder.exitCode) : undefined;
  const evidence = reminder && (reminder.text || "").trim() ? reminder : first;
  const workerYield = parsed.ok
    ? parsed.data
    : emptyFailedYield(
        "invalid worker yield",
        [
          parsed.error,
          assistant ? `assistant_text: ${assistant.slice(0, 1500)}` : "",
          reminder && reminderExit && reminderExit !== "success"
            ? `reminder_exit: ${reminder.exitCode} (${reminderExit})`
            : "",
          reminderStderr ? `reminder_stderr: ${reminderStderr.slice(0, 1500)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
  return {
    ...evidence,
    yield: workerYield,
    ...(reminder ? { firstExec: first, reminderExec: reminder } : {}),
  };
}
