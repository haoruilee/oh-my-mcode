#!/usr/bin/env node
import { CliError, McodeMissingError, log } from "./util.js";
import { RunStore } from "./store.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { formatTps, runDoctorTps } from "./tps.js";
import { install } from "./install.js";
import { runMax, runPlan, runResume, runTeam } from "./orchestrator.js";
import { PERMISSIONS, type Permission } from "./types.js";
import { applyFlagOverrides, loadConfig } from "./config.js";
import { emitHostSessionHints } from "./session.js";
import type { RunRecord } from "./types.js";
import { watchHud } from "./hud.js";
import { formatInspect, INSPECT_TOPICS, runInspect } from "./inspect.js";
import { runReview } from "./review.js";
import { formatShip, runShip } from "./ship.js";
import { runResearch } from "./research.js";
import { createHarness } from "./harness.js";

const VERSION = "0.1.0";

const HELP = `Oh My MiniMax Code — verified delivery for MiniMax Code

Usage:
  oh-my-mcode <command> [args]

Commands:
  max <goal>         Full loop to Accepted evidence
  plan <goal>        Discover + plan + review (no product edits)
  verify [run_id]    Independent acceptance (deterministic first)
  resume [run_id]    Continue a saved run from its phase
  review [run_id]    Read-only review of diff + evidence (cannot Accept)
  ship [run_id]      Release notes + git/PR commands (Accepted only)
  research <topic>   DISCOVER-only research note (no builder)
  attach [run_id]    Live HUD of the run store
  status [run_id]    One-shot HUD
  cancel [run_id]    Mark cancelled and persist the event
  inspect <topic>    tools|skills|agents|context|runs|model-policy|run://<id>/findings
  team <task>        Flat team mode (explicit; sequential max is default)
  interview <goal>   Capture goal/constraints/acceptance; stop at PLAN_REVIEW
  doctor             Host + package health
  install            Plugin drop-in; official @minimax-ai/code if mcode is missing

max is the only command you must remember. The others are power tools.

Options:
  --workspace, -w DIR    Project root (default: cwd)
  --run-id, -r ID        Existing run
  --run ID               inspect: run to summarize (alias of --run-id)
  --permission MODE      ask | smart | full | off (mcode exec)
  --approve-plan         Wait on a TTY before EXECUTE
  --max-repairs N        Repair loop bound (default: 3)
  --no-llm-verify        Skip the optional read-only LLM judge
  --release              After Accepted, move to RELEASE (you still do git/PR)
  --team                 max: enable flat team scheduling
  --worktree             Parallel builders each get a git worktree
  --concurrency N        Team builder concurrency (default: 2)
  --ralph                Continue until Accepted (existing repair bound)
  --watch                attach: tail events / refresh HUD
  --commit               ship: local commit if git is clean enough; push only then
  --package-only         doctor: skip mcode-on-PATH (CI)
  --smoke                doctor: one tiny mcode exec (pong)
  --tps                  doctor: real host tok/s (unmeasured if stub or usage omitted)
  --allow-stub           doctor --tps: allow fake-mcode (still unmeasured)
  --yes                  install: non-interactive
  --skip-host            install: plugin only (do not fetch @minimax-ai/code)
  --discover             max: force the explorer host exec even when the goal is concrete
  --answers FILE         interview: skip prompts, load JSON
  --constraint TEXT      interview: repeatable; non-TTY without --answers
  --interview            max: interview first, then the full loop
  --session ID           Attach this run to an existing host mcode session
  --no-session           Force cold-start exec (tests / escape hatch)
  --continue             First exec uses host --continue (latest-in-cwd)
  --json                 Machine-readable stdout
  --help, -h             Show this help
  --version, -V          Print ${VERSION}

Config files (flags override file):
  <workspace>/.minimax/oh-my-mcode.json
  ~/.minimax/oh-my-mcode.json

This is not a registered /max host command. Host already has /plan /goal /resume /team.
We coexist. Official marketplace listing is separate.

Examples:
  oh-my-mcode max "fix auth and prove tests pass"
  oh-my-mcode plan "migrate mysql to postgres"
  oh-my-mcode team "split independent builder tasks"
  oh-my-mcode review
  oh-my-mcode ship
  oh-my-mcode doctor
  oh-my-mcode doctor --smoke
  oh-my-mcode doctor --tps
  oh-my-mcode interview "fix auth"
  npx oh-my-mcode install --yes
`;


