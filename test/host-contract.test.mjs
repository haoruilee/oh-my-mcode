import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HOST_EXIT,
  HOST_NATIVE_CRASH_RE,
  HOST_PERMISSIONS,
  HOST_SESSION_CONTINUE_EXCLUSIVE,
  HOST_TIMEOUT_ARG_RE,
  HOST_TIMEOUT_PARSE_RE,
  ProcessMcode,
  ROLE_EXEC_DEFAULTS,
  StubMcode,
  applyRoleDefaults,
  buildExecArgs,
  classifyHostExit,
  collectAssistantText,
  finalizeHostExit,
  formatHostTimeout,
  isHostNativeCrash,
  isLegalHostSessionArgv,
  parseStreamLine,
  sessionXorContinue,
} from "../dist/mcode.js";
import {
  extractHostSessionId,
  isSynthesizedSessionToken,
  synthesizeSessionToken,
} from "../dist/session.js";
import { bindableHostSessionId } from "../dist/host-events.js";
import {
  SNAPSHOT_STDERR_MAX,
  TINY_YIELD_FINDINGS_MAX,
  TINY_YIELD_SUMMARY_MAX,
  buildExecSnapshot,
  coerceWorkerYield,
  crashRetryPrompt,
  extractCompleteYieldFromText,
  extractStructuredOutput,
  extractStructuredYield,
  parseWorkerYield,
  validateWorkerYield,
  yieldContractLine,
  yieldReminder,
} from "../dist/yield.js";
import { formatTps, tpsFromExec, TPS_UNMEASURED } from "../dist/tps.js";
import { classifyExecResult } from "../dist/tool-repair.js";
import { explorerPrompt, tpsProbePrompt } from "../dist/prompts.js";
import {
  spawnSubagent,
  yieldCrashRetryRequest,
  yieldReminderRequest,
  YIELD_CRASH_RETRY_MAX,
  YIELD_CRASH_RETRY_MAX_STEPS,
  YIELD_CRASH_RETRY_PERMISSION,
  YIELD_REMINDER_MAX_STEPS,
  YIELD_REMINDER_PERMISSION,
  YIELD_SCHEMA_REMINDER_MAX,
} from "../dist/subagent.js";
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
  assert.equal(classifyHostExit(2), "invocation");
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

