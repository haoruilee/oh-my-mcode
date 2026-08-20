import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseStreamLine, StubMcode } from "../dist/mcode.js";
import { extractUsage } from "../dist/usage.js";
import { extractStructuredYield, parseWorkerYield, validateWorkerYield } from "../dist/yield.js";
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
  const prompts = [];
  const client = new StubMcode(async (req) => {
    prompts.push(req.prompt);
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
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /schemaMode=strict/);
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
