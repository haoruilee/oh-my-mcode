import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CliError, packageRoot, which } from "./util.js";
import { pluginInstallDir } from "./install.js";
import { mcodeExists, resolveMcodeInvocation } from "./mcode.js";
import { RunStore } from "./store.js";
import { ROLES, type Role } from "./types.js";
import { loadConfig } from "./config.js";
import {
  formatHostCapabilities,
  hostCapabilities,
  parseHostVersion,
} from "./host-version.js";

export const INSPECT_TOPICS = ["tools", "skills", "agents", "context", "runs", "model-policy"] as const;
export type InspectTopic = (typeof INSPECT_TOPICS)[number];

const RUN_LEAVES: Record<string, string> = {
  findings: "findings.json",
  evidence: "evidence/index.json",
  events: "events.jsonl",
  plan: "plan.md",
  tasks: "tasks.json",
  summary: "summary.md",
  yield: "file-hashes.json",
};

export function parseRunAddress(value: string): { runId: string; leaf: string } | undefined {
  const match = /^run:\/\/(run_[A-Za-z0-9]+)(?:\/([A-Za-z0-9._-]+))?$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  return { runId: match[1], leaf: match[2] || "findings" };
}

export function runAddress(runId: string, leaf: keyof typeof RUN_LEAVES | string): string {
  return `run://${runId}/${leaf}`;
}

export interface InspectResult {
  topic: InspectTopic;
  ok: boolean;
  error?: string;
  data: unknown;
}

export const ROLE_CONTRACTS: Record<
  Role,
  { file: string; permission: string; may: string[]; mustNot: string[] }