test("explorer prompt forbids post-map tools; last message is only yield JSON", () => {
  const prompt = explorerPrompt("add hello()");
  assert.match(prompt, /LAST message is ONLY the tiny yield JSON/i);
  assert.match(prompt, /No more tools/);
  assert.match(prompt, /Do not hash files unless the yield already includes file_hashes/);
  assert.match(prompt, /package\.json/);
  assert.match(prompt, /src\/index\.js/);
  assert.match(prompt, /test\/hello\.test\.js/);
  assert.doesNotMatch(prompt, /package\.json[\s\S]*export function/);
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

test("extractHostSessionId binds mvs_ from cursor / exec.result, not YOUR SESSION ID prose", () => {
  const lines = loadFixture("stream-json-mcode-0.2.1-delta-yield.jsonl");
  const events = lines.map((line) => parseStreamLine(line));
  const result = { text: collectAssistantText(events), events, exitCode: 0, rawLines: lines };
  assert.equal(extractHostSessionId(result), "mvs_e04430ddcafe");
  assert.equal(bindableHostSessionId("sse1:session%3Amvs_0139ac61beef"), "mvs_0139ac61beef");
  assert.equal(bindableHostSessionId("YOUR SESSION ID: mvs_e04430ddcafe"), undefined);
  assert.equal(bindableHostSessionId("mvs_e04430ddcafe"), "mvs_e04430ddcafe");
  assert.equal(isSynthesizedSessionToken(synthesizeSessionToken("run_ABC")), true);
  assert.equal(isSynthesizedSessionToken("mvs_e04430ddcafe"), false);

  const proseOnly = {
    text: "YOUR SESSION ID: mvs_attacker",
    events: [
      {
        raw: { type: "delta", role: "assistant", content: "YOUR SESSION ID: mvs_attacker" },
        type: "delta",
        role: "assistant",
        text: "YOUR SESSION ID: mvs_attacker",
      },
    ],
    exitCode: 0,
    rawLines: [],
  };
  assert.equal(extractHostSessionId(proseOnly), undefined);

  const structured = {
    text: "YOUR SESSION ID: mvs_attacker",
    events: [{ raw: { type: "exec.result", session: "mvs_real", status: "succeeded" }, type: "exec.result" }],
    exitCode: 0,
    rawLines: [],
  };
  assert.equal(extractHostSessionId(structured), "mvs_real");
});

test("yield reminder reuses the extracted mvs_ session (no omm_run_ token)", async () => {
  const requests = [];
  const store = new RunStore(tmp());
  const run = store.create("reminder session");
  const firstPrompt = explorerPrompt("look around");
  const client = new StubMcode(async (req) => {
    requests.push(req);
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
      prompt: firstPrompt,
    },
    { client, store, runId: run.run_id },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].session, undefined);
  assert.notEqual(requests[0].continue, true);
  assert.equal(requests[0].permission, "ask");
  assert.equal(requests[1].session, "mvs_e04430ddcafe");
  assert.notEqual(requests[1].continue, true);
  assert.equal(requests[1].maxSteps, YIELD_REMINDER_MAX_STEPS);
  assert.equal(requests[1].permission, YIELD_REMINDER_PERMISSION);
  assert.match(requests[1].prompt, /schemaMode=strict/);
  assert.match(requests[1].prompt, /Do not use tools/);
  assert.match(requests[1].prompt, /only the tiny yield JSON object/);
  assert.doesNotMatch(requests[1].prompt, /Allowed: read\/search/);
  assert.doesNotMatch(requests[1].prompt, /look around/);
  assert.match(requests[1].prompt, /^Yield failed schemaMode=strict:/);
  assert.match(yieldReminder("missing yield"), /Do not use tools/);
  assert.match(yieldReminder("missing yield"), /only the tiny yield JSON object/);
  assert.doesNotMatch(yieldReminder("missing yield"), /Allowed: read\/search/);
  assert.doesNotMatch(requests[1].session || "", /^omm_/);
  assert.equal(store.load(run.run_id).host_session_id, "mvs_e04430ddcafe");
  assert.equal(result.yield.status, "ok");
  assert.equal(requests[0].maxSteps, ROLE_EXEC_DEFAULTS.explorer.maxSteps);
  assert.ok(requests[0].maxSteps > YIELD_REMINDER_MAX_STEPS);
  assert.equal(requests[0].timeoutMs, ROLE_EXEC_DEFAULTS.explorer.timeoutMs);

  const reminderArgv = buildExecArgs(requests[1]);
  assert.equal(isLegalHostSessionArgv(reminderArgv), true);
  assert.equal(reminderArgv.includes("--continue"), false);
  assert.equal(reminderArgv[reminderArgv.indexOf("--session") + 1], "mvs_e04430ddcafe");
  assert.equal(maxStepsArg(reminderArgv), String(YIELD_REMINDER_MAX_STEPS));
  assert.equal(permissionArg(reminderArgv), YIELD_REMINDER_PERMISSION);
  assert.equal(schemaArg(reminderArgv), undefined);
});

test("reminder argv is a legal 0.2.1 combination: session XOR continue, not both", () => {
  const firstWithSession = {
    text: "partial {",
    events: [
      {
        raw: { type: "message", cursor: "sse1:session%3Amvs_fa1108f7161b4c189d22ce2f9508e959", message: { role: "assistant" } },
        type: "message",
        role: "assistant",
      },
    ],
    exitCode: 1,
    rawLines: [],
  };
  const firstWithoutSession = { text: "partial {", events: [], exitCode: 1, rawLines: [] };
  const base = {
    role: "explorer",
    contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
    permission: "smart",
    cwd: tmp(),
    prompt: explorerPrompt("add hello()"),
    maxSteps: ROLE_EXEC_DEFAULTS.explorer.maxSteps,
  };

  const withSession = yieldReminderRequest(base, firstWithSession);
  assert.equal(withSession.session, "mvs_fa1108f7161b4c189d22ce2f9508e959");
  assert.notEqual(withSession.continue, true);
  const sessionArgv = buildExecArgs(
    applyRoleDefaults({
      cwd: base.cwd,
      prompt: yieldReminder("missing yield"),
      role: "explorer",
      permission: withSession.permission,
      session: withSession.session,
      continue: withSession.continue,
      maxSteps: withSession.maxSteps,
    }),
  );
  assert.equal(isLegalHostSessionArgv(sessionArgv), true);
  assert.ok(sessionArgv.includes("--session"));
  assert.equal(sessionArgv.includes("--continue"), false);
  assert.equal(maxStepsArg(sessionArgv), "1");
  assert.equal(permissionArg(sessionArgv), "off");
  assert.equal(schemaArg(sessionArgv), undefined);

  const noSession = yieldReminderRequest(base, firstWithoutSession);
  assert.equal(noSession.session, undefined);
  assert.equal(noSession.continue, true);
  const continueArgv = buildExecArgs(
    applyRoleDefaults({
      cwd: base.cwd,
      prompt: yieldReminder("missing yield"),
      role: "explorer",
      permission: noSession.permission,
      session: noSession.session,
      continue: noSession.continue,
      maxSteps: noSession.maxSteps,
    }),
  );
  assert.equal(isLegalHostSessionArgv(continueArgv), true);
  assert.equal(continueArgv.includes("--session"), false);
  assert.ok(continueArgv.includes("--continue"));

  const both = sessionXorContinue({ session: "mvs_abc", continue: true });
  assert.equal(both.session, "mvs_abc");
  assert.equal(both.continue, undefined);
  const bothArgv = buildExecArgs({
    cwd: base.cwd,
    prompt: yieldReminder("missing yield"),
    role: "explorer",
    permission: "off",
    session: "mvs_abc",
    continue: true,
    maxSteps: 1,
  });
  assert.equal(isLegalHostSessionArgv(bothArgv), true);
  assert.equal(bothArgv.includes("--continue"), false);
  assert.match(HOST_SESSION_CONTINUE_EXCLUSIVE, /mutually exclusive/);
});

test("stitched 0.2.1 stream ending on toolUse is not a yield; reminder text-only JSON is", async () => {
  const firstLines = loadFixture("stream-json-mcode-0.2.1-tooluse-end.jsonl");
  const reminderLines = loadFixture("stream-json-mcode-0.2.1-reminder-yield.jsonl");
  const firstEvents = firstLines.map((line) => parseStreamLine(line));
  const reminderEvents = reminderLines.map((line) => parseStreamLine(line));
  const first = {
    text: collectAssistantText(firstEvents),
    events: firstEvents,
    exitCode: 1,
    rawLines: firstLines,
    structuredOutput: extractStructuredOutput(firstEvents),
  };
  const reminder = {
    text: collectAssistantText(reminderEvents),
    events: reminderEvents,
    exitCode: 0,
    rawLines: reminderLines,
    structuredOutput: extractStructuredOutput(reminderEvents),
  };

  assert.match(first.text, /placeholder/);
  assert.match(first.text, /hello\(\)/);
  assert.equal(classifyHostExit(first.exitCode), "crash");
  assert.notEqual(classifyHostExit(first.exitCode), "timeout");
  const fromProse = parseWorkerYield(first);
  assert.equal(fromProse.ok, false, "must not invent a WorkerYield from explorer prose");
  assert.equal(extractStructuredYield(first), undefined);

  const fromReminder = parseWorkerYield(reminder);
  assert.equal(fromReminder.ok, true, fromReminder.ok ? "" : fromReminder.error);
  assert.equal(fromReminder.data.status, "ok");
  assert.match(fromReminder.data.summary, /hello\(\) missing/);
  assert.equal(fromReminder.data.findings[0].severity, "note");
  assert.ok(!reminderEvents.some((event) => (event.type || "").toLowerCase().includes("tool")));

  const shaped = yieldReminderRequest(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "smart",
      cwd: tmp(),
      prompt: explorerPrompt("add hello()"),
      maxSteps: ROLE_EXEC_DEFAULTS.explorer.maxSteps,
    },
    first,
  );
  assert.equal(shaped.session, "mvs_c26375a905a64bbc8b25ae63a635c812");
  assert.notEqual(shaped.continue, true);
  assert.equal(shaped.maxSteps, YIELD_REMINDER_MAX_STEPS);
  assert.equal(shaped.permission, YIELD_REMINDER_PERMISSION);
  assert.notEqual(shaped.maxSteps, ROLE_EXEC_DEFAULTS.explorer.maxSteps);

  const requests = [];
  const store = new RunStore(tmp());
  const run = store.create("tooluse then yield");
  const client = new StubMcode(async (req) => {
    requests.push(req);
    return requests.length === 1 ? first : reminder;
  });
  const spawned = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "smart",
      cwd: store.workspace,
      prompt: explorerPrompt("add a hello function that returns the string hello"),
    },
    { client, store, runId: run.run_id },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].maxSteps, ROLE_EXEC_DEFAULTS.explorer.maxSteps);
  assert.equal(requests[0].permission, "smart");
  assert.notEqual(requests[0].continue, true);
  assert.equal(requests[1].session, "mvs_c26375a905a64bbc8b25ae63a635c812");
  assert.notEqual(requests[1].continue, true);
  assert.equal(requests[1].maxSteps, 1);
  assert.equal(requests[1].permission, "off");
  assert.match(requests[1].prompt, /Do not use tools/);
  assert.doesNotMatch(requests[1].prompt, /add a hello function/);
  assert.equal(spawned.yield.status, "ok");
  assert.match(spawned.yield.summary, /hello\(\) missing/);
  assert.equal(validateWorkerYield(spawned.yield).ok, true);
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

