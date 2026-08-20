import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runMax } from "../dist/orchestrator.js";
import { runReview } from "../dist/review.js";
import { StubMcode } from "../dist/mcode.js";
import { RunStore } from "../dist/store.js";
import { runInspect } from "../dist/inspect.js";

const SESSION_ID = "host-sess-abc";

function project(testScript = "node -e \"process.exit(0)\"") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "omm-sess-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { test: testScript } }),
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/auth.js"), "export const ok = true;\n");
  return dir;
}

function plannerText() {
  return `\`\`\`json\n${JSON.stringify({
    tasks: [{ id: "T1", title: "one change", role: "builder", depends_on: [] }],
    acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
  })}\n\`\`\``;
}

function stubRecording(requests, { sessionId = SESSION_ID, includeSession = true } = {}) {
  return new StubMcode(async (req) => {
    requests.push(req);
    const text = req.role === "planner" ? plannerText() : `${req.role} ok`;
    const raw = includeSession
      ? { type: "result", session_id: sessionId, text }
      : { type: "assistant", text };
    return {
      text,
      events: [{ raw, type: raw.type, text }],
      exitCode: 0,
      rawLines: [JSON.stringify(raw)],
    };
  });
}

test("runMax reuses the host session id from the first stream-json response", async () => {
  const workspace = project();
  const requests = [];
  const run = await runMax({
    workspace,
    goal: "session continuity",
    mcode: stubRecording(requests),
    llmVerify: false,
  });
  assert.ok(requests.length >= 2, `expected ≥2 execs, got ${requests.length}`);
  assert.equal(requests[0].session, undefined);
  for (const req of requests.slice(1)) {
    assert.equal(req.session, SESSION_ID);
  }
  assert.equal(run.host_session_id, SESSION_ID);
  const store = new RunStore(workspace);
  assert.ok(store.loadEvents(run.run_id).some((event) => event.type === "host_session_bound"));
  const context = runInspect({ topic: "context", workspace, runId: run.run_id });
  assert.equal(context.data.host_session_id, SESSION_ID);
});

test("--no-session keeps session undefined on every exec", async () => {
  const workspace = project();
  const requests = [];
  const run = await runMax({
    workspace,
    goal: "cold starts only",
    mcode: stubRecording(requests),
    llmVerify: false,
    noSession: true,
  });
  assert.ok(requests.length >= 2);
  for (const req of requests) {
    assert.equal(req.session, undefined);
  }
  assert.equal(run.host_session_id, undefined);
  const store = new RunStore(workspace);
  assert.ok(!store.loadEvents(run.run_id).some((event) => event.type === "host_session_bound"));
});

test("planner exec request includes outputSchema", async () => {
  const workspace = project();
  const requests = [];
  await runMax({
    workspace,
    goal: "planner schema",
    mcode: stubRecording(requests),
    llmVerify: false,
    noSession: true,
  });
  const planner = requests.find((req) => req.role === "planner");
  assert.ok(planner, "planner exec missing");
  assert.ok(planner.outputSchema, "planner outputSchema not set");
  assert.match(planner.outputSchema, /planner-output\.schema\.json$/);
});

test("verifier LLM and review attach evidence files when they exist", async () => {
  const workspace = project();
  const requests = [];
  await runMax({
    workspace,
    goal: "attach evidence",
    mcode: stubRecording(requests),
    llmVerify: true,
    noSession: true,
  });
  const verifier = requests.find((req) => req.role === "verifier");
  assert.ok(verifier, "verifier exec missing");
  assert.ok(Array.isArray(verifier.files) && verifier.files.length > 0, "verifier files[] empty");
  assert.ok(
    verifier.files.some((file) => /evidence|\.log|summary\.md/.test(file)),
    `verifier files did not include evidence: ${verifier.files}`,
  );

  const reviewReqs = [];
  const store = new RunStore(workspace);
  const runId = store.latestId();
  const result = await runReview({
    workspace,
    runId,
    mcode: stubRecording(reviewReqs),
    noSession: true,
  });
  assert.equal(result.review.can_accept, false);
  assert.ok(reviewReqs[0]?.files?.length > 0, "review files[] empty");
  assert.ok(reviewReqs[0].files.some((file) => existsSync(file)));
});

function mcpClient(env = {}) {
  const child = spawn(process.execPath, [path.resolve("mcp/server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const waiters = [];
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const waiter = waiters.shift();
    if (waiter) waiter(JSON.parse(line));
  });
  async function send(id, method, params) {
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP timeout waiting for ${method}`)), 20_000);
      waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return reply;
  }
  function close() {
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child.kill();
    rl.close();
  }
  return { send, close, child };
}

test("MCP stdio initialize + tools/list + omm_run_create + omm_status", async () => {
  const workspace = project();
  const client = mcpClient({ OMM_WORKSPACE: workspace });
  try {
    const init = await client.send(1, "initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.id, 1);
    assert.equal(init.result.serverInfo.name, "oh-my-mcode");
    assert.ok(init.result.capabilities.tools);

    const listed = await client.send(2, "tools/list");
    const names = (listed.result.tools || []).map((tool) => tool.name);
    for (const name of [
      "omm_run_create",
      "omm_run_show",
      "omm_run_list",
      "omm_status",
      "omm_verify",
      "omm_inspect",
    ]) {
      assert.ok(names.includes(name), `missing MCP tool ${name}`);
    }

    const created = await client.send(3, "tools/call", {
      name: "omm_run_create",
      arguments: { goal: "mcp create proof" },
    });
    assert.ok(created.result?.content?.[0]?.text, "omm_run_create returned no text");
    const createdBody = JSON.parse(created.result.content[0].text);
    assert.match(createdBody.run_id, /^run_/);
    assert.ok(existsSync(path.join(workspace, ".minimax", "runs", createdBody.run_id, "run.json")));

    const status = await client.send(4, "tools/call", {
      name: "omm_status",
      arguments: { run_id: createdBody.run_id },
    });
    const statusText = status.result?.content?.[0]?.text || "";
    assert.match(statusText, /Run: run_/);
    assert.match(statusText, /mcp create proof/);
  } finally {
    client.close();
  }
});
