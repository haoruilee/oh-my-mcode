import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  parseStreamLine,
  ProcessMcode,
  StubMcode,
  applyRoleDefaults,
  buildExecArgs,
  collectAssistantText,
  formatHostTimeout,
  HOST_TIMEOUT_ARG_RE,
  ROLE_EXEC_DEFAULTS,
  hostOutputSchemaEnabled,
} from "../dist/mcode.js";
import { extractUsage } from "../dist/usage.js";
import { extractStructuredOutput, extractStructuredYield, parseWorkerYield, validateWorkerYield, workerYieldSchemaPath } from "../dist/yield.js";
import { formatTps, isStubHost, runDoctorTps, tpsFromExec, TPS_UNMEASURED } from "../dist/tps.js";
import { spawnSubagent } from "../dist/subagent.js";
import { tpsProbePrompt } from "../dist/prompts.js";
import { main } from "../dist/cli.js";

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), "omm-yt-"));
}

function captureMain(argv) {
  const chunks = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  return {
    chunks,
    err,
    async run() {
      try {
        return await main(argv);
      } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
      }
    },
  };
}

const fakeMcode = path.resolve("test/fixtures/fake-mcode.mjs");

function schemaArg(argv) {
  const idx = argv.indexOf("--output-schema");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function timeoutArg(argv) {
  const idx = argv.indexOf("--timeout");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function withHostOutputSchema(enabled, fn) {
  const prev = process.env.OMM_HOST_OUTPUT_SCHEMA;
  if (enabled) process.env.OMM_HOST_OUTPUT_SCHEMA = "1";
  else delete process.env.OMM_HOST_OUTPUT_SCHEMA;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.OMM_HOST_OUTPUT_SCHEMA;
    else process.env.OMM_HOST_OUTPUT_SCHEMA = prev;
  }
}

test("buildExecArgs / fake-mcode pass --timeout with a host unit suffix, never a bare integer", async () => {
  assert.equal(ROLE_EXEC_DEFAULTS.explorer.timeoutMs, 3 * 60 * 1000);
  const prepared = applyRoleDefaults({
    cwd: tmp(),
    prompt: "Reply with exactly pong",
    role: "explorer",
    permission: "ask",
  });
  assert.equal(prepared.timeoutMs, 3 * 60 * 1000, "role defaults stay milliseconds internally");

  const argv = buildExecArgs(prepared);
  const value = timeoutArg(argv);
  assert.ok(value, "expected --timeout on argv");
  assert.match(value, HOST_TIMEOUT_ARG_RE);
  assert.ok(value === "180s" || value === "180000ms", `3-minute explorer timeout must be 180s or 180000ms, got ${value}`);
  assert.notEqual(value, "180");
  assert.equal(formatHostTimeout(prepared.timeoutMs), "180s");

  const rejected = spawnSync(process.execPath, [fakeMcode, "exec", "--timeout", "180", "Reply with exactly pong"], {
    encoding: "utf8",
  });
  assert.equal(rejected.status, 6);
  assert.match(rejected.stderr, /timeout|milliseconds/i);

  const accepted = spawnSync(process.execPath, [fakeMcode, "exec", "--timeout", "180s", "Reply with exactly pong"], {
    encoding: "utf8",
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const prev = process.env.OMM_MCODE;
  const argvFile = path.join(tmp(), "argv-timeout.json");
  process.env.OMM_MCODE = fakeMcode;
  process.env.OMM_FAKE_ARGV = argvFile;
  try {
    const result = await new ProcessMcode().exec(prepared);
    assert.equal(result.exitCode, 0, "suffixed --timeout must not trip fake-mcode exit 6");
    const spawned = JSON.parse(readFileSync(argvFile, "utf8"));
    const spawnedTimeout = timeoutArg(spawned);
    assert.ok(spawnedTimeout, "ProcessMcode did not pass --timeout");
    assert.match(spawnedTimeout, /^\d+(ms|s|m|h)$/);
    assert.ok(
      spawnedTimeout === "180s" || spawnedTimeout === "180000ms",
      `fake-mcode saw bare or unexpected --timeout ${spawnedTimeout}`,
    );
    assert.notEqual(spawnedTimeout, "180");
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
    else delete process.env.OMM_MCODE;
    delete process.env.OMM_FAKE_ARGV;
  }
});

test("default exec argv omits --output-schema unless OMM_HOST_OUTPUT_SCHEMA=1", async () => {
  const schemaPath = workerYieldSchemaPath();
  const req = {
    cwd: tmp(),
    prompt: "Reply with exactly pong",
    role: "explorer",
    permission: "off",
    outputSchema: schemaPath,
    maxSteps: 1,
    timeoutMs: 30_000,
  };
  await withHostOutputSchema(false, () => {
    assert.equal(hostOutputSchemaEnabled(), false);
    assert.equal(schemaArg(buildExecArgs(req)), undefined);
  });

  const prevMcode = process.env.OMM_MCODE;
  const argvFile = path.join(tmp(), "argv-default.json");
  process.env.OMM_MCODE = fakeMcode;
  process.env.OMM_FAKE_ARGV = argvFile;
  try {
    await withHostOutputSchema(false, () =>
      new ProcessMcode().exec({
        cwd: tmp(),
        prompt: "Reply with exactly pong",
        role: "explorer",
        permission: "off",
        outputSchema: schemaPath,
        maxSteps: 1,
        timeoutMs: 8_000,
      }),
    );
    const spawned = JSON.parse(readFileSync(argvFile, "utf8"));
    assert.equal(schemaArg(spawned), undefined, "default ProcessMcode must not pass --output-schema");
  } finally {
    if (prevMcode) process.env.OMM_MCODE = prevMcode;
    else delete process.env.OMM_MCODE;
    delete process.env.OMM_FAKE_ARGV;
  }
});

test("OMM_HOST_OUTPUT_SCHEMA=1 passes --output-schema as a JSON object, not a .json path", async () => {
  const schemaPath = workerYieldSchemaPath();
  await withHostOutputSchema(true, async () => {
    const argv = buildExecArgs({
      cwd: tmp(),
      prompt: "Reply with exactly pong",
      role: "explorer",
      permission: "off",
      outputSchema: schemaPath,
      maxSteps: 1,
      timeoutMs: 30_000,
    });
    const value = schemaArg(argv);
    assert.ok(value, "expected --output-schema on argv when opt-in is set");
    assert.ok(value.startsWith("{"), `expected JSON object, got ${value.slice(0, 80)}`);
    assert.doesNotMatch(value, /\.json$/);
    assert.notEqual(value, schemaPath);
    const parsed = JSON.parse(value);
    assert.equal(parsed.type, "object");
    assert.ok(parsed.properties?.status);

    const missing = buildExecArgs({
      cwd: tmp(),
      prompt: "Reply with exactly pong",
      role: "explorer",
      permission: "off",
      outputSchema: path.join(tmp(), "does-not-exist.schema.json"),
      maxSteps: 1,
    });
    assert.equal(schemaArg(missing), undefined);
  });

  const rejected = spawnSync(process.execPath, [fakeMcode, "exec", "--output-schema", schemaPath, "Reply with exactly pong"], {
    encoding: "utf8",
  });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /--output-schema requires a JSON object/);

  const prev = process.env.OMM_MCODE;
  const argvFile = path.join(tmp(), "argv.json");
  process.env.OMM_MCODE = fakeMcode;
  process.env.OMM_FAKE_ARGV = argvFile;
  try {
    await withHostOutputSchema(true, () =>
      new ProcessMcode().exec({
        cwd: tmp(),
        prompt: "Reply with exactly pong",
        role: "explorer",
        permission: "off",
        outputSchema: schemaPath,
        maxSteps: 1,
        timeoutMs: 8_000,
      }),
    );
    const spawned = JSON.parse(readFileSync(argvFile, "utf8"));
    const spawnedSchema = schemaArg(spawned);
    assert.ok(spawnedSchema, "ProcessMcode did not pass --output-schema");
    assert.ok(spawnedSchema.startsWith("{"), `host argv was not JSON: ${spawnedSchema.slice(0, 80)}`);
    assert.doesNotMatch(spawnedSchema, /\.schema\.json$/);
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
    else delete process.env.OMM_MCODE;
    delete process.env.OMM_FAKE_ARGV;
  }
});

test("parseWorkerYield accepts assistant JSON without structuredOutput", () => {
  const data = { status: "ok", summary: "pong", findings: [], artifacts: [] };
  const text = JSON.stringify(data);
  const parsed = parseWorkerYield({
    text,
    events: [{ raw: { type: "assistant", text }, type: "assistant", text }],
    exitCode: 0,
    rawLines: [text],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.summary, "pong");
});

test("spawnSubagent does not set outputSchema by default", async () => {
  const prev = process.env.OMM_HOST_OUTPUT_SCHEMA;
  delete process.env.OMM_HOST_OUTPUT_SCHEMA;
  let seen;
  const data = { status: "ok", summary: "from assistant", findings: [], artifacts: [] };
  const client = new StubMcode(async (req) => {
    seen = req;
    return { text: JSON.stringify(data), events: [], exitCode: 0, rawLines: [] };
  });
  try {
    const result = await spawnSubagent(
      {
        role: "builder",
        contract: { task_id: "T1", objective: "x", acceptance: [], constraints: [] },
        permission: "ask",
        cwd: tmp(),
        prompt: "do the task",
      },
      { client },
    );
    assert.equal(seen.outputSchema, undefined);
    assert.equal(result.yield.status, "ok");
    assert.equal(result.yield.summary, "from assistant");
  } finally {
    if (prev === undefined) delete process.env.OMM_HOST_OUTPUT_SCHEMA;
    else process.env.OMM_HOST_OUTPUT_SCHEMA = prev;
  }
});

test("validateWorkerYield is strict", () => {
  const ok = validateWorkerYield({
    status: "ok",
    summary: "done",
    findings: [{ severity: "note", title: "n", detail: "d", evidence: [] }],
    artifacts: ["src/a.ts"],
  });
  assert.equal(ok.ok, true);
  const bad = validateWorkerYield({ status: "ok", summary: "x" });
  assert.equal(bad.ok, false);
  const extra = validateWorkerYield({
    status: "ok",
    summary: "x",
    findings: [],
    artifacts: [],
    prose: "nope",
  });
  assert.equal(extra.ok, false);
});

test("mcode 0.2.1 live yield fixture parses exec.result.answer", () => {
  const fixture = readFileSync(path.resolve("test/fixtures/stream-json-mcode-0.2.1-yield.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.includes("_comment"));
  const events = fixture.map((line) => parseStreamLine(line));
  const result = {
    text: collectAssistantText(events),
    events,
    exitCode: 0,
    rawLines: fixture,
    structuredOutput: extractStructuredOutput(events),
    usage: extractUsage(events, fixture),
  };
  const parsed = parseWorkerYield(result);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.equal(parsed.data.status, "ok");
  assert.equal(parsed.data.summary, "pong");
  assert.deepEqual(parsed.data.findings, []);
  assert.deepEqual(parsed.data.artifacts, []);
  assert.equal(result.usage?.input_tokens, 470);
  assert.equal(result.usage?.output_tokens, 47);
  assert.equal(result.usage?.cache_read_tokens, 21497);
  assert.equal(result.usage?.request_duration_ms, 4226);
  assert.deepEqual(extractStructuredYield(result), {
    status: "ok",
    summary: "pong",
    findings: [],
    artifacts: [],
  });
});

test("extractStructuredYield ignores raw JSONL and planner graphs", () => {
  const yieldData = { status: "ok", summary: "from data", findings: [], artifacts: [] };
  const result = {
    text: '{"type":"assistant","text":"leaked jsonl"}',
    events: [
      { raw: { type: "assistant", text: "leaked" }, type: "assistant", text: "leaked" },
      { raw: { type: "result", structuredOutput: { data: yieldData } }, type: "result" },
    ],
    exitCode: 0,
    rawLines: ['{"type":"assistant","text":"leaked jsonl"}'],
    structuredOutput: { data: yieldData },
  };
  assert.deepEqual(extractStructuredYield(result), yieldData);
  assert.equal(parseWorkerYield(result).ok, true);

  const plannerOnly = {
    text: '{"tasks":[],"acceptance":[]}',
    events: [],
    exitCode: 0,
    rawLines: [],
    structuredOutput: { data: { tasks: [], acceptance: [] } },
  };
  assert.equal(extractStructuredYield(plannerOnly), undefined);
});

test("invalid yield retries once then surfaces a failed yield", async () => {
  const requests = [];
  const client = new StubMcode(async (req) => {
    requests.push(req);
    return { text: "not a yield", events: [], exitCode: 0, rawLines: ["not a yield"] };
  });
  const result = await spawnSubagent(
    {
      role: "builder",
      contract: { task_id: "T1", objective: "x", acceptance: [], constraints: [] },
      permission: "ask",
      cwd: tmp(),
      prompt: "do the task",
    },
    { client },
  );
  assert.equal(requests.length, 2);
  assert.match(requests[1].prompt, /schemaMode=strict/);
  assert.match(requests[1].prompt, /Do not use tools/);
  assert.doesNotMatch(requests[1].prompt, /do the task/);
  assert.equal(requests[1].maxSteps, 1);
  assert.equal(requests[1].permission, "off");
  assert.equal(requests[1].continue, true);
  assert.equal(requests[1].session, undefined);
  assert.equal(requests[0].maxSteps, ROLE_EXEC_DEFAULTS.builder.maxSteps);
  assert.equal(requests[0].permission, "ask");
  assert.equal(result.yield.status, "failed");
  assert.match(result.yield.findings[0].detail, /structuredOutput|yield|schema/i);
});

test("mcode 0.2.1 stream-json fixture parses message.usage + exec.result", () => {
  const fixture = readFileSync(path.resolve("test/fixtures/stream-json-mcode-0.2.1.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.includes("_comment"));
  const events = fixture.map((line) => parseStreamLine(line));
  const usage = extractUsage(events, fixture);
  assert.equal(usage?.input_tokens, 16816);
  assert.equal(usage?.output_tokens, 261);
  assert.equal(usage?.total_tokens, 20348);
  assert.equal(usage?.cache_read_tokens, 3271);
  assert.equal(usage?.request_duration_ms, 7598);
  assert.equal(usage?.duration_ms, 10911);
  assert.equal(usage?.thinking_duration_ms, 1061);
  assert.equal(usage?.first_token_ms, 4700);
  assert.deepEqual(usage?.model, { providerId: "minimax", modelId: "MiniMax-M3", variant: "thinking" });

  const report = tpsFromExec(
    { text: "pong", events, exitCode: 0, rawLines: fixture, usage, wall_ms: 20710, first_token_ms: usage.first_token_ms },
    tpsProbePrompt(),
    { stub: false, allowStub: false },
  );
  assert.equal(report.unmeasured, false);
  assert.equal(report.input_tokens, 16816);
  assert.equal(report.output_tokens, 261);
  assert.equal(report.total_tokens, 20348);
  assert.equal(report.cache_read_tokens, 3271);
  assert.equal(report.request_duration_ms, 7598);
  assert.equal(report.exec_duration_ms, 10911);
  assert.equal(report.thinking_duration_ms, 1061);
  assert.equal(report.wall_ms, 20710);
  assert.equal(report.first_token_ms, 4700);
  assert.equal(report.output_tps, Number((261 / 7.598).toFixed(3)));
  assert.equal(report.wall_tps, Number((261 / 20.71).toFixed(3)));
  assert.equal(report.model?.modelId, "MiniMax-M3");
  const text = formatTps(report);
  assert.match(text, /input_tokens: 16816/);
  assert.match(text, /output_tps: 34\.351/);
  assert.match(text, /wall_tps: 12\.603/);
  assert.match(text, /model: minimax\/MiniMax-M3 \(thinking\)/);
});

test("stream-json usage fixture parses tokens and duration", () => {
  const fixture = readFileSync(path.resolve("test/fixtures/stream-json-usage.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.includes("_comment"));
  const events = fixture.map((line) => parseStreamLine(line));
  const usage = extractUsage(events, fixture);
  assert.equal(usage?.input_tokens, 18);
  assert.equal(usage?.output_tokens, 1);
  assert.equal(usage?.total_tokens, 19);
  assert.equal(usage?.duration_ms, 250);
  const report = tpsFromExec(
    { text: "pong", events, exitCode: 0, rawLines: fixture, usage, wall_ms: 400, first_token_ms: 42 },
    tpsProbePrompt(),
    { stub: false, allowStub: false },
  );
  assert.equal(report.unmeasured, false);
  assert.equal(report.input_tokens, 18);
  assert.equal(report.output_tokens, 1);
  assert.equal(report.wall_ms, 400);
  assert.equal(report.first_token_ms, 42);
  assert.equal(report.output_tps, Number((1 / 0.25).toFixed(3)));
  assert.equal(report.wall_tps, Number((1 / 0.4).toFixed(3)));
  assert.ok(report.our_prompt_chars > 0);
  assert.ok(report.builder_prompt_chars > report.our_prompt_chars);
  assert.match(formatTps(report), /output_tps:/);
});

test("doctor --tps against fake-mcode is unmeasured and exits non-zero", async () => {
  const prev = process.env.OMM_MCODE;
  process.env.OMM_MCODE = path.resolve("test/fixtures/fake-mcode.mjs");
  try {
    assert.equal(isStubHost(), true);
    const report = await runDoctorTps({ allowStub: false });
    assert.equal(report.unmeasured, true);
    assert.equal(report.output_tps, null);
    assert.equal(report.reason, TPS_UNMEASURED);
    assert.match(formatTps(report), /unmeasured/);

    const cap = captureMain(["doctor", "--package-only", "--tps"]);
    const code = await cap.run();
    assert.equal(code, 1, cap.chunks.join(""));
    assert.match(cap.chunks.join(""), /unmeasured/);
    assert.doesNotMatch(cap.chunks.join(""), /output_tps: [0-9]/);
  } finally {
    if (prev) process.env.OMM_MCODE = prev;
    else delete process.env.OMM_MCODE;
  }
});