test("empty reminder does not wipe first-exec snapshot; exit 2 persists stderr as invocation", async () => {
  const workspace = copyHelloPkg();
  const prose = "hello-pkg maps src/index.js placeholder; hello() is missing";
  const invocation = "mcode exec failed: --session and --continue are mutually exclusive.";
  const run = await runPlan({
    workspace,
    goal: "keep first snapshot when reminder is empty",
    mcode: new StubMcode(async (req) => {
      if ((req.prompt || "").startsWith("Yield failed")) {
        return {
          text: "",
          events: [{ raw: invocation, type: "stderr", text: invocation }],
          exitCode: HOST_EXIT.invocation,
          rawLines: [],
          stderr: invocation,
        };
      }
      return {
        text: prose,
        events: [
          { raw: { type: "delta", role: "assistant", content: prose }, type: "delta", role: "assistant", text: prose },
          {
            raw: { type: "message", cursor: "sse1:session%3Amvs_fa1108f7161b4c189d22ce2f9508e959", message: { role: "assistant" } },
            type: "message",
            role: "assistant",
          },
        ],
        exitCode: 1,
        rawLines: [],
      };
    }),
  });
  assert.equal(run.phase, "DISCOVER");
  assert.equal(run.status, "rejected");
  const store = new RunStore(workspace);
  const discover = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover.md"));
  const body = store.readArtifact(run.run_id, discover.path);
  assert.match(body, /hello-pkg maps src/);
  assert.doesNotMatch(body, /^invalid worker yield$/);

  const firstSnap = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover.json"));
  assert.match(firstSnap.assistant_text, /hello-pkg maps src/);
  assert.equal(firstSnap.exit_code, 1);
  assert.equal(firstSnap.host_exit, "crash");

  const reminderSnap = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover-reminder.json"));
  assert.equal(reminderSnap.assistant_text, "");
  assert.equal(reminderSnap.exit_code, 2);
  assert.equal(reminderSnap.host_exit, "invocation");
  assert.match(reminderSnap.stderr, /mutually exclusive/);

  const failed = JSON.parse(store.readArtifact(run.run_id, "yield-discover.json"));
  assert.equal(failed.status, "failed");
  assert.match(failed.findings[0].detail, /hello-pkg maps src/);
  assert.match(failed.findings[0].detail, /reminder_exit: 2 \(invocation\)/);
  assert.match(failed.findings[0].detail, /mutually exclusive/);
});

