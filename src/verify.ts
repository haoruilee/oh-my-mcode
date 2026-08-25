import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AcceptanceItem, FindingItem, Findings, Role } from "./types.js";
import type { RunStore } from "./store.js";
import type { ExecResult, McodeClient } from "./mcode.js";
import { nowIso } from "./util.js";
import { verifierPrompt } from "./prompts.js";
import { staleFileHashes } from "./hash.js";

export interface DetectedCommands {
  test?: string;
  build?: string;
  source: string;
}

function readIf(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export function detectProjectCommands(workspace: string): DetectedCommands {
  const pkgPath = path.join(workspace, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      return {
        test: pkg.scripts?.test ? "npm test" : undefined,
        build: pkg.scripts?.build ? "npm run build" : undefined,
        source: "package.json",
      };
    } catch {
      // fall through
    }
  }
  if (existsSync(path.join(workspace, "go.mod"))) {
    return { test: "go test ./...", source: "go.mod" };
  }
  if (existsSync(path.join(workspace, "Cargo.toml"))) {
    return { test: "cargo test", build: "cargo build", source: "Cargo.toml" };
  }
  if (
    existsSync(path.join(workspace, "pytest.ini")) ||
    existsSync(path.join(workspace, "pyproject.toml")) ||
    existsSync(path.join(workspace, "tests"))
  ) {
    const pyproject = readIf(path.join(workspace, "pyproject.toml")) || "";
    if (pyproject.includes("pytest") || existsSync(path.join(workspace, "pytest.ini"))) {
      return { test: "pytest", source: "pytest" };
    }
  }
  if (existsSync(path.join(workspace, "Makefile"))) {
    const make = readIf(path.join(workspace, "Makefile")) || "";
    if (/^test:/m.test(make)) return { test: "make test", source: "Makefile" };
  }
  return { source: "none" };
}

export async function runCaptured(
  command: string,
  cwd: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = `$ ${command}\n`;
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

export interface DeterministicResult {
  acceptance: AcceptanceItem[];
  findings: FindingItem[];
  commands: string[];
}

export async function runDeterministicVerify(
  store: RunStore,
  runId: string,
  workspace: string,
): Promise<DeterministicResult> {
  const tasks = store.loadTasks(runId);
  const detected = detectProjectCommands(workspace);
  const acceptance: AcceptanceItem[] = [];
  const findings: FindingItem[] = [];
  const commands: string[] = [];
  let n = 1;

  const planned = tasks.acceptance.filter((item) => item.command);
  const toRun =
    planned.length > 0
      ? planned.map((item) => ({ item, command: item.command as string, kind: item.kind || "test" }))
      : [
          ...(detected.test
            ? [{ item: undefined, command: detected.test, kind: "test" as const }]
            : []),
          ...(detected.build
            ? [{ item: undefined, command: detected.build, kind: "build" as const }]
            : []),
        ];

  const writtenEvidence: string[] = [];

  if (toRun.length === 0) {
    acceptance.push({
      id: "A1",
      criterion: "Automated test or build command was detected and passed.",
      kind: "test",
      result: "untested",
    });
    findings.push({
      id: "F1",
      severity: "blocker",
      title: "No automated test/build command detected",
      detail: "Cannot Accept without a runnable test or build. Add package.json#scripts.test or an equivalent.",
      class: "no_test",
    });
    store.writeTextEvidence(runId, "log", "no-test-command.txt", `detect=${detected.source}\n`, {
      notes: "no automated command",
    });
    writtenEvidence.push("evidence/no-test-command.txt");
    return { acceptance, findings, commands };
  }

  for (const row of toRun) {
    const id = row.item?.id || `A${n}`;
    n += 1;
    commands.push(row.command);
    const result = await runCaptured(row.command, workspace);
    const rel = `${id}-${row.kind}.log`;
    store.writeTextEvidence(runId, row.kind === "build" ? "command" : "test", rel, result.output, {
      command: row.command,
      exit_code: result.exitCode,
    });
    writtenEvidence.push(`evidence/${rel}`);
    const pass = result.exitCode === 0;
    acceptance.push({
      id,
      criterion: row.item?.criterion || `Command succeeds: ${row.command}`,
      kind: row.kind === "build" ? "build" : "test",
      command: row.command,
      result: pass ? "pass" : "fail",
      evidence: [`evidence/${rel}`],
    });
    if (!pass) {
      const title = `Command failed: ${row.command}`;
      findings.push({
        id: `F${findings.length + 1}`,
        severity: "blocker",
        title,
        detail: result.output.slice(-4000),
        evidence: [`evidence/${rel}`],
        class: "command_failed",
      });
    }
  }

  const justWritten = new Set(writtenEvidence);
  const staleEvidence = store.staleEvidence(runId);
  const staleJustWritten = staleEvidence.filter((item) => justWritten.has(item.path));
  if (staleJustWritten.length > 0) {
    store.refreshEvidenceHashes(
      runId,
      staleJustWritten.map((item) => item.path),
    );
  }
  const leftoverEvidence = staleEvidence.filter((item) => !justWritten.has(item.path));
  const staleWorkspace = staleFileHashes(workspace, store.loadFileHashes(runId));
  for (const stale of [...leftoverEvidence, ...staleWorkspace]) {
    const title = `Stale content hash: ${stale.path}`;
    findings.push({
      id: `F${findings.length + 1}`,
      severity: "blocker",
      title,
      detail: `recorded ${stale.expected} live ${stale.actual || "missing"} — do not Accept; re-run tests`,
      evidence: [stale.path],
      class: "stale_workspace",
    });
  }

  return { acceptance, findings, commands };
}

export function findingsFromDeterministic(
  runId: string,
  det: DeterministicResult,
  extra: FindingItem[] = [],
): Findings {
  const findings = [...det.findings, ...extra];
  const allPass = det.acceptance.length > 0 && det.acceptance.every((item) => item.result === "pass");
  const blockers = findings.filter((item) => item.severity === "blocker" || item.severity === "major");
  const verdict = allPass && blockers.length === 0 ? "accepted" : "rejected";
  return {
    run_id: runId,
    verdict,
    checked_at: nowIso(),
    summary:
      verdict === "accepted"
        ? `Deterministic checks passed: ${det.commands.join(", ") || "ok"}`
        : `Rejected: ${findings[0]?.title || "acceptance failed"}`,
    acceptance: det.acceptance,
    findings,
  };
}

export async function optionalLlmJudge(
  client: McodeClient,
  workspace: string,
  role: Role,
  prompt: string,
  permission: "ask" | "off" | "smart" | "full",
): Promise<ExecResult> {
  return client.exec({
    cwd: workspace,
    prompt,
    role,
    permission,
  });
}

export function judgePrompt(goal: string, plan: string, det: DeterministicResult): string {
  return verifierPrompt({
    goal,
    plan,
    acceptance: det.acceptance.map((item) => `${item.id} ${item.result}: ${item.criterion}`),
    commands: det.commands,
  });
}