interface Flags {
  _: string[];
  workspace?: string;
  "run-id"?: string;
  run?: string;
  permission?: string;
  "approve-plan"?: boolean;
  "max-repairs"?: string;
  "no-llm-verify"?: boolean;
  release?: boolean;
  team?: boolean;
  worktree?: boolean;
  concurrency?: string;
  ralph?: boolean;
  watch?: boolean;
  commit?: boolean;
  "package-only"?: boolean;
  smoke?: boolean;
  tps?: boolean;
  "allow-stub"?: boolean;
  yes?: boolean;
  "skip-host"?: boolean;
  discover?: boolean;
  answers?: string;
  constraint?: string[];
  interview?: boolean;
  json?: boolean;
  help?: boolean;
  version?: boolean;
  session?: string;
  "no-session"?: boolean;
  continue?: boolean;
}

const BOOL_FLAGS = new Set([
  "approve-plan",
  "no-llm-verify",
  "release",
  "package-only",
  "json",
  "team",
  "worktree",
  "ralph",
  "watch",
  "commit",
  "no-session",
  "continue",
  "smoke",
  "tps",
  "allow-stub",
  "yes",
  "skip-host",
  "discover",
  "interview",
]);

function parseArgv(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "--version" || token === "-V") {
      flags.version = true;
      continue;
    }
    if (token.startsWith("--") && BOOL_FLAGS.has(token.slice(2))) {
      flags[token.slice(2) as keyof Flags] = true as never;
      continue;
    }
    if (token === "-w" || token === "--workspace") {
      flags.workspace = argv[++i];
      continue;
    }
    if (token === "-r" || token === "--run-id" || token === "--run") {
      const value = argv[++i];
      flags["run-id"] = value;
      flags.run = value;
      continue;
    }
    if (token === "--permission" || token === "--max-repairs" || token === "--concurrency" || token === "--session") {
      const key = token.slice(2) as "permission" | "max-repairs" | "concurrency" | "session";
      flags[key] = argv[++i];
      continue;
    }
    if (token === "--answers") {
      flags.answers = argv[++i];
      continue;
    }
    if (token === "--constraint") {
      const value = argv[++i];
      if (!value) throw new CliError("--constraint requires a value");
      flags.constraint = [...(flags.constraint || []), value];
      continue;
    }
    if (token.startsWith("-")) {
      throw new CliError(`unknown flag: ${token}`);
    }
    flags._.push(token);
  }
  return flags;
}

function workspaceOf(flags: Flags): string {
  return flags.workspace || process.env.OMM_WORKSPACE || process.cwd();
}

function permissionOf(flags: Flags, fallback: Permission): Permission {
  const value = flags.permission || fallback;
  if (!PERMISSIONS.includes(value as Permission)) {
    throw new CliError(`--permission must be ${PERMISSIONS.join("|")}`);
  }
  return value as Permission;
}

function printSessionHints(run: RunRecord): void {
  emitHostSessionHints(run, log);
}