test("ProcessMcode persists host stderr on exit 2 invocation", async () => {
  const prev = process.env.OMM_MCODE;
  process.env.OMM_MCODE = path.resolve("test/fixtures/fake-mcode.mjs");
  try {
    const client = new ProcessMcode();
    const result = await client.exec({
      cwd: tmp(),
      prompt: "pong",
      role: "explorer",
      permission: "off",
      session: "mvs_deadbeef",
      continue: true,
      maxSteps: 1,
    });
    // buildExecArgs must not emit both; this asserts the host fixture still rejects if someone does.
    assert.equal(isLegalHostSessionArgv(buildExecArgs({
      cwd: tmp(),
      prompt: "pong",
      role: "explorer",
      permission: "off",
      session: "mvs_deadbeef",
      continue: true,
    })), true);
    assert.notEqual(result.exitCode, 2);
  } finally {
    if (prev === undefined) delete process.env.OMM_MCODE;
    else process.env.OMM_MCODE = prev;
  }

  const spawned = spawnSync(process.execPath, [path.resolve("test/fixtures/fake-mcode.mjs"), "exec", "--cwd", tmp(), "--output-format", "stream-json", "--permission", "off", "--session", "mvs_deadbeef", "--continue", "pong"], {
    encoding: "utf8",
  });
  assert.equal(spawned.status, 2);
  assert.match(spawned.stderr, /mutually exclusive/);
  assert.equal(classifyHostExit(spawned.status), "invocation");
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
  assert.equal(snapshot.host_exit, "success");
  assert.equal(snapshot.yield_status, "ok");
  assert.doesNotMatch(JSON.stringify(snapshot), /do-not-persist-raw/);

  const invocationSnap = buildExecSnapshot({
    text: "",
    events: [{ raw: HOST_SESSION_CONTINUE_EXCLUSIVE, type: "stderr", text: HOST_SESSION_CONTINUE_EXCLUSIVE }],
    exitCode: 2,
    rawLines: [],
    stderr: HOST_SESSION_CONTINUE_EXCLUSIVE,
  });
  assert.equal(invocationSnap.host_exit, "invocation");
  assert.equal(invocationSnap.exit_code, 2);
  assert.match(invocationSnap.stderr, /mutually exclusive/);
});

const SQLITE_CRASH_STDERR = [
  "Node version may be <18 so better-sqlite3 native bindings fail.",
  "Statement::~Statement during GC",
  "RemoveEnvironmentCleanupHook assert (env) != nullptr",
  "SIGABRT",
  "dyld[12345]: lazy symbol binding failed for better-sqlite3.node",
  "0   libsystem_kernel.dylib            0x0000000188e1e388 __pthread_kill + 8",
  "1   libsystem_pthread.dylib           0x0000000188e56f94 pthread_kill + 288",
  "2   libsystem_c.dylib                 0x0000000188d62c60 abort + 180",
].join("\n");

