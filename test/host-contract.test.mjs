import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HOST_EXIT,
  HOST_PERMISSIONS,
  HOST_TIMEOUT_ARG_RE,
  HOST_TIMEOUT_PARSE_RE,
  ROLE_EXEC_DEFAULTS,
  StubMcode,
  applyRoleDefaults,
  buildExecArgs,
  classifyHostExit,
  collectAssistantText,
  formatHostTimeout,
  parseStreamLine,
} from "../dist/mcode.js";
import {
  extractHostSessionId,
  extractMvsSessionId,
  isSynthesizedSessionToken,
  synthesizeSessionToken,
} from "../dist/session.js";
import {
  buildExecSnapshot,
  extractStructuredOutput,
  extractStructuredYield,
  parseWorkerYield,
  validateWorkerYield,
  yieldContractLine,
} from "../dist/yield.js";
import { formatTps, tpsFromExec, TPS_UNMEASURED } from "../dist/tps.js";
import { classifyExecResult } from "../dist/tool-repair.js";
import { explorerPrompt, tpsProbePrompt } from "../dist/prompts.js";
import { spawnSubagent } from "../dist/subagent.js";
import { runPlan } from "../dist/orchestrator.js";
import { RunStore } from "../dist/store.js";
import { copyHelloPkg, HELLO_PKG_FIXTURE } from "./helpers/hello-pkg.mjs";
import { yieldResult } from "./helpers/yield.mjs";

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), "omm-hc-"));
}

