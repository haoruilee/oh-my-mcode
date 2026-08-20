#!/usr/bin/env node
/**
 * Dependency-free stdio JSON-RPC MCP server (hello-mcode-mcp shape).
 * Tools spawn the oh-my-mcode CLI / run-store so there is one implementation.
 * Workspace = OMM_WORKSPACE or cwd. Do not set PLUGIN_ROOT / PLUGIN_DATA.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/oh-my-mcode.mjs");
const STORE = path.join(ROOT, "scripts/run-store.mjs");

function workspaceOf() {
  return process.env.OMM_WORKSPACE || process.cwd();
}

function runNode(script, args, workspace) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: workspace,
    env: { ...process.env, OMM_WORKSPACE: workspace },
  });
}

function parseStdout(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { raw: text || "" };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
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

function callTool(name, args = {}) {
  const workspace = workspaceOf();
  if (name === "omm_run_create") {
    const goal = typeof args.goal === "string" ? args.goal.trim() : "";
    if (!goal) return toolError("omm_run_create requires goal");
    const result = runNode(STORE, ["create", "--workspace", workspace, "--goal", goal], workspace);
    if ((result.status ?? 1) !== 0) return toolError(result.stderr || result.stdout || "create failed");
    return toolResult(parseStdout(result.stdout));
  }
  if (name === "omm_run_show") {
    const cmd = ["show", "--workspace", workspace];
    if (args.run_id) cmd.push("--run-id", String(args.run_id));
    else cmd.push("--latest");
    const result = runNode(STORE, cmd, workspace);
    if ((result.status ?? 1) !== 0) return toolError(result.stderr || result.stdout || "show failed");
    return toolResult(parseStdout(result.stdout));
  }
  if (name === "omm_run_list") {
    const result = runNode(STORE, ["list", "--workspace", workspace], workspace);
    if ((result.status ?? 1) !== 0) return toolError(result.stderr || result.stdout || "list failed");
    return toolResult(parseStdout(result.stdout));
  }
  if (name === "omm_status") {
    const cmd = ["status", "--json", "--workspace", workspace];
    if (args.run_id) cmd.push(String(args.run_id));
    const result = runNode(CLI, cmd, workspace);
    if ((result.status ?? 1) !== 0) return toolError(result.stderr || result.stdout || "status failed");
    return toolResult(parseStdout(result.stdout));
  }
  if (name === "omm_verify") {
    const cmd = ["verify", "--json", "--no-llm-verify", "--workspace", workspace];
    if (args.run_id) cmd.push(String(args.run_id));
    const result = runNode(CLI, cmd, workspace);
    if (!existsSync(CLI)) return toolError("oh-my-mcode CLI missing");
    if ((result.status ?? 1) !== 0 && (result.status ?? 1) !== 2) {
      return toolError(result.stderr || result.stdout || "verify failed");
    }
    return toolResult(parseStdout(result.stdout));
  }
  if (name === "omm_inspect") {
    const topic = typeof args.topic === "string" ? args.topic : "";
    if (!topic) return toolError("omm_inspect requires topic");
    const cmd = ["inspect", topic, "--json", "--workspace", workspace];
    if (args.run_id) cmd.push("--run-id", String(args.run_id));
    const result = runNode(CLI, cmd, workspace);
    if ((result.status ?? 1) !== 0) return toolError(result.stderr || result.stdout || "inspect failed");
    return toolResult(parseStdout(result.stdout));
  }
  return { error: { code: -32601, message: `Unknown tool: ${name}` } };
}

function handle(message) {
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
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    return callTool(name, args);
  }
  return { error: { code: -32601, message: `Method not found: ${String(message.method)}` } };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const queue = [];
let busy = false;

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const message = queue.shift();
    const response = handle(message);
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