function sqliteCrash(text, sessionId) {
  const events = [
    { raw: { type: "delta", role: "assistant", content: text }, type: "delta", role: "assistant", text },
    { raw: SQLITE_CRASH_STDERR, type: "stderr", text: SQLITE_CRASH_STDERR },
  ];
  if (sessionId) {
    events.push({
      raw: { type: "message", cursor: `sse1:session%3A${sessionId}`, message: { role: "assistant" } },
      type: "message",
      role: "assistant",
    });
  }
  return {
    text,
    events,
    exitCode: HOST_EXIT.crash,
    rawLines: [],
    stderr: SQLITE_CRASH_STDERR,
  };
}

const TINY_OK_YIELD = {
  status: "ok",
  summary: "hello-pkg: hello() missing",
  findings: [
    {
      severity: "note",
      title: "no hello()",
      detail: "src exports placeholder",
      evidence: ["src/index.js"],
    },
  ],
  artifacts: ["src/index.js", "test/hello.test.js"],
};

test("tiny yield reminder and explorer contract demand a short object", () => {
  const reminder = yieldReminder("missing yield");
  assert.match(reminder, /schemaMode=strict/);
  assert.match(reminder, /only the tiny yield JSON object/);
  assert.match(reminder, /≤80 chars|<=80 chars|80 chars/);
  assert.match(reminder, /at most 2 findings/);
  assert.match(reminder, /Do not use tools/);
  assert.doesNotMatch(reminder, /Allowed: read\/search/);
  assert.equal(TINY_YIELD_SUMMARY_MAX, 80);
  assert.equal(TINY_YIELD_FINDINGS_MAX, 2);

  const crash = crashRetryPrompt();
  assert.match(crash, /only the tiny yield JSON object/);
  assert.match(crash, /at most 2 findings/);
  assert.match(crash, /This is not a schema reminder/);
  assert.doesNotMatch(crash, /^Yield failed schemaMode=strict:/);
  assert.doesNotMatch(crash, /Allowed: read\/search/);

  const contract = yieldContractLine();
  assert.match(contract, /Tiny yield JSON/);
  assert.match(contract, /80/);
  assert.match(contract, /at most 2 findings/);
  assert.match(reminder, /artifacts is string\[\] of paths, not objects/);
  assert.match(crash, /artifacts is string\[\] of paths, not objects/);
  assert.match(contract, /artifacts is string\[\] of paths, not objects/);
  assert.match(reminder, /"artifacts":\["path"\]/);
});

test("live reminder yield with object artifacts + file_hashes validates after coerce", () => {
  const liveReminder = {
    status: "ok",
    summary: "hello-pkg: hello() missing",
    findings: [
      {
        severity: "note",
        title: "no hello()",
        detail: "src exports placeholder; test imports hello()",
        evidence: ["src/index.js", "test/hello.test.js"],
      },
    ],
    artifacts: [
      { path: "/Users/harvey/omm-hello-live4/package.json", role: "manifest" },
      { path: "/Users/harvey/omm-hello-live4/src/index.js", role: "source", note: "exports placeholder()" },
      { path: "/Users/harvey/omm-hello-live4/test/hello.test.js", role: "test", note: "expects hello()" },
    ],
    file_hashes: {
      "/Users/harvey/omm-hello-live4/src/index.js": "abc123",
    },
    invented: "drop me",
  };
  const coerced = coerceWorkerYield(liveReminder);
  assert.deepEqual(coerced.artifacts, [
    "/Users/harvey/omm-hello-live4/package.json",
    "/Users/harvey/omm-hello-live4/src/index.js",
    "/Users/harvey/omm-hello-live4/test/hello.test.js",
  ]);
  assert.equal("invented" in coerced, false);
  assert.equal(typeof coerced.artifacts[0], "string");
  const parsed = validateWorkerYield(liveReminder);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.status, "ok");
  assert.deepEqual(parsed.data.artifacts, coerced.artifacts);
  assert.equal(parsed.data.file_hashes["/Users/harvey/omm-hello-live4/src/index.js"], "abc123");
  assert.equal("invented" in parsed.data, false);

  const viaFile = validateWorkerYield({
    status: "ok",
    summary: "file key",
    findings: [],
    artifacts: [{ file: "src/index.js", role: "source" }],
  });
  assert.equal(viaFile.ok, true, viaFile.ok ? "" : viaFile.error);
  assert.deepEqual(viaFile.data.artifacts, ["src/index.js"]);

  const noPath = validateWorkerYield({
    status: "ok",
    summary: "no path",
    findings: [],
    artifacts: [{ role: "manifest", note: "package.json" }],
  });
  assert.equal(noPath.ok, false, "must not invent a path");
  assert.match(noPath.error, /artifacts must be string\[\]/);

  const numbered = validateWorkerYield({
    status: "ok",
    summary: "number",
    findings: [],
    artifacts: [1],
  });
  assert.equal(numbered.ok, false);

  const missing = validateWorkerYield({
    status: "ok",
    summary: "missing artifacts",
    findings: [],
  });
  assert.equal(missing.ok, false);

  const prose = parseWorkerYield({
    text: "I'll explore the workspace...",
    events: [],
    exitCode: 5,
    rawLines: [],
  });
  assert.equal(prose.ok, false, "must not invent a WorkerYield from prose");
});