function print(value: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const flags = parseArgv(argv);
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.help || flags._.length === 0) {
    process.stdout.write(HELP);
    return flags.help ? 0 : 1;
  }

  const command = flags._[0];
  const rest = flags._.slice(1).join(" ").trim();
  const workspace = workspaceOf(flags);
  const fileCfg = loadConfig(workspace);
  const cfg = applyFlagOverrides(fileCfg, {
    permission: flags.permission,
    maxRepairs: flags["max-repairs"] ? Number(flags["max-repairs"]) : undefined,
    llmVerify: flags["no-llm-verify"] ? false : undefined,
    worktree: flags.worktree,
    concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
  });
  const common = {
    workspace,
    runId: flags["run-id"] || flags.run,
    permission: permissionOf(flags, cfg.permission),
    approvePlan: Boolean(flags["approve-plan"]),
    maxRepairs: cfg.maxRepairs,
    llmVerify: cfg.llmVerify,
    release: Boolean(flags.release),
    team: Boolean(flags.team),
    worktree: Boolean(flags.worktree || cfg.team.worktree),
    ralph: Boolean(flags.ralph),
    concurrency: cfg.team.concurrency,
    session: flags.session,
    noSession: Boolean(flags["no-session"]),
    continue: Boolean(flags.continue),
  };

  if (command === "doctor") {
    const report = runDoctor({ packageOnly: Boolean(flags["package-only"]), smoke: Boolean(flags.smoke) });
    const tps = flags.tps ? await runDoctorTps({ allowStub: Boolean(flags["allow-stub"]) }) : undefined;
    if (flags.json) print(tps ? { doctor: report, tps } : report, true);
    else {
      process.stdout.write(`${formatDoctor(report)}\n`);
      if (tps) process.stdout.write(`${formatTps(tps)}\n`);
    }
    const tpsFail = Boolean(tps && tps.unmeasured && !flags["allow-stub"]);
    return report.ok && !tpsFail ? 0 : 1;
  }

  if (command === "install") {
    const result = await install({ yes: Boolean(flags.yes), skipHost: Boolean(flags["skip-host"]) });
    print(result, Boolean(flags.json));
    return 0;
  }

  const harness = createHarness(workspace);

  if (command === "interview") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode interview "<goal>"');
    const result = await harness.submit({
      op: "interview",
      goal: rest,
      runId: flags["run-id"],
      answersPath: flags.answers,
      constraints: flags.constraint,
    });
    print(flags.json ? result : result.run, true);
    return 0;
  }

  if (command === "max") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode max "<goal>"');
    try {
      let runId = flags["run-id"];
      if (flags.interview) {
        const interviewed = await harness.submit({
          op: "interview",
          goal: rest,
          runId,
          answersPath: flags.answers,
          constraints: flags.constraint,
        });
        runId = interviewed.run?.run_id;
      }
      const run = await runMax({
        ...common,
        goal: rest,
        runId,
        resumeFrom: flags.interview ? "PLAN_REVIEW" : undefined,
        interview: Boolean(flags.interview),
        discover: Boolean(flags.discover),
      });
      print(run, true);
      printSessionHints(run);
      return run.status === "accepted" ? 0 : 2;
    } catch (error) {
      if (error instanceof McodeMissingError) {
        const store = new RunStore(workspace);
        const latest = store.latestId();
        log(error.message);
        if (latest) log(`Run ${latest} was created. Resume later: oh-my-mcode resume ${latest}`);
        return error.exitCode;
      }
      throw error;
    }
  }

  if (command === "plan") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode plan "<goal>"');
    const run = await runPlan({ ...common, goal: rest });
    print(run, true);
    printSessionHints(run);
    return run.phase === "PLAN_REVIEW" && run.status === "active" ? 0 : 2;
  }

  if (command === "verify") {
    const result = await harness.submit({
      op: "verify",
      runId: rest || flags["run-id"],
      permission: common.permission,
      llmVerify: common.llmVerify,
      session: common.session,
      noSession: common.noSession,
      continue: common.continue,
    });
    print(result.run, true);
    return result.run?.status === "accepted" ? 0 : 2;
  }

  if (command === "resume") {
    const run = await runResume({ ...common, runId: rest || flags["run-id"] });
    print(run, true);
    return 0;
  }

  if (command === "review") {
    const result = await runReview({ ...common, runId: rest || flags["run-id"] });
    print(flags.json ? result : `${result.review.summary}\n(Review cannot Accept. status=${result.run.status})`, Boolean(flags.json));
    return result.run.status === "accepted" ? 0 : 0;
  }

  if (command === "ship") {
    const result = await runShip({ workspace, runId: rest || flags["run-id"], commit: Boolean(flags.commit) });
    print(flags.json ? result : formatShip(result), Boolean(flags.json));
    return 0;
  }

  if (command === "research") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode research "<topic>"');
    const run = await runResearch({ ...common, goal: rest });
    print(run, true);
    return 0;
  }

  if (command === "attach" || command === "status") {
    const store = new RunStore(workspace);
    const runId = store.resolveId(rest || flags["run-id"]);
    if (command === "attach" && flags.watch) {
      await watchHud(store, runId, { maxRepairs: cfg.maxRepairs });
      return 0;
    }
    const result = await harness.submit({ op: "status", runId, attach: command === "attach" });
    print(flags.json ? { hud: result.hud, run: result.run } : result.hud, Boolean(flags.json));
    return 0;
  }

  if (command === "cancel") {
    const result = await harness.submit({ op: "cancel", runId: rest || flags["run-id"] });
    print(result.run, Boolean(flags.json));
    return 0;
  }

  if (command === "inspect") {
    const topic = flags._[1] || "";
    if (!topic) throw new CliError(`usage: oh-my-mcode inspect <${INSPECT_TOPICS.join("|")}|run://<id>/findings> [--run id]`);
    const result = runInspect({ topic, workspace, runId: flags["run-id"] || flags._[2] });
    if (flags.json) print(result, true);
    else process.stdout.write(`${formatInspect(result)}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === "team") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode team "<task>"');
    try {
      const run = await runTeam({ ...common, goal: rest, team: true, workflow: "team" });
      print(run, true);
      printSessionHints(run);
      return run.status === "accepted" ? 0 : 2;
    } catch (error) {
      if (error instanceof McodeMissingError) {
        log(error.message);
        return error.exitCode;
      }
      throw error;
    }
  }

  throw new CliError(`unknown command: ${command}`);
}

const invokedDirectly = Boolean(process.argv[1] && /(?:^|[\\/])cli\.(?:js|ts)$/.test(process.argv[1]));
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      const err = error as { message?: string; exitCode?: number };
      process.stderr.write(`oh-my-mcode: ${err.message || error}\n`);
      process.exit(err.exitCode ?? 1);
    });
}

export { main, HELP, VERSION };
