#!/usr/bin/env node
/**
 * Static + smoke checks for the oh-my-mcode plugin tree.
 * No network. No telemetry. Exit 0 only when the package is internally consistent.
 *
 *   node scripts/doctor.mjs
 *   node scripts/doctor.mjs --json
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");

const errors = [];
const warnings = [];
const notes = [];

function err(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}
function note(message) {
  notes.push(message);
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function readJson(rel) {
  try {
    return JSON.parse(read(rel));
  } catch (error) {
    err(`${rel}: invalid JSON (${error.message})`);
    return null;
  }
}

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.isSymbolicLink()) {
      err(`symlink not allowed in package: ${path.relative(ROOT, full)}`);
      continue;
    }
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function parseFrontmatter(text, rel) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    err(`${rel}: missing YAML frontmatter`);
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    err(`${rel}: unclosed YAML frontmatter`);
    return null;
  }
  const raw = text.slice(4, end).replace(/\r/g, "");
  const data = {};
  let key = null;
  let multiline = false;
  let buf = [];
  const flush = () => {
    if (key && multiline) data[key] = buf.join("\n").replace(/^\n/, "").trimEnd();
    key = null;
    multiline = false;
    buf = [];
  };
  for (const line of raw.split("\n")) {
    if (multiline) {
      if (line === "" || line.startsWith("  ") || line.startsWith("\t")) {
        buf.push(line.replace(/^  /, ""));
        continue;
      }
      flush();
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, k, v] = match;
    if (v === "|" || v === ">" || v === "|-" || v === ">-") {
      key = k;
      multiline = true;
      buf = [];
    } else {
      data[k] = v.replace(/^['"]|['"]$/g, "");
    }
  }
  flush();
  return data;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateSchema(schema, value, loc, acc) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok =
      types.includes(actual) ||
      (types.includes("integer") && Number.isInteger(value)) ||
      (types.includes("number") && typeof value === "number");
    if (!ok) {
      acc.push(`${loc}: expected ${types.join("|")}, got ${actual}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    acc.push(`${loc}: ${JSON.stringify(value)} not in enum`);
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    acc.push(`${loc}: does not match ${schema.pattern}`);
  }
  if (schema.minLength && typeof value === "string" && value.length < schema.minLength) {
    acc.push(`${loc}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.minItems && Array.isArray(value) && value.length < schema.minItems) {
    acc.push(`${loc}: fewer than minItems ${schema.minItems}`);
  }
  if (schema.required && value && typeof value === "object") {
    for (const key of schema.required) {
      if (!(key in value)) acc.push(`${loc}: missing required ${key}`);
    }
  }
  if (schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in value) validateSchema(child, value[key], `${loc}.${key}`, acc);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties[key]) acc.push(`${loc}: unexpected property ${key}`);
      }
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validateSchema(schema.items, item, `${loc}[${i}]`, acc));
  }
}

function checkManifests() {
  const official = readJson(".minimax-plugin/plugin.json");
  const portable = readJson("plugin.json");
  if (!official || !portable) return;

  if (portable.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") {
    err("plugin.json: $schema must be Agent Plugins 1.0");
  }
  if (official.schemaVersion !== 1) err(".minimax-plugin/plugin.json: schemaVersion must be 1");
  if (official.name !== "oh-my-mcode" || portable.name !== "oh-my-mcode") {
    err("plugin name must be oh-my-mcode in both manifests");
  }
  if (official.version !== portable.version) {
    err(`version mismatch: official ${official.version} vs portable ${portable.version}`);
  }
  if (official.description !== portable.description) {
    err("description mismatch between manifests");
  }
  if (official.author !== "haoruilee") err(".minimax-plugin/plugin.json author must be haoruilee");
  if (!portable.author || portable.author.name !== "haoruilee") {
    err("plugin.json author.name must be haoruilee");
  }
  if (official.icon !== "icon.png") err("official manifest icon must be icon.png");
  if (!existsSync(path.join(ROOT, "icon.png"))) err("icon.png is missing");
  if (!Array.isArray(official.apps) || official.apps.length !== 0) {
    err("official manifest apps must be [] — Apps are not a public plugin capability");
  }
  if (!Array.isArray(official.mcpServers) || official.mcpServers.length === 0) {
    err("official manifest mcpServers must list mcp.json");
  } else if (!official.mcpServers.includes("mcp.json")) {
    err("official manifest mcpServers must include mcp.json");
  }
  const mcp = readJson("mcp.json");
  if (!mcp) {
    err("mcp.json is missing or invalid");
  } else {
    const server = mcp.mcpServers && mcp.mcpServers["oh-my-mcode"];
    if (!server) err("mcp.json must declare mcpServers.oh-my-mcode");
    else {
      if (server.type !== "stdio") err("mcp.json oh-my-mcode.type must be stdio");
      if (server.command !== "node") err("mcp.json oh-my-mcode.command must be node");
      const args = Array.isArray(server.args) ? server.args.join(" ") : "";
      if (!args.includes("mcp/server.mjs")) err("mcp.json args must point at ./mcp/server.mjs");
      if (server.env && (server.env.PLUGIN_ROOT || server.env.PLUGIN_DATA)) {
        err("mcp.json must not set PLUGIN_ROOT or PLUGIN_DATA");
      }
    }
  }
  if (!existsSync(path.join(ROOT, "mcp/server.mjs"))) err("mcp/server.mjs is missing");
  else note("MCP server mcp/server.mjs present");
  if (!Array.isArray(official.skills) || official.skills.length === 0) {
    err("official manifest must list skills");
    return;
  }
  const listed = new Set(official.skills);
  const skillDirs = readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const rel of official.skills) {
    if (!existsSync(path.join(ROOT, rel))) err(`listed skill missing: ${rel}`);
  }
  for (const name of skillDirs) {
    const rel = `skills/${name}/SKILL.md`;
    if (!listed.has(rel)) err(`skill directory ${name} is not listed in .minimax-plugin/plugin.json`);
  }
  note(`skills listed: ${official.skills.join(", ")}`);
}

function checkSkills() {
  const skillRoot = path.join(ROOT, "skills");
  if (!existsSync(skillRoot)) {
    err("skills/ is missing");
    return;
  }
  for (const name of readdirSync(skillRoot)) {
    const rel = `skills/${name}/SKILL.md`;
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) continue;
    const text = read(rel);
    const fm = parseFrontmatter(text, rel);
    if (!fm) continue;
    if (fm.name !== name) err(`${rel}: frontmatter name '${fm.name}' != directory '${name}'`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      err(`${rel}: skill name must be kebab-case and <= 64 chars`);
    }
    if (!fm.description || fm.description.trim().length < 40) {
      err(`${rel}: description is missing or too short`);
    } else {
      const desc = fm.description.toLowerCase();
      const hasTrigger =
        desc.includes("trigger") ||
        desc.includes("use when") ||
        desc.includes("when the user") ||
        desc.includes("max mode") ||
        desc.includes("verify") ||
        desc.includes("resume") ||
        desc.includes("doctor");
      const hasNearMiss =
        desc.includes("do not") ||
        desc.includes("don't") ||
        desc.includes("not trigger") ||
        desc.includes("near-miss") ||
        desc.includes("must not");
      if (!hasTrigger) err(`${rel}: description must include concrete triggers`);
      if (!hasNearMiss) err(`${rel}: description must include near-misses that must NOT trigger`);
    }
    if (/\n##?\s+when to use/i.test(text)) {
      err(`${rel}: do not put a When to use section in the body; keep it in description`);
    }
  }
}

function checkRolesAndWorkflows() {
  const roles = ["explorer", "planner", "builder", "verifier", "release"];
  for (const role of roles) {
    const rel = `agents/${role}.md`;
    if (!existsSync(path.join(ROOT, rel))) err(`missing role contract: ${rel}`);
  }
  for (const name of ["max.yaml", "plan.yaml", "verify.yaml", "review.yaml", "ship.yaml", "research.yaml", "team.yaml"]) {
    const rel = `workflows/${name}`;
    if (!existsSync(path.join(ROOT, rel))) err(`missing workflow: ${rel}`);
  }
  const requiredDocs = [
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "docs/host-reality.md",
    "docs/architecture.md",
    "docs/host-reality.zh-CN.md",
    "docs/architecture.zh-CN.md",
    "docs/roadmap.md",
  ];
  for (const rel of requiredDocs) {
    if (!existsSync(path.join(ROOT, rel))) err(`missing ${rel}`);
  }
}

function loadSchemas() {
  const names = [
    "run-event.schema.json",
    "task-contract.schema.json",
    "finding.schema.json",
    "evidence.schema.json",
    "planner-output.schema.json",
  ];
  const schemas = {};
  for (const name of names) {
    const rel = `schemas/${name}`;
    const schema = readJson(rel);
    if (!schema) continue;
    if (schema.type !== "object") err(`${rel}: root type must be object`);
    if (!schema.required || !schema.properties) err(`${rel}: must declare required + properties`);
    schemas[name] = schema;
  }
  return schemas;
}

function checkSampleRun(schemas) {
  const sample = path.join(ROOT, "examples/sample-run");
  if (!existsSync(sample)) {
    err("examples/sample-run/ is missing");
    return;
  }
  const run = JSON.parse(readFileSync(path.join(sample, "run.json"), "utf8"));
  if (run.status !== "accepted" || run.phase !== "ACCEPT") {
    err("sample run must be an Accepted snapshot (status=accepted, phase=ACCEPT)");
  }
  const findings = JSON.parse(readFileSync(path.join(sample, "findings.json"), "utf8"));
  const tasks = JSON.parse(readFileSync(path.join(sample, "tasks.json"), "utf8"));
  const evidenceIndex = JSON.parse(readFileSync(path.join(sample, "evidence/index.json"), "utf8"));
  const events = readFileSync(path.join(sample, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        err(`examples/sample-run/events.jsonl:${i + 1} ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);

  const acc = [];
  if (schemas["finding.schema.json"]) {
    validateSchema(schemas["finding.schema.json"], findings, "sample.findings", acc);
  }
  if (schemas["task-contract.schema.json"]) {
    validateSchema(schemas["task-contract.schema.json"], tasks, "sample.tasks", acc);
  }
  if (schemas["run-event.schema.json"]) {
    for (const [i, event] of events.entries()) {
      validateSchema(schemas["run-event.schema.json"], event, `sample.events[${i}]`, acc);
    }
  }
  if (schemas["evidence.schema.json"]) {
    for (const [i, item] of evidenceIndex.items.entries()) {
      validateSchema(schemas["evidence.schema.json"], item, `sample.evidence[${i}]`, acc);
    }
  }
  const types = new Set(events.map((event) => event.type));
  for (const required of ["run_created", "run_accepted"]) {
    if (!types.has(required)) err(`sample run events.jsonl missing ${required}`);
  }
  if (findings.verdict !== "accepted") err("sample findings verdict must be accepted");
  if (!existsSync(path.join(sample, "summary.md"))) err("sample run missing summary.md");
  for (const message of acc) err(message);
}

function smokeRunStore() {
  const store = path.join(ROOT, "scripts/run-store.mjs");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "omm-doctor-"));
  try {
    const createdRaw = execFileSync(
      process.execPath,
      [store, "create", "--workspace", tmp, "--goal", "doctor smoke: prove run store writes atomically"],
      { encoding: "utf8" },
    );
    const created = JSON.parse(createdRaw);
    if (!created.run_id || created.phase !== "INTAKE") {
      err("run-store create did not return an INTAKE run");
      return;
    }
    execFileSync(
      process.execPath,
      [store, "set-phase", "--workspace", tmp, "--run-id", created.run_id, "--phase", "VERIFY"],
      { encoding: "utf8" },
    );
    const evidenceSrc = path.join(tmp, "probe.log");
    writeFileSync(evidenceSrc, "doctor probe\n");
    execFileSync(
      process.execPath,
      [
        store,
        "add-evidence",
        "--workspace",
        tmp,
        "--run-id",
        created.run_id,
        "--kind",
        "log",
        "--path",
        evidenceSrc,
        "--command",
        "doctor-probe",
        "--exit-code",
        "0",
      ],
      { encoding: "utf8" },
    );
    const findingsPath = path.join(tmp, "findings.in.json");
    writeFileSync(
      findingsPath,
      `${JSON.stringify(
        {
          run_id: created.run_id,
          verdict: "accepted",
          checked_at: new Date().toISOString(),
          summary: "Smoke acceptance from doctor.mjs",
          acceptance: [
            {
              id: "A1",
              criterion: "Run store can persist an Accepted verdict.",
              result: "pass",
              evidence: [],
            },
          ],
          findings: [],
        },
        null,
        2,
      )}\n`,
    );
    const written = JSON.parse(
      execFileSync(
        process.execPath,
        [store, "write-findings", "--workspace", tmp, "--run-id", created.run_id, "--file", findingsPath],
        { encoding: "utf8" },
      ),
    );
    if (written.run?.status !== "accepted") err("run-store write-findings did not Accept the smoke run");
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [store, "evidence-report", "--workspace", tmp, "--run-id", created.run_id],
        { encoding: "utf8" },
      ),
    );
    if (!existsSync(report.path)) err("evidence-report did not write summary.md");
    note(`run-store smoke ok (${created.run_id})`);
  } catch (error) {
    err(`run-store smoke failed: ${error.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function checkCliPackage() {
  const pkg = readJson("package.json");
  if (!pkg) return;
  if (!pkg.bin || pkg.bin["oh-my-mcode"] !== "bin/oh-my-mcode.mjs" || pkg.bin.omm !== "bin/oh-my-mcode.mjs") {
    err("package.json must expose bins oh-my-mcode and omm");
  }
  for (const name of [
    "cli.ts",
    "orchestrator.ts",
    "mcode.ts",
    "verify.ts",
    "store.ts",
    "doctor.ts",
    "hud.ts",
    "team.ts",
    "inspect.ts",
    "config.ts",
    "worktree.ts",
    "tool-repair.ts",
    "session.ts",
  ]) {
    if (!existsSync(path.join(ROOT, "src", name))) err(`missing src/${name}`);
  }
  const bin = path.join(ROOT, "bin/oh-my-mcode.mjs");
  if (!existsSync(bin)) err("missing bin/oh-my-mcode.mjs");
  try {
    const help = execFileSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
    for (const cmd of [
      "max",
      "plan",
      "verify",
      "resume",
      "review",
      "ship",
      "research",
      "attach",
      "status",
      "cancel",
      "inspect",
      "team",
      "doctor",
      "install",
    ]) {
      if (!help.includes(cmd)) err(`CLI --help missing ${cmd}`);
    }
    note("CLI --help lists max plan verify resume review ship research attach status cancel inspect team doctor install");
  } catch (error) {
    err(`CLI --help failed: ${error.message}`);
  }
}

function installSection(readme) {
  for (const marker of ["## Installation", "## Install"]) {
    if (!readme.includes(marker)) continue;
    return readme.split(marker)[1]?.split("\n## ")[0] || "";
  }
  return "";
}

function checkHonesty() {
  const readme = read("README.md");
  if (
    !readme.includes("not a registered") &&
    !readme.includes("no registered") &&
    !readme.includes("not a registered `/max`")
  ) {
    err("README must say /max is not a registered host command");
  }
  if (!readme.includes('oh-my-mcode max "fix the failing auth tests and prove they pass"')) {
    err("README must include the hero oh-my-mcode max command");
  }
  if (!readme.includes("coexist")) err("README must say we coexist with host /plan /goal");
  if (
    !/do not replace|don't replace|We do not replace|we don't replace/i.test(readme)
  ) {
    err("README must say we do not replace host Plan Mode");
  }
  if (
    !readme.includes("MiniMax-AI/skills") ||
    !/do \*\*not\*\* install|Do \*\*not\*\* install|not install this from|Don't install this from/i.test(
      readme,
    )
  ) {
    err("README must warn not to install via MiniMax-AI/skills");
  }
  const installBlock = installSection(readme);
  if (
    !installBlock.includes("npm install") ||
    !installBlock.includes("npm link") ||
    !installBlock.includes("oh-my-mcode doctor") ||
    !installBlock.includes("oh-my-mcode install")
  ) {
    err("README install must be clone → npm install → npm link → oh-my-mcode doctor → oh-my-mcode install");
  }
  if (/\bmmx\b/.test(installBlock) || /\bmavis\b/.test(installBlock)) {
    err("README install steps must not mention mmx or mavis");
  }
  if (!readme.includes("0.1.6")) warn("README should mention tested host version 0.1.6");
  if (!readme.includes("~/.minimax/plugins")) err("README must document drop-in local install path");
  note("mcode plugin list --json and mcode --version are the host inspect commands that exist today.");
  note("There is no public host API that lists which Skills were indexed. doctor cannot prove indexation.");
}

function main() {
  walkFiles(ROOT);
  checkManifests();
  checkSkills();
  checkRolesAndWorkflows();
  const schemas = loadSchemas();
  checkSampleRun(schemas);
  checkCliPackage();
  smokeRunStore();
  checkHonesty();

  const report = {
    plugin: "oh-my-mcode",
    version: "0.1.0",
    ok: errors.length === 0,
    errors,
    warnings,
    notes,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`oh-my-mcode doctor ${report.ok ? "PASS" : "FAIL"}\n`);
    for (const message of errors) process.stdout.write(`  error: ${message}\n`);
    for (const message of warnings) process.stdout.write(`  warn:  ${message}\n`);
    for (const message of notes) process.stdout.write(`  note:  ${message}\n`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
