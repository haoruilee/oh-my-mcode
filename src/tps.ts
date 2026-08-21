import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { minimaxHomeDir } from "./config.js";
import { ProcessMcode, mcodeExists, resolveMcodeInvocation, type ExecResult } from "./mcode.js";
import { extractUsage } from "./usage.js";
import { builderPrompt, estimateTokens, measurePrompt, tpsProbePrompt } from "./prompts.js";

export const TPS_UNMEASURED = "unmeasured";

export interface TpsReport {
  host_binary: string | null;
  host_version: string | null;
  stub: boolean;
  unmeasured: boolean;
  allow_stub: boolean;
  wall_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  request_duration_ms: number | null;
  exec_duration_ms: number | null;
  thinking_duration_ms: number | null;
  output_tps: number | null;
  wall_tps: number | null;
  first_token_ms: number | null;
  model: { providerId?: string; modelId?: string; variant?: string } | null;
  our_prompt_chars: number;
  our_prompt_est_tokens: number;
  builder_prompt_chars: number;
  builder_prompt_est_tokens: number;
  reason?: string;
}

export function isStubHost(): boolean {
  const override = process.env.OMM_MCODE || "";
  if (/fake-mcode/i.test(override)) return true;
  if (process.env.OMM_MCODE_STUB === "1") return true;
  return false;
}

export function tpsPersistPath(): string {
  return path.join(minimaxHomeDir(), "oh-my-mcode", "tps.json");
}

export function persistTps(report: TpsReport): string {
  const dest = tpsPersistPath();
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
  return dest;
}

function hostVersion(): string | null {
  if (!mcodeExists()) return null;
  try {
    const invocation = resolveMcodeInvocation();
    const text = execFileSync(
      invocation.command,
      invocation.prefixArgs.length ? [...invocation.prefixArgs, "--version"] : ["--version"],
      { encoding: "utf8", timeout: 8000 },
    );
    return text.match(/(\d+\.\d+\.\d+)/)?.[1] || text.trim().slice(0, 40) || null;
  } catch {
    return null;
  }
}

export function tpsFromExec(result: ExecResult, prompt: string, opts: { stub: boolean; allowStub: boolean }): TpsReport {
  const usage = result.usage || extractUsage(result.events, result.rawLines);
  const wallMs = result.wall_ms ?? null;
  const outputTokens = usage?.output_tokens ?? null;
  const inputTokens = usage?.input_tokens ?? null;
  const totalTokens = usage?.total_tokens ?? (inputTokens != null || outputTokens != null ? (inputTokens || 0) + (outputTokens || 0) : null);
  // output_tps uses message.usage.requestDurationMs (generation). Do not use exec.result.durationMs or wall.
  const generationMs = usage?.request_duration_ms ?? usage?.duration_ms;
  const generationS = generationMs && generationMs > 0 ? generationMs / 1000 : null;
  const wallS = wallMs && wallMs > 0 ? wallMs / 1000 : null;
  const measured = measurePrompt(prompt);
  const builder = measurePrompt(
    builderPrompt({
      task_id: "T1",
      objective: "typical builder contract",
      allowed_files: ["src/example.ts"],
      acceptance: ["npm test exits 0"],
      constraints: ["One task only", "Do not mark Accepted"],
    }),
  );
  const hasTokenUsage = inputTokens != null || outputTokens != null;
  const unmeasured = !hasTokenUsage || (opts.stub && !opts.allowStub);
  return {
    host_binary: mcodeExists() ? resolveMcodeInvocation().command : null,
    host_version: hostVersion(),
    stub: opts.stub,
    unmeasured,
    allow_stub: opts.allowStub,
    wall_ms: wallMs,
    input_tokens: inputTokens ?? null,
    output_tokens: outputTokens ?? null,
    total_tokens: totalTokens ?? null,
    cache_read_tokens: usage?.cache_read_tokens ?? null,
    request_duration_ms: usage?.request_duration_ms ?? null,
    exec_duration_ms: usage?.duration_ms ?? null,
    thinking_duration_ms: usage?.thinking_duration_ms ?? null,
    output_tps:
      !unmeasured && outputTokens != null && generationS && generationS > 0
        ? Number((outputTokens / generationS).toFixed(3))
        : null,
    wall_tps: !unmeasured && outputTokens != null && wallS && wallS > 0 ? Number((outputTokens / wallS).toFixed(3)) : null,
    first_token_ms: result.first_token_ms ?? usage?.first_token_ms ?? null,
    model: usage?.model ?? null,
    our_prompt_chars: measured.chars,
    our_prompt_est_tokens: measured.est_tokens,
    builder_prompt_chars: builder.chars,
    builder_prompt_est_tokens: builder.est_tokens,
    reason: unmeasured ? TPS_UNMEASURED : undefined,
  };
}