test("complete looksLikeYield in assistant_text parses even if more text follows; truncated JSON is not repaired", () => {
  const complete = `${JSON.stringify(TINY_OK_YIELD)} Node version may be <18 so`;
  const fromText = extractCompleteYieldFromText(complete);
  assert.deepEqual(fromText, TINY_OK_YIELD);
  const parsed = parseWorkerYield({
    text: complete,
    events: [{ raw: { type: "delta", role: "assistant", content: complete }, type: "delta", role: "assistant" }],
    exitCode: 1,
    rawLines: [],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.summary, TINY_OK_YIELD.summary);
  assert.equal(validateWorkerYield(parsed.data).ok, true);

  const truncated = '{"status":"ok","summary":"hello-pkg maps src","findings":[],"artifacts":["src/index.js"],"note":"Node version may be <18 so';
  assert.equal(extractCompleteYieldFromText(truncated), undefined);
  const broken = parseWorkerYield({
    text: truncated,
    events: [],
    exitCode: 1,
    rawLines: [],
  });
  assert.equal(broken.ok, false, "must not invent a closing brace or fields");
  assert.equal(extractStructuredYield({ text: truncated, events: [], exitCode: 1, rawLines: [] }), undefined);
});

test("crash + truncated JSON triggers exactly one extra text-only exec (not a schema reminder)", async () => {
  assert.equal(YIELD_SCHEMA_REMINDER_MAX, 1);
  assert.equal(YIELD_CRASH_RETRY_MAX, 1);
  const requests = [];
  const truncated = '{"status":"ok","summary":"hello-pkg maps src","findings":[],"artifacts":["src';
  const client = new StubMcode(async (req) => {
    requests.push(req);
    if (requests.length === 1) return sqliteCrash(truncated, "mvs_crashretry01");
    return {
      text: `${JSON.stringify(TINY_OK_YIELD)} trailing host noise`,
      events: [{ raw: { type: "exec.result", answer: TINY_OK_YIELD }, type: "exec.result" }],
      exitCode: 0,
      rawLines: [],
    };
  });
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "ask",
      cwd: tmp(),
      prompt: explorerPrompt("add hello()"),
    },
    { client },
  );
  assert.equal(requests.length, 2, "native crash + no valid yield = one crash retry, not reminder then retry");
  assert.equal(requests[0].maxSteps, ROLE_EXEC_DEFAULTS.explorer.maxSteps);
  assert.equal(requests[0].permission, "ask");
  assert.equal(requests[1].session, "mvs_crashretry01");
  assert.notEqual(requests[1].continue, true);
  assert.equal(requests[1].maxSteps, YIELD_CRASH_RETRY_MAX_STEPS);
  assert.equal(requests[1].permission, YIELD_CRASH_RETRY_PERMISSION);
  assert.match(requests[1].prompt, /This is not a schema reminder/);
  assert.doesNotMatch(requests[1].prompt, /^Yield failed schemaMode=strict:/);
  assert.doesNotMatch(requests[1].prompt, /Allowed: read\/search/);
  assert.doesNotMatch(requests[1].prompt, /add hello\(\)/);
  assert.equal(result.yield.status, "ok");
  assert.equal(validateWorkerYield(result.yield).ok, true);
  assert.equal(result.crashRetryExec.exitCode, 0);

  const retryArgv = buildExecArgs(requests[1]);
  assert.equal(isLegalHostSessionArgv(retryArgv), true);
  assert.equal(retryArgv.includes("--continue"), false);
  assert.equal(retryArgv[retryArgv.indexOf("--session") + 1], "mvs_crashretry01");
  assert.equal(schemaArg(retryArgv), undefined);
});

