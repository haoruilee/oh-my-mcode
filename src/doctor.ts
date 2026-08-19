import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageRoot, which } from "./util.js";
import { pluginInstallDir } from "./install.js";
import { RunStore } from "./store.js";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  level: "error" | "warn" | "note";
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  packageOk: boolean;
  hostOk: boolean;
  checks: DoctorCheck[];
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function nodeMajor(): number {
  return Number(process.versions.node.split(".")[0]);
}

function parseMcodeVersion(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+)/);
  return match?.[1];
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n));
  const pb = b.split(".").map((n) => Number(n));
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function runDoctor(opts: { packageOnly?: boolean } = {}): DoctorReport {
  const root = packageRoot();
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);

  add({
    id: "node",
    ok: nodeMajor() >= 22,
    level: nodeMajor() >= 22 ? "note" : "error",
    message: `Node ${process.versions.node} (need >= 22)`,
  });

  const officialPath = path.join(root, ".minimax-plugin/plugin.json");
  const portablePath = path.join(root, "plugin.json");
  const official = existsSync(officialPath) ? (readJson(officialPath) as { skills?: string[]; name?: string; version?: string }) : null;
  const portable = existsSync(portablePath) ? (readJson(portablePath) as { name?: string; version?: string }) : null;
  add({
    id: "manifests",
    ok: Boolean(official && portable && official.name === "oh-my-mcode" && portable.name === "oh-my-mcode"),
    level: "error",
    message: official && portable ? "dual manifests present and named oh-my-mcode" : "dual manifests missing or inconsistent",
  });

  const skills = official?.skills || [];
  const missingSkills = skills.filter((rel) => !existsSync(path.join(root, rel)));
  add({
    id: "skills",
    ok: missingSkills.length === 0 && skills.length === 5,
    level: "error",
    message:
      missingSkills.length === 0
        ? `skills present: ${skills.join(", ")}`
        : `missing skills: ${missingSkills.join(", ")}`,
  });

  for (const rel of skills) {
    const text = existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), "utf8") : "";
    const name = text.match(/^name:\s*(\S+)/m)?.[1];
    const dir = rel.split("/")[1];
    add({
      id: `frontmatter:${dir}`,
      ok: Boolean(name && name === dir && /do not/i.test(text)),
      level: "error",
      message: name === dir ? `${rel} frontmatter ok` : `${rel} frontmatter name mismatch or missing near-misses`,
    });
  }

  add({
    id: "src",
    ok: ["cli.ts", "orchestrator.ts", "mcode.ts", "verify.ts", "store.ts", "doctor.ts"].every((name) =>
      existsSync(path.join(root, "src", name)),
    ),
    level: "error",
    message: "TypeScript orchestrator sources present",
  });

  try {
    const tmp = path.join(os.tmpdir(), `omm-doctor-${process.pid}`);
    const store = new RunStore(tmp);
    const run = store.create("doctor write probe");
    store.setPhase(run.run_id, "DISCOVER");
    add({
      id: "run-store",
      ok: existsSync(path.join(store.dir(run.run_id), "run.json")),
      level: "error",
      message: "run store can create a workspace run",
    });
  } catch (error) {
    add({
      id: "run-store",
      ok: false,
      level: "error",
      message: `run store write failed: ${(error as Error).message}`,
    });
  }

  const installed = pluginInstallDir();
  add({
    id: "plugin-install",
    ok: existsSync(path.join(installed, "plugin.json")),
    level: "warn",
    message: existsSync(path.join(installed, "plugin.json"))
      ? `local plugin at ${installed}`
      : `plugin not copied to ${installed} (run oh-my-mcode install)`,
  });

  if (!opts.packageOnly) {
    const mcode = which("mcode") || process.env.OMM_MCODE;
    if (!mcode) {
      add({
        id: "mcode",
        ok: false,
        level: "error",
        message: "mcode is not on PATH. Install @minimax-ai/code 0.1.6+.",
      });
    } else {
      let versionText = "";
      try {
        versionText = execFileSync(mcode.endsWith(".mjs") ? process.execPath : mcode, mcode.endsWith(".mjs") ? [mcode, "--version"] : ["--version"], {
          encoding: "utf8",
        });
      } catch (error) {
        versionText = (error as Error).message;
      }
      const version = parseMcodeVersion(versionText) || "unknown";
      const old = version !== "unknown" && cmpSemver(version, "0.1.6") < 0;
      add({
        id: "mcode",
        ok: !old,
        level: old ? "error" : "note",
        message: old
          ? `mcode ${version} is older than tested 0.1.6`
          : `mcode ${version} at ${mcode}`,
      });
    }
    add({
      id: "skill-index-api",
      ok: true,
      level: "note",
      message:
        "No public host API lists indexed Skills. If plugin list shows installed+enabled, files exist; triggering is not proven.",
    });
  }

  const packageOk = checks.filter((c) => c.level === "error" && !c.id.startsWith("mcode") && c.id !== "plugin-install").every((c) => c.ok);
  const hostOk = checks.filter((c) => c.id === "mcode").every((c) => c.ok);
  const ok = opts.packageOnly ? packageOk : packageOk && hostOk;
  return { ok, packageOk, hostOk, checks };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [`oh-my-mcode doctor ${report.ok ? "PASS" : "FAIL"}`];
  for (const check of report.checks) {
    const tag = check.ok ? "ok" : check.level;
    lines.push(`  ${tag.padEnd(5)} ${check.id}: ${check.message}`);
  }
  return lines.join("\n");
}
