#!/usr/bin/env node
/**
 * Dependency-free stdio JSON-RPC MCP server (hello-mcode-mcp shape).
 * Tools call the TypeScript harness (same run store as the CLI).
 * Workspace = OMM_WORKSPACE or cwd. Do not set PLUGIN_ROOT / PLUGIN_DATA.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = path.join(ROOT, "dist/harness.js");
const INSPECT = path.join(ROOT, "dist/inspect.js");

function workspaceOf() {
  return process.env.OMM_WORKSPACE || process.cwd();
}

function toolResult(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { result: { content: [{ type: "text", text }] } };
}

function toolError(message) {
  return { result: { content: [{ type: "text", text: message }], isError: true } };
}

const TOOLS = [
  {
    name: "omm_run_create",
    description: "Create an Oh My MiniMax Code run for a goal. Writes <workspace>/.minimax/runs/<id>/.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["goal"],
      properties: { goal: { type: "string", description: "User goal for the run" } },
    },
  },
  {
    name: "omm_run_show",
    description: "Show one run (latest if run_id omitted).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run_id: { type: "string" } },
    },
  },
  {
    name: "omm_run_list",
    description: "List runs in the workspace.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "omm_status",
    description: "Same HUD text as `oh-my-mcode status`.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run_id: { type: "string" } },
    },
  },
  {
    name: "omm_verify",
    description: "Deterministic verify only (no builder). Same as `oh-my-mcode verify --no-llm-verify`.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run_id: { type: "string" } },
    },
  },
  {
    name: "omm_interview",
    description: "Interview intake. Writes interview.md + interview.json and stops at PLAN_REVIEW. No builder.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["goal"],
      properties: {
        goal: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        answers: {
          type: "object",
          additionalProperties: false,
          properties: {
            goal: { type: "string" },
            constraints: { type: "array", items: { type: "string" } },
            acceptance: { type: "array", items: { type: "string" } },
            out_of_scope: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
  {
    name: "omm_inspect",
    description: "Inspect tools|skills|agents|context|runs|model-policy.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["topic"],
      properties: {
        topic: { type: "string", enum: ["tools", "skills", "agents", "context", "runs", "model-policy"] },
        run_id: { type: "string" },
      },
    },
  },
];

async function loadHarness(workspace) {
  if (!existsSync(HARNESS)) {
    throw new Error("dist/harness.js missing; run npm install / npm run build in the plugin root");
  }
  const mod = await import(pathToFileURL(HARNESS).href);
  return new mod.Harness(workspace);
}

async function callTool(name, args = {}) {
  const workspace = workspaceOf();
  try {
    if (name === "omm_inspect") {
      const topic = typeof args.topic === "string" ? args.topic : "";
      if (!topic) return toolError("omm_inspect requires topic");
      if (!existsSync(INSPECT)) return toolError("dist/inspect.js missing; run npm run build");
      const inspect = await import(pathToFileURL(INSPECT).href);
      const result = inspect.runInspect({ topic, workspace, runId: args.run_id ? String(args.run_id) : undefined });
      return toolResult(result);
    }
    const harness = await loadHarness(workspace);
    if (name === "omm_run_create") {
      const goal = typeof args.goal === "string" ? args.goal.trim() : "";
      if (!goal) return toolError("omm_run_create requires goal");
      const result = await harness.submit({ op: "create", goal });
      return toolResult(result.run);
    }
    if (name === "omm_run_show") {
      const result = await harness.submit({ op: "show", runId: args.run_id ? String(args.run_id) : undefined });
      return toolResult(result.run);
    }
    if (name === "omm_run_list") {
      const result = await harness.submit({ op: "list" });
      return toolResult(result.runs);
    }
    if (name === "omm_status") {
      const result = await harness.submit({ op: "status", runId: args.run_id ? String(args.run_id) : undefined });
      return toolResult(result.hud || result);
    }
    if (name === "omm_verify") {
      const result = await harness.submit({
        op: "verify",
        runId: args.run_id ? String(args.run_id) : undefined,
        llmVerify: false,
      });
      return toolResult(result.run);
    }
    if (name === "omm_interview") {
      const goal = typeof args.goal === "string" ? args.goal.trim() : "";
      if (!goal) return toolError("omm_interview requires goal");
      const result = await harness.submit({
        op: "interview",
        goal,
        answers: args.answers,
        constraints: Array.isArray(args.constraints) ? args.constraints.map(String) : undefined,
        interactive: false,
      });
      return toolResult({ run: result.run, interview: result.interview });
    }
    return { error: { code: -32601, message: `Unknown tool: ${name}` } };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

function handleInit(message) {
  if (message.method === "initialize") {
    return {
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "oh-my-mcode", version: "0.1.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return { result: { tools: TOOLS } };
  }
  return null;
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const queue = [];
let busy = false;

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const message = queue.shift();
    const init = handleInit(message);
    const response = init || (message.method === "tools/call"
      ? await callTool(message.params?.name, message.params?.arguments || {})
      : { error: { code: -32601, message: `Method not found: ${String(message.method)}` } });
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...response })}\n`);
  }
  busy = false;
}

input.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  queue.push(message);
  drain();
});
