import { AsyncLocalStorage } from "node:async_hooks";
import { CliError } from "./util.js";
import type { Permission, Role, TaskContract } from "./types.js";
import { hostOutputSchemaEnabled, type ExecRequest, type ExecResult, type McodeClient } from "./mcode.js";
import { execTracked, type SessionOpts } from "./session.js";
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

export interface SpawnRequest {
  role: Role;
  contract: TaskContract;
  session?: string;
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

async function execOnce(req: SpawnRequest, ctx: SpawnContext, prompt: string): Promise<ExecResult> {
  const execReq: ExecRequest = {
    cwd: req.cwd,
    prompt,
    role: req.role,
    permission: req.permission,
    session: req.session,
    files: req.files,
    timeoutMs: req.timeoutMs,
    maxSteps: req.maxSteps,
    outputSchema: req.outputSchema,
  };
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
    result = await execOnce(req, ctx, `${prompt}\n\n${yieldReminder(parsed.error)}`);
    parsed = resolveYield(result, req.role);
  }
  const workerYield = parsed.ok
    ? parsed.data
    : emptyFailedYield("invalid worker yield", parsed.error);
  return { ...result, yield: workerYield };
}