function timeoutArg(argv) {
  const idx = argv.indexOf("--timeout");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function schemaArg(argv) {
  const idx = argv.indexOf("--output-schema");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function maxStepsArg(argv) {
  const idx = argv.indexOf("--max-steps");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function permissionArg(argv) {
  const idx = argv.indexOf("--permission");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function loadFixture(name) {
  return readFileSync(path.resolve("test/fixtures", name), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.includes("_comment"));
}

test("formatHostTimeout emits a unit suffix; bare integers parse as milliseconds on 0.2.1", () => {
  assert.match("180", HOST_TIMEOUT_PARSE_RE);
  assert.doesNotMatch("180", HOST_TIMEOUT_ARG_RE);
  assert.equal(formatHostTimeout(180_000), "180s");
  assert.match(formatHostTimeout(180_000), HOST_TIMEOUT_ARG_RE);
  assert.notEqual(formatHostTimeout(180_000), "180");
  const argv = buildExecArgs(
    applyRoleDefaults({
      cwd: tmp(),
      prompt: "pong",
      role: "explorer",
      permission: "ask",
    }),
  );
  assert.equal(timeoutArg(argv), "180s");
});

test("default exec argv omits --output-schema; role max-steps and permission reach argv", () => {
  const prev = process.env.OMM_HOST_OUTPUT_SCHEMA;
  delete process.env.OMM_HOST_OUTPUT_SCHEMA;
  try {
    const explorer = applyRoleDefaults({
      cwd: tmp(),
      prompt: "pong",
      role: "explorer",
      permission: "ask",
    });
    const argv = buildExecArgs(explorer);
    assert.equal(schemaArg(argv), undefined);
    assert.equal(maxStepsArg(argv), String(ROLE_EXEC_DEFAULTS.explorer.maxSteps));
    assert.equal(permissionArg(argv), "ask");
    assert.equal(explorer.maxSteps, 20);
    assert.ok(explorer.maxSteps > 0);

    const planner = applyRoleDefaults({
      cwd: tmp(),
      prompt: "plan",
      role: "planner",
      permission: "ask",
    });
    assert.equal(maxStepsArg(buildExecArgs(planner)), "16");

    const builder = applyRoleDefaults({
      cwd: tmp(),
      prompt: "build",
      role: "builder",
      permission: "smart",
    });
    assert.equal(maxStepsArg(buildExecArgs(builder)), "48");
    assert.equal(permissionArg(buildExecArgs(builder)), "smart");
  } finally {
    if (prev === undefined) delete process.env.OMM_HOST_OUTPUT_SCHEMA;
    else process.env.OMM_HOST_OUTPUT_SCHEMA = prev;
  }

  assert.deepEqual(HOST_PERMISSIONS, ["ask", "smart", "full", "off"]);
  for (const permission of HOST_PERMISSIONS) {
    const argv = buildExecArgs({
      cwd: tmp(),
      prompt: "pong",
      role: "explorer",
      permission,
    });
    assert.equal(permissionArg(argv), permission);
  }
});

test("host exit 1 is crash / incomplete stream, not timeout", () => {
  assert.equal(HOST_EXIT.success, 0);
  assert.equal(HOST_EXIT.crash, 1);
  assert.equal(HOST_EXIT.invocation, 2);
  assert.equal(HOST_EXIT.config, 3);
  assert.equal(HOST_EXIT.runtime, 4);
  assert.equal(HOST_EXIT.blocked, 5);
  assert.equal(HOST_EXIT.timeout, 6);
  assert.equal(HOST_EXIT.limit, 7);
  assert.equal(HOST_EXIT.internal, 70);
  assert.equal(HOST_EXIT.cancelled, 130);
  assert.equal(classifyHostExit(1), "crash");
  assert.notEqual(classifyHostExit(1), "timeout");
  assert.equal(classifyHostExit(6), "timeout");
  assert.equal(
    classifyExecResult({ text: "partial {", events: [], exitCode: 1, rawLines: ["partial {"] }),
    "nonzero",
  );
  assert.equal(classifyExecResult({ text: "", events: [], exitCode: 6, rawLines: [] }), "timeout");
});

test("collectAssistantText ignores user-role example JSON so it cannot win a greedy match", () => {
  const example = { status: "ok", summary: "EXAMPLE_ONLY", findings: [], artifacts: [] };
  const events = [
    {
      raw: { type: "message", message: { role: "user", content: JSON.stringify(example) } },
      type: "message",
      role: "user",
      text: JSON.stringify(example),
    },
    { raw: { type: "delta", role: "assistant", content: '{"status":"ok","summary":"' }, type: "delta", role: "assistant" },
    {
      raw: { type: "delta", role: "assistant", content: 'stitched-pong","findings":[],"artifacts":[]}' },
      type: "delta",
      role: "assistant",
    },
  ];
  const text = collectAssistantText(events);
  assert.equal(text, '{"status":"ok","summary":"stitched-pong","findings":[],"artifacts":[]}');
  assert.doesNotMatch(text, /EXAMPLE_ONLY/);
  const parsed = parseWorkerYield({ text, events, exitCode: 0, rawLines: [] });
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.summary, "stitched-pong");
});

test("explorer prompt treats greenfield as ok notes, not blocked", () => {
  const prompt = explorerPrompt("add hello()");
  assert.match(prompt, /Greenfield/);
  assert.match(prompt, /status ok/);
  assert.match(prompt, /blocked is only for missing permission/);
});

test("stitch 0.2.1 delta.content into a parseable yield and ignore user example JSON", () => {
  const lines = loadFixture("stream-json-mcode-0.2.1-delta-yield.jsonl");
  const events = lines.map((line) => parseStreamLine(line));
  const text = collectAssistantText(events);
  assert.match(text, /stitched-pong/);
  assert.doesNotMatch(text, /EXAMPLE_ONLY/);
  assert.equal(text.includes("\n"), false, "delta chunks must be concatenated without inserted newlines");

  const result = {
    text,
    events,
    exitCode: 0,
    rawLines: lines,
    structuredOutput: extractStructuredOutput(events),
  };
  const parsed = parseWorkerYield(result);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.summary, "stitched-pong");
  assert.deepEqual(extractStructuredYield(result).summary, "stitched-pong");

  const userExample = yieldContractLine();
  const poisoned = {
    text: `${userExample}\n${text}`,
    events,
    exitCode: 0,
    rawLines: lines,
  };
  const fromPoisoned = parseWorkerYield(poisoned);
  assert.equal(fromPoisoned.ok, true, fromPoisoned.ok ? "" : fromPoisoned.error);
  assert.equal(fromPoisoned.data.summary, "stitched-pong");
});

test("extractHostSessionId reads mvs_ from cursor and YOUR SESSION ID reminder", () => {
  const lines = loadFixture("stream-json-mcode-0.2.1-delta-yield.jsonl");
  const events = lines.map((line) => parseStreamLine(line));
  const result = { text: collectAssistantText(events), events, exitCode: 0, rawLines: lines };
  assert.equal(extractHostSessionId(result), "mvs_e04430ddcafe");
  assert.equal(extractMvsSessionId("sse1:session%3Amvs_0139ac61beef"), "mvs_0139ac61beef");
  assert.equal(extractMvsSessionId("YOUR SESSION ID: mvs_e04430ddcafe"), "mvs_e04430ddcafe");
  assert.equal(isSynthesizedSessionToken(synthesizeSessionToken("run_ABC")), true);
  assert.equal(isSynthesizedSessionToken("mvs_e04430ddcafe"), false);
});

test("yield reminder reuses the extracted mvs_ session (no omm_run_ token)", async () => {
  const requests = [];
  const store = new RunStore(tmp());
  const run = store.create("reminder session");
  const client = new StubMcode(async (req) => {
    requests.push({ session: req.session, prompt: req.prompt, maxSteps: req.maxSteps, timeoutMs: req.timeoutMs });
    if (requests.length === 1) {
      return {
        text: "partial {",
        events: [
          { raw: { type: "delta", role: "assistant", content: "partial {" }, type: "delta", role: "assistant", text: "partial {" },
          { raw: { type: "message", cursor: "sse1:session%3Amvs_e04430ddcafe", message: { role: "assistant" } }, type: "message", role: "assistant" },
        ],
        exitCode: 1,
        rawLines: [],
      };
    }
    return yieldResult("recovered after reminder");
  });
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "ask",
      cwd: store.workspace,
      prompt: explorerPrompt("look around"),
    },
    { client, store, runId: run.run_id },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].session, undefined);
  assert.equal(requests[1].session, "mvs_e04430ddcafe");
  assert.match(requests[1].prompt, /schemaMode=strict/);
  assert.doesNotMatch(requests[1].session || "", /^omm_/);
  assert.equal(store.load(run.run_id).host_session_id, "mvs_e04430ddcafe");
  assert.equal(result.yield.status, "ok");
  assert.equal(requests[0].maxSteps, ROLE_EXEC_DEFAULTS.explorer.maxSteps);
  assert.equal(requests[0].timeoutMs, ROLE_EXEC_DEFAULTS.explorer.timeoutMs);
});