> = {
  explorer: {
    file: "agents/explorer.md",
    permission: "ask (never full — read-only discovery)",
    may: ["Read/search", "Diagnostic commands"],
    mustNot: ["Edit product files", "Mark Accepted", "Spawn sub-agents"],
  },
  planner: {
    file: "agents/planner.md",
    permission: "ask (plan artifacts only)",
    may: ["Write plan.md / tasks.json via the run store"],
    mustNot: ["Edit product code", "Start EXECUTE", "Mark Accepted"],
  },
  builder: {
    file: "agents/builder.md",
    permission: "configured permission (default smart)",
    may: ["Edit files for the current task", "Run cheap tests"],
    mustNot: ["Mark Accepted", "Spawn grandchild agents", "Scope-creep extra tasks"],
  },
  verifier: {
    file: "agents/verifier.md",
    permission: "ask (read-only judge; deterministic verify is TypeScript)",
    may: ["Read diffs", "Write findings.json / evidence"],
    mustNot: ["Edit product code", "Accept without evidence files"],
  },
  release: {
    file: "agents/release.md",
    permission: "ask / user git (ship never force-pushes)",
    may: ["Write release notes", "Suggest git/PR commands after Accepted"],
    mustNot: ["Ship a non-accepted run", "Mark Accepted"],
  },
};

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function inspectSkills(root = packageRoot()): {
  listed: string[];
  present: string[];
  missing: string[];
  extra: string[];
  ok: boolean;
  error?: string;
} {
  const officialPath = path.join(root, ".minimax-plugin/plugin.json");
  if (!existsSync(officialPath)) {
    return {
      listed: [],
      present: [],
      missing: [],
      extra: [],
      ok: false,
      error: "configured but invisible: .minimax-plugin/plugin.json missing",
    };
  }
  const official = readJson(officialPath) as { skills?: string[] };
  const listed = official.skills || [];
  const missing = listed.filter((rel) => !existsSync(path.join(root, rel)));
  const skillDirs = existsSync(path.join(root, "skills"))
    ? readdirSync(path.join(root, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `skills/${entry.name}/SKILL.md`)
    : [];
  const extra = skillDirs.filter((rel) => !listed.includes(rel));
  const present = listed.filter((rel) => existsSync(path.join(root, rel)));
  const ok = missing.length === 0 && extra.length === 0 && listed.length > 0;
  return {
    listed,
    present,
    missing,
    extra,
    ok,
    error: !ok
      ? missing.length > 0
        ? `configured but invisible: manifest lists skills that are missing on disk: ${missing.join(", ")}`
        : extra.length > 0
          ? `configured but invisible: skill directories not listed in manifest: ${extra.join(", ")}`
          : "configured but invisible: official manifest lists no skills"
      : undefined,
  };
}

function inspectTools(): InspectResult {
  const onPath = Boolean(which("mcode") || process.env.OMM_MCODE);
  let invocation: { command: string; prefixArgs: string[] } | undefined;
  try {
    invocation = resolveMcodeInvocation();
  } catch {
    invocation = undefined;
  }
  let pluginList: unknown = null;
  let pluginListError: string | undefined;
  if (onPath && invocation) {
    try {
      const args = [...invocation.prefixArgs, "plugin", "list", "--json"];
      const text = execFileSync(invocation.command, args, { encoding: "utf8", timeout: 8000 });
      try {
        pluginList = JSON.parse(text);
      } catch {
        pluginList = text.trim();
      }
    } catch (error) {
      pluginListError = (error as Error).message;
    }
  }
  return {
    topic: "tools",
    ok: true,
    data: {
      mcode_on_path: onPath,
      mcode_exists: mcodeExists(),
      invocation: invocation || null,
      plugin_list_json: pluginList,
      plugin_list_error: pluginListError,
      note: "No public host API lists indexed Skills. plugin list is the inspect surface that exists.",
    },
  };
}

function inspectAgents(root = packageRoot()): InspectResult {
  const agents = ROLES.map((role) => {
    const contract = ROLE_CONTRACTS[role];
    const filePath = path.join(root, contract.file);
    return {
      role,
      ...contract,
      on_disk: existsSync(filePath),
    };
  });
  const ok = agents.every((item) => item.on_disk);
  return {
    topic: "agents",
    ok,
    error: ok ? undefined : "one or more role contracts missing on disk",
    data: {
      note: "These are role contracts for the same host agent. We do not register custom plugin agents.",
      agents,
    },
  };
}

function inspectContext(workspace: string, runId?: string): InspectResult {
  const store = new RunStore(workspace);
  const id = store.resolveId(runId);
  const run = store.load(id);
  const tasks = store.loadTasks(id);
  const evidence = store.loadEvidence(id);
  const events = store.loadEvents(id);
  const phases = [...new Set(events.filter((event) => event.type === "phase_changed").map((event) => event.phase))];
  return {
    topic: "context",
    ok: true,
    data: {
      run_id: run.run_id,
      goal: run.goal,
      phase: run.phase,
      status: run.status,
      phases_seen: phases,
      tasks: tasks.tasks.map((task) => ({ id: task.id, title: task.title, role: task.role, status: task.status })),
      evidence_files: evidence.items.length,
      event_count: events.length,
      path: store.dir(id),
      host_session_id: run.host_session_id || null,
      host_continue: Boolean(run.host_continue),
      host_session_source: run.host_session_source || null,
      addresses: {
        findings: runAddress(id, "findings"),
        evidence: runAddress(id, "evidence"),
        events: runAddress(id, "events"),
        plan: runAddress(id, "plan"),
        summary: runAddress(id, "summary"),
      },
    },
  };
}

function inspectRunAddress(workspace: string, address: string): InspectResult {
  const parsed = parseRunAddress(address);
  if (!parsed) {
    return { topic: "context", ok: false, error: `invalid run address: ${address}`, data: { address } };
  }
  const store = new RunStore(workspace);
  const rel = RUN_LEAVES[parsed.leaf] || parsed.leaf;
  const full = path.join(store.dir(parsed.runId), rel);
  const exists = existsSync(full);
  return {
    topic: "context",
    ok: exists,
    error: exists ? undefined : `store file not found for ${address}`,
    data: {
      address,
      run_id: parsed.runId,
      leaf: parsed.leaf,
      path: full,
      exists,
      contents: exists ? readFileSync(full, "utf8").slice(0, 8000) : null,
    },
  };
}

function inspectRuns(workspace: string): InspectResult {
  const store = new RunStore(workspace);
  const runs = store.listIds().map((id) => {
    const run = store.load(id);
    return {
      run_id: run.run_id,
      phase: run.phase,
      status: run.status,
      goal: run.goal,
      updated_at: run.updated_at,
    };
  });
  return { topic: "runs", ok: true, data: { workspace: store.workspace, root: store.runsRoot(), runs } };
}

function readHostVersionText(): string | undefined {
  try {
    const invocation = resolveMcodeInvocation();
    return execFileSync(invocation.command, [...invocation.prefixArgs, "--version"], {
      encoding: "utf8",
      timeout: 8000,
    });
  } catch {
    return undefined;
  }
}

function inspectModelPolicy(workspace: string, versionText?: string): InspectResult {
  const cfg = loadConfig(workspace);
  const text = versionText ?? readHostVersionText();
  const parsed = text ? parseHostVersion(text) : undefined;
  const caps = hostCapabilities(parsed);
  return {
    topic: "model-policy",
    ok: true,
    data: {
      host_version: parsed
        ? { major: parsed.major, minor: parsed.minor, patch: parsed.patch, raw: parsed.raw }
        : null,
      host_capabilities: {
        structuredExec: caps.structuredExec,
        outputSchemaDocumented: caps.outputSchemaDocumented,
        legacyOutputSchemaCrash: caps.legacyOutputSchemaCrash,
        notes: caps.notes,
        summary: formatHostCapabilities(caps),
      },
      send_to_mcode_exec: {
        cwd: "<workspace>",
        output_format: "stream-json",
        permission: cfg.permission,
        session:
          "run.json host_session_id from structured exec.result / metadata / session-like events / host cursor (mvs_* only). Never from assistant prose or YOUR SESSION ID. First exec has no --session (no omm_<runId> fake). --no-session forces cold start. User --session still wins.",
        continue:
          "set only when the user passed --continue and no host session id is known. --session and --continue are mutually exclusive on mcode 0.2.1+ (invocation, exit 2). After a real mvs_ id, send --session only",
        output_schema:
          "documented since 0.2.4; we omit until a live rematch proves it is not exit 70. Live 0.2.1 was exit 70. OMM_HOST_OUTPUT_SCHEMA=1 remains the probe. Yield is validated in TypeScript.",
        file: "verifier/review: latest test log and/or summary.md when present",
        prompt_prefix:
          "Role + goal + task packet + allowed files + acceptance + yield schema. Contract-only. Point at paths; do not paste file bodies.",
        output_schema_workers:
          "schemas/worker-yield.schema.json stays on disk. schemaMode=strict in TypeScript after exec. Host flag only when OMM_HOST_OUTPUT_SCHEMA=1.",
      },
      we_do_not_send: ["hooks", "custom plugin agents", "registered slash commands", "App UI payloads", "raw host JSONL into the next worker prompt", "ACP Goal / host /goal"],
      role_permissions: Object.fromEntries(ROLES.map((role) => [role, ROLE_CONTRACTS[role].permission])),
      note: "Project-manager duties stay in TypeScript. mcode exec is a worker, not a recursive scheduler. Host Goal settlement is recorded; VERIFY remains the acceptance authority.",
    },
  };
}

export function runInspect(opts: {
  topic: string;
  workspace: string;
  runId?: string;
  packageRoot?: string;
  hostVersionText?: string;
}): InspectResult {
  if (opts.topic.startsWith("run://")) {
    return inspectRunAddress(opts.workspace, opts.topic);
  }
  const topic = opts.topic as InspectTopic;
  if (!INSPECT_TOPICS.includes(topic)) {
    throw new CliError(`inspect topic must be ${INSPECT_TOPICS.join("|")} or run://<id>/findings`);
  }
  const root = opts.packageRoot || packageRoot();
  if (topic === "tools") return inspectTools();
  if (topic === "skills") {
    const skills = inspectSkills(root);
    return {
      topic: "skills",
      ok: skills.ok,
      error: skills.error,
      data: { ...skills, plugin_install: pluginInstallDir() },
    };
  }
  if (topic === "agents") return inspectAgents(root);
  if (topic === "context") return inspectContext(opts.workspace, opts.runId);
  if (topic === "runs") return inspectRuns(opts.workspace);
  return inspectModelPolicy(opts.workspace, opts.hostVersionText);
}

export function formatInspect(result: InspectResult): string {
  const header = `oh-my-mcode inspect ${result.topic} ${result.ok ? "OK" : "ERROR"}`;
  if (result.error) return `${header}\n${result.error}\n${JSON.stringify(result.data, null, 2)}`;
  return `${header}\n${JSON.stringify(result.data, null, 2)}`;
}