export function unmeasuredReport(reason: string, allowStub: boolean): TpsReport {
  const probe = measurePrompt(tpsProbePrompt());
  const builder = measurePrompt(
    builderPrompt({
      task_id: "T1",
      objective: "typical builder contract",
      allowed_files: ["src/example.ts"],
      acceptance: ["npm test exits 0"],
      constraints: ["One task only", "Do not mark Accepted"],
    }),
  );
  return {
    host_binary: null,
    host_version: null,
    stub: /stub|fake/i.test(reason),
    unmeasured: true,
    allow_stub: allowStub,
    wall_ms: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    cache_read_tokens: null,
    request_duration_ms: null,
    exec_duration_ms: null,
    thinking_duration_ms: null,
    output_tps: null,
    wall_tps: null,
    first_token_ms: null,
    model: null,
    our_prompt_chars: probe.chars,
    our_prompt_est_tokens: probe.est_tokens,
    builder_prompt_chars: builder.chars,
    builder_prompt_est_tokens: builder.est_tokens,
    reason: TPS_UNMEASURED,
  };
}

export async function runDoctorTps(opts: { allowStub?: boolean } = {}): Promise<TpsReport> {
  const allowStub = Boolean(opts.allowStub);
  const stub = isStubHost();
  if (!mcodeExists()) {
    return unmeasuredReport("mcode missing", allowStub);
  }
  if (stub && !allowStub) {
    const report = unmeasuredReport("stub host", allowStub);
    report.host_binary = resolveMcodeInvocation().command;
    report.stub = true;
    persistTps(report);
    return report;
  }
  const client = new ProcessMcode();
  const prompt = tpsProbePrompt();
  const result = await client.exec({
    cwd: process.cwd(),
    prompt,
    role: "explorer",
    permission: "off",
    maxSteps: 1,
    timeoutMs: 30_000,
  });
  const report = tpsFromExec(result, prompt, { stub, allowStub });
  if (stub) {
    report.unmeasured = true;
    report.output_tps = null;
    report.wall_tps = null;
    report.input_tokens = null;
    report.output_tokens = null;
    report.total_tokens = null;
    report.cache_read_tokens = null;
    report.request_duration_ms = null;
    report.exec_duration_ms = null;
    report.thinking_duration_ms = null;
    report.model = null;
    report.reason = TPS_UNMEASURED;
  }
  persistTps(report);
  return report;
}

export function formatTps(report: TpsReport): string {
  const lines = [
    `oh-my-mcode tps ${report.unmeasured ? TPS_UNMEASURED : "ok"}`,
    `  host_binary: ${report.host_binary ?? "null"}`,
    `  host_version: ${report.host_version ?? "null"}`,
    `  wall_ms: ${report.wall_ms ?? "null"}`,
    `  input_tokens: ${report.input_tokens ?? "null"}`,
    `  output_tokens: ${report.output_tokens ?? "null"}`,
    `  total_tokens: ${report.total_tokens ?? "null"}`,
    `  cache_read_tokens: ${report.cache_read_tokens ?? "null"}`,
    `  request_duration_ms: ${report.request_duration_ms ?? "null"}`,
    `  exec_duration_ms: ${report.exec_duration_ms ?? "null"}`,
    `  thinking_duration_ms: ${report.thinking_duration_ms ?? "null"}`,
    `  output_tps: ${report.output_tps ?? "null"}`,
    `  wall_tps: ${report.wall_tps ?? "null"}`,
    `  first_token_ms: ${report.first_token_ms ?? "null"}`,
    `  model: ${report.model ? `${report.model.providerId || "?"}/${report.model.modelId || "?"}${report.model.variant ? ` (${report.model.variant})` : ""}` : "null"}`,
    `  our_prompt_chars: ${report.our_prompt_chars}`,
    `  our_prompt_est_tokens: ${report.our_prompt_est_tokens}`,
    `  builder_prompt_chars: ${report.builder_prompt_chars}`,
    `  builder_prompt_est_tokens: ${report.builder_prompt_est_tokens}`,
  ];
  if (report.reason) lines.push(`  reason: ${report.reason}`);
  return lines.join("\n");
}

export { estimateTokens };
