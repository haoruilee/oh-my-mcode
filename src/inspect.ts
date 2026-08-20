import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CliError, packageRoot, which } from "./util.js";
import { pluginInstallDir } from "./install.js";
import { mcodeExists, resolveMcodeInvocation } from "./mcode.js";
import { RunStore } from "./store.js";
import { ROLES, type Role } from "./types.js";
import { loadConfig } from "./config.js";

export const INSPECT_TOPICS = ["tools", "skills", "agents", "context", "runs", "model-policy"] as const;
export type InspectTopic = (typeof INSPECT_TOPICS)[number];

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

function inspectModelPolicy(workspace: string): InspectResult {
  const cfg = loadConfig(workspace);
  return {
    topic: "model-policy",
    ok: true,
    data: {
      send_to_mcode_exec: {
        cwd: "<workspace>",
        output_format: "stream-json",
        permission: cfg.permission,
        session: "optional --session",
        prompt_prefix:
          "Role: <explorer|planner|builder|verifier|release> + clipped agents/<role>.md + task body. Prefix shape is stable for evals/replay.",
      },
      we_do_not_send: ["hooks", "custom plugin agents", "registered slash commands", "App UI payloads"],
      role_permissions: Object.fromEntries(ROLES.map((role) => [role, ROLE_CONTRACTS[role].permission])),
      note: "Project-manager duties stay in TypeScript. mcode exec is a worker, not a recursive scheduler.",
    },
  };
}

export function runInspect(opts: {
  topic: string;
  workspace: string;
  runId?: string;
  packageRoot?: string;
}): InspectResult {
  const topic = opts.topic as InspectTopic;
  if (!INSPECT_TOPICS.includes(topic)) {
    throw new CliError(`inspect topic must be ${INSPECT_TOPICS.join("|")}`);
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
  return inspectModelPolicy(opts.workspace);
}

export function formatInspect(result: InspectResult): string {
  const header = `oh-my-mcode inspect ${result.topic} ${result.ok ? "OK" : "ERROR"}`;
  if (result.error) return `${header}\n${result.error}\n${JSON.stringify(result.data, null, 2)}`;
  return `${header}\n${JSON.stringify(result.data, null, 2)}`;
}
