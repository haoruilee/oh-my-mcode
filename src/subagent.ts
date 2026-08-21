import { AsyncLocalStorage } from "node:async_hooks";
import { CliError } from "./util.js";
import type { Permission, Role, TaskContract } from "./types.js";
import { applyRoleDefaults, hostOutputSchemaEnabled, type ExecRequest, type ExecResult, type McodeClient } from "./mcode.js";
import { execTracked, extractHostSessionId, isSynthesizedSessionToken, type SessionOpts } from "./session.js";
import type { RunStore } from "./store.js";
import { builderPrompt } from "./prompts.js";
import {
  emptyFailedYield,
  looksLikePlannerGraph,
  parseWorkerYield,
  workerYieldSchemaPath,
  yieldReminder,
  yieldSchemaAvailable,
  type WorkerYield,
} from "./yield.js";

/** Reminder exec: one text-only step. Host permission `off` cannot start a tool loop. */
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

export interface SpawnResult extends ExecResult {
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
 * One reminder after an invalid yield. Continuation of the same host session.
 * Not a fresh explore: no tools, maxSteps 1, permission off.
 */
export function yieldReminderRequest(req: SpawnRequest, first: ExecResult): SpawnRequest {
  const hostSession = extractHostSessionId(first);
  return {
    ...req,
    session: hostSession && !isSynthesizedSessionToken(hostSession) ? hostSession : req.session,
    continue: true,
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
  let result = await execOnce(req, ctx, prompt);
  let parsed = resolveYield(result, req.role);
  if (!parsed.ok) {
    // Continuation only. Do not re-send the explore contract (that invited a tool loop).
    // Do not dump first-exec JSONL or assistant prose into this prompt.
    result = await execOnce(yieldReminderRequest(req, result), ctx, yieldReminder(parsed.error));
    parsed = resolveYield(result, req.role);
  }
  const workerYield = parsed.ok
    ? parsed.data
    : emptyFailedYield(
        "invalid worker yield",
        [parsed.error, result.text?.trim() ? `assistant_text: ${result.text.trim().slice(0, 1500)}` : ""]
          .filter(Boolean)
          .join("\n"),
      );
  return { ...result, yield: workerYield };
}