test("two native crashes still fail honest (no third exec, no invented yield)", async () => {
  const requests = [];
  const truncated = '{"status":"ok","summary":"Node version may be <18 so';
  const client = new StubMcode(async (req) => {
    requests.push(req);
    return sqliteCrash(truncated, "mvs_twocrash02");
  });
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "ask",
      cwd: tmp(),
      prompt: explorerPrompt("add hello()"),
    },
    { client },
  );
  assert.equal(requests.length, 2, "first crash + one crash retry; no reminder storm");
  assert.match(requests[1].prompt, /This is not a schema reminder/);
  assert.equal(result.yield.status, "failed");
  assert.equal(validateWorkerYield({ status: "ok", summary: "invented" }).ok, false);
  assert.match(result.yield.findings[0].detail, /crash_retry_exit: 1 \(crash\)/);
  assert.match(result.yield.findings[0].detail, /host native crash/);
  assert.doesNotMatch(result.yield.findings[0].detail, /dyld/);
});

test("schema reminder then crash-retry: complete tiny yield after crash-retry parses", async () => {
  const requests = [];
  const truncated = '{"status":"ok","summary":"essay that never closed","findings":[{"severity":"note","title":"a","detail":"Node version may be <18 so';
  const client = new StubMcode(async (req) => {
    requests.push(req);
    if (requests.length === 1) {
      return { text: "mapped hello-pkg in prose", events: [], exitCode: 0, rawLines: [] };
    }
    if ((req.prompt || "").startsWith("Yield failed")) {
      return sqliteCrash(truncated, "mvs_remindcrash3");
    }
    return {
      text: JSON.stringify(TINY_OK_YIELD),
      events: [{ raw: { type: "exec.result", answer: TINY_OK_YIELD }, type: "exec.result" }],
      exitCode: 0,
      rawLines: [],
    };
  });
  const result = await spawnSubagent(
    {
      role: "explorer",
      contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
      permission: "ask",
      cwd: tmp(),
      prompt: explorerPrompt("add hello()"),
    },
    { client },
  );
  assert.equal(requests.length, 3, "cap is one reminder + one crash retry");
  assert.match(requests[1].prompt, /^Yield failed schemaMode=strict:/);
  assert.match(requests[2].prompt, /This is not a schema reminder/);
  assert.equal(requests[2].maxSteps, 1);
  assert.equal(requests[2].permission, "off");
  assert.equal(requests[2].session, "mvs_remindcrash3");
  assert.notEqual(requests[2].continue, true);
  assert.equal(result.yield.status, "ok");
  assert.equal(validateWorkerYield(result.yield).ok, true);
  assert.equal(parseWorkerYield(result.crashRetryExec).ok, true);
});

test("finalizeHostExit reports timeout and signal independently of exitCode", () => {
  const timerKill = finalizeHostExit({ code: null, signal: "SIGTERM", killedByTimer: true });
  assert.equal(timerKill.exitCode, HOST_EXIT.timeout);
  assert.equal(timerKill.timedOut, true);
  assert.equal(timerKill.signal, "SIGTERM");
  assert.equal(classifyHostExit(timerKill.exitCode), "timeout");
  assert.equal(isHostNativeCrash({ ...timerKill, events: [], stderr: "SIGABRT in stderr" }), false);

  const hostTimeout = finalizeHostExit({ code: HOST_EXIT.timeout, signal: null, killedByTimer: false });
  assert.equal(hostTimeout.exitCode, 6);
  assert.equal(hostTimeout.timedOut, true);
  assert.equal(hostTimeout.signal, undefined);

  const trapped = finalizeHostExit({ code: 0, signal: "SIGTERM", killedByTimer: true });
  assert.equal(trapped.exitCode, 0);
  assert.equal(trapped.timedOut, true);
  assert.equal(trapped.signal, "SIGTERM");

  const crash = finalizeHostExit({ code: null, signal: "SIGABRT", killedByTimer: false });
  assert.equal(crash.exitCode, HOST_EXIT.crash);
  assert.equal(crash.timedOut, false);
  assert.equal(crash.signal, "SIGABRT");

  const clean = finalizeHostExit({ code: 0, signal: null, killedByTimer: false });
  assert.equal(clean.exitCode, 0);
  assert.equal(clean.timedOut, false);
});

test("isHostNativeCrash requires exit 1 plus sqlite/assert/SIGABRT; classifyHostExit stays exit-code only", () => {
  assert.equal(classifyHostExit(1), "crash");
  assert.equal(isHostNativeCrash({ exitCode: 1, events: [], stderr: "toolUse ended the stream" }), false);
  assert.equal(isHostNativeCrash(sqliteCrash("partial {")), true);
  assert.match(SQLITE_CRASH_STDERR, HOST_NATIVE_CRASH_RE);
  const snap = buildExecSnapshot(sqliteCrash("partial {"));
  assert.equal(snap.host_exit, "crash");
  assert.ok(snap.stderr.length <= SNAPSHOT_STDERR_MAX);
  assert.match(snap.stderr, /better-sqlite3|Statement::~Statement/);
});