test("TPS reports unmeasured when host omits message.usage (no fake tok/s)", () => {
  const report = tpsFromExec(
    { text: "pong", events: [], exitCode: 0, rawLines: [], wall_ms: 120 },
    tpsProbePrompt(),
    { stub: false, allowStub: false },
  );
  assert.equal(report.unmeasured, true);
  assert.equal(report.output_tps, null);
  assert.equal(report.wall_tps, null);
  assert.equal(report.input_tokens, null);
  assert.equal(report.output_tokens, null);
  assert.equal(report.reason, TPS_UNMEASURED);
  const text = formatTps(report);
  assert.match(text, /unmeasured/);
  assert.doesNotMatch(text, /output_tps: [0-9]/);
});

test("hello-pkg fixture exists and plan is evaluated against it, not an empty dir", async () => {
  assert.ok(existsSync(path.join(HELLO_PKG_FIXTURE, "package.json")));
  assert.ok(existsSync(path.join(HELLO_PKG_FIXTURE, "src/index.js")));
  assert.ok(existsSync(path.join(HELLO_PKG_FIXTURE, "test/hello.test.js")));
  const src = readFileSync(path.join(HELLO_PKG_FIXTURE, "src/index.js"), "utf8");
  assert.doesNotMatch(src, /export function hello/);
  const spec = readFileSync(path.join(HELLO_PKG_FIXTURE, "test/hello.test.js"), "utf8");
  assert.match(spec, /hello\(\)/);
  assert.match(spec, /["']hello["']/);

  const workspace = copyHelloPkg();
  assert.ok(existsSync(path.join(workspace, "src/index.js")));
  assert.equal(existsSync(path.join(workspace, ".minimax", "runs")), false);

  const run = await runPlan({
    workspace,
    goal: "export hello() that returns hello and prove the fixture test passes",
    mcode: new StubMcode(async (req) => {
      if (req.role === "explorer") {
        return {
          text: JSON.stringify({
            status: "ok",
            summary: "hello-pkg has src but hello() is missing",
            findings: [
              {
                severity: "note",
                title: "no hello()",
                detail: "src/index.js exports placeholder; test/hello.test.js expects hello()",
                evidence: ["src/index.js", "test/hello.test.js"],
              },
            ],
            artifacts: ["src/index.js", "test/hello.test.js"],
          }),
          events: [],
          exitCode: 0,
          rawLines: [],
        };
      }
      return {
        text: JSON.stringify({
          status: "ok",
          summary: "add hello() then npm test",
          findings: [],
          artifacts: ["plan.md", "tasks.json"],
        }),
        structuredOutput: {
          data: {
            tasks: [{ id: "T1", title: "export hello()", role: "builder", depends_on: [] }],
            acceptance: [{ id: "A1", criterion: "npm test", kind: "test", command: "npm test" }],
          },
        },
        events: [
          {
            raw: {
              type: "result",
              answer: {
                status: "ok",
                summary: "add hello() then npm test",
                findings: [],
                artifacts: ["plan.md", "tasks.json"],
              },
            },
            type: "result",
          },
        ],
        exitCode: 0,
        rawLines: [],
      };
    }),
  });
  assert.equal(run.phase, "PLAN_REVIEW");
  const store = new RunStore(workspace);
  const discover = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover.md"));
  assert.ok(discover);
  assert.match(store.readArtifact(run.run_id, discover.path), /hello-pkg/);
  assert.ok(store.readArtifact(run.run_id, "exec-snapshot-discover.json"));
});

test("schema-valid blocked yield is valid; DISCOVER stops without calling it invalid", async () => {
  const workspace = copyHelloPkg();
  const blocked = {
    status: "blocked",
    summary: "read tool unavailable",
    findings: [
      {
        severity: "blocker",
        title: "missing tools",
        detail: "host did not expose read",
        evidence: [],
      },
    ],
    artifacts: [],
  };
  assert.equal(validateWorkerYield(blocked).ok, true);
  const run = await runPlan({
    workspace,
    goal: "blocked is not invalid",
    mcode: new StubMcode(async () => ({
      text: JSON.stringify(blocked),
      events: [{ raw: { type: "exec.result", answer: blocked }, type: "exec.result" }],
      exitCode: 5,
      rawLines: [],
    })),
  });
  assert.equal(run.phase, "DISCOVER");
  assert.equal(run.status, "blocked");
  const store = new RunStore(workspace);
  const yieldFile = JSON.parse(store.readArtifact(run.run_id, "yield-discover.json"));
  assert.equal(yieldFile.status, "blocked");
  assert.notEqual(yieldFile.summary, "invalid worker yield");
  assert.ok(
    store.loadEvents(run.run_id).some((event) => event.type === "run_rejected" && event.payload.reason === "blocked_worker_yield"),
  );
  assert.ok(!store.loadEvents(run.run_id).some((event) => event.payload?.reason === "failed_worker_yield"));
});

test("failed yield snapshot keeps assistant text so discover.md is not only invalid worker yield", async () => {
  const workspace = copyHelloPkg();
  const prose = '{"status":"ok","summary":"almost a yield","findings":[]}';
  const run = await runPlan({
    workspace,
    goal: "keep assistant text",
    mcode: new StubMcode(async () => ({
      text: prose,
      events: [
        { raw: { type: "delta", role: "assistant", content: prose }, type: "delta", role: "assistant", text: prose },
      ],
      exitCode: 1,
      rawLines: [],
    })),
  });
  assert.equal(run.phase, "DISCOVER");
  assert.equal(run.status, "rejected");
  const store = new RunStore(workspace);
  const discover = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover.md"));
  const body = store.readArtifact(run.run_id, discover.path);
  assert.match(body, /almost a yield/);
  const snapshot = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover.json"));
  assert.match(snapshot.assistant_text, /almost a yield/);
  assert.equal(snapshot.exit_code, 1);
  const failed = JSON.parse(store.readArtifact(run.run_id, "yield-discover.json"));
  assert.equal(failed.status, "failed");
  assert.match(failed.findings[0].detail, /assistant_text/);
});

test("buildExecSnapshot is typed evidence, not raw JSONL", () => {
  const yieldData = { status: "ok", summary: "pong", findings: [], artifacts: [] };
  const snapshot = buildExecSnapshot(
    {
      text: JSON.stringify(yieldData),
      events: [{ raw: { type: "exec.result", answer: yieldData }, type: "exec.result" }],
      exitCode: 0,
      rawLines: ['{"type":"delta","content":"do-not-persist-raw"}'],
      usage: { output_tokens: 4 },
    },
    { hashes: { "src/index.js": "abc" }, yieldStatus: "ok" },
  );
  assert.equal(snapshot.assistant_text, JSON.stringify(yieldData));
  assert.deepEqual(snapshot.exec_result_answer, yieldData);
  assert.deepEqual(snapshot.file_hashes, { "src/index.js": "abc" });
  assert.equal(snapshot.exit_code, 0);
  assert.equal(snapshot.yield_status, "ok");
  assert.doesNotMatch(JSON.stringify(snapshot), /do-not-persist-raw/);
});
