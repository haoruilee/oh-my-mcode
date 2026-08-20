import { AsyncLocalStorage } from "node:async_hooks";
import { CliError } from "./util.js";
import type { Permission, Role, TaskContract } from "./types.js";
import type { ExecRequest, ExecResult, McodeClient } from "./mcode.js";
import { execTracked, type SessionOpts } from "./session.js";
import type { RunStore } from "./store.js";
import { builderPrompt } from "./prompts.js";

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

/**
 * One harness-spawned role worker → one `mcode exec`.
 * Workers do not receive this function. Nested spawn throws.
 */
export async function spawnSubagent(req: SpawnRequest, ctx: SpawnContext): Promise<ExecResult> {
  const parent = spawnFrame.getStore();
  if (parent && parent.depth >= 1) {
    throw new CliError(
      `subagents cannot spawn grandchildren (parent role=${parent.role}; orchestrator is the only scheduler)`,
    );
  }
  return spawnFrame.run({ role: req.role, depth: 1 }, async () => spawnOnce(req, ctx));
}

async function spawnOnce(req: SpawnRequest, ctx: SpawnContext): Promise<ExecResult> {
  const execReq: ExecRequest = {
    cwd: req.cwd,
    prompt: req.prompt || builderPrompt(req.contract),
    role: req.role,
    permission: req.permission,
    session: req.session,
    files: req.files,
    timeoutMs: req.timeoutMs,
    maxSteps: req.maxSteps,
    outputSchema: req.outputSchema,
  };
  if (ctx.store && ctx.runId) {
    ctx.store.appendEvent(
      ctx.runId,
      "subagent_spawned",
      {
        role: req.role,
        task_id: req.contract.task_id,
        grandchildren: false,
        depth: 1,
      },
      { task_id: req.contract.task_id },
    );
    return execTracked(ctx.client, ctx.store, ctx.runId, execReq, ctx.sessionOpts);
  }
  return ctx.client.exec(execReq);
}