test("yieldCrashRetryRequest is session XOR continue, same as reminder", () => {
  const first = sqliteCrash("partial {", "mvs_xorcontinue4");
  const base = {
    role: "explorer",
    contract: { task_id: "T1", objective: "look", acceptance: [], constraints: [] },
    permission: "smart",
    cwd: tmp(),
    prompt: explorerPrompt("add hello()"),
    maxSteps: ROLE_EXEC_DEFAULTS.explorer.maxSteps,
  };
  const retry = yieldCrashRetryRequest(base, first);
  assert.equal(retry.session, "mvs_xorcontinue4");
  assert.notEqual(retry.continue, true);
  assert.equal(retry.maxSteps, YIELD_CRASH_RETRY_MAX_STEPS);
  assert.equal(retry.permission, YIELD_CRASH_RETRY_PERMISSION);
  const argv = buildExecArgs(
    applyRoleDefaults({
      cwd: base.cwd,
      prompt: crashRetryPrompt(),
      role: "explorer",
      permission: retry.permission,
      session: retry.session,
      continue: retry.continue,
      maxSteps: retry.maxSteps,
    }),
  );
  assert.equal(isLegalHostSessionArgv(argv), true);
  assert.ok(argv.includes("--session"));
  assert.equal(argv.includes("--continue"), false);
  assert.equal(schemaArg(argv), undefined);
});

test("live plan on hello-pkg reaches PLAN_REVIEW after crash-retry; discover.md has no native stack", async () => {
  const workspace = copyHelloPkg();
  const requests = [];
  const truncated = '{"status":"ok","summary":"hello-pkg src+test","findings":[],"artifacts":["src/index.js"],"x":"Node version may be <18 so';
  const run = await runPlan({
    workspace,
    goal: "export hello() that returns hello and prove the fixture test passes",
    mcode: new StubMcode(async (req) => {
      requests.push(req);
      if (req.role === "explorer" && !(req.prompt || "").includes("tiny yield JSON object")) {
        return sqliteCrash(truncated, "mvs_planloop05");
      }
      if (req.role === "explorer") {
        return {
          text: JSON.stringify(TINY_OK_YIELD),
          events: [{ raw: { type: "exec.result", answer: TINY_OK_YIELD }, type: "exec.result" }],
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
  assert.ok(requests.some((req) => (req.prompt || "").includes("This is not a schema reminder")));
  assert.ok(requests.filter((req) => req.role === "explorer").length <= 2);

  const store = new RunStore(workspace);
  const discover = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover.md"));
  assert.ok(discover);
  const body = store.readArtifact(run.run_id, discover.path);
  assert.match(body, /hello-pkg|hello\(\)/);
  assert.doesNotMatch(body, /dyld/);
  assert.doesNotMatch(body, /better-sqlite3/);
  assert.doesNotMatch(body, /RemoveEnvironmentCleanupHook/);
  assert.doesNotMatch(body, /libsystem_kernel/);

  const firstSnap = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover.json"));
  assert.ok((firstSnap.stderr || "").length <= SNAPSHOT_STDERR_MAX);
  const retrySnap = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover-crash-retry.json"));
  assert.equal(retrySnap.yield_status, "ok");
  const parsedYield = JSON.parse(store.readArtifact(run.run_id, "yield-discover.json"));
  assert.equal(validateWorkerYield(parsedYield).ok, true);
});

test("failed discover after native crash still keeps stacks out of discover.md", async () => {
  const workspace = copyHelloPkg();
  const truncated = '{"status":"ok","summary":"Node version may be <18 so';
  const run = await runPlan({
    workspace,
    goal: "do not dump dyld into discover.md",
    mcode: new StubMcode(async () => sqliteCrash(truncated, "mvs_discoverstack6")),
  });
  assert.equal(run.phase, "DISCOVER");
  assert.equal(run.status, "blocked");
  assert.equal(run.goal_state?.phase, "blocked");
  assert.equal(run.goal_state?.blockedReason?.code, "host-crash");
  const store = new RunStore(workspace);
  const discover = store.loadEvidence(run.run_id).items.find((item) => item.path.includes("discover.md"));
  const body = store.readArtifact(run.run_id, discover.path);
  assert.doesNotMatch(body, /dyld/);
  assert.doesNotMatch(body, /better-sqlite3/);
  assert.doesNotMatch(body, /libsystem_kernel/);
  assert.match(body, /host crash: native sqlite\/assert|Node version may be <18 so|invalid worker yield/);
  const snap = JSON.parse(store.readArtifact(run.run_id, "exec-snapshot-discover.json"));
  assert.ok((snap.stderr || "").length <= SNAPSHOT_STDERR_MAX);
});
