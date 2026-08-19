#!/usr/bin/env node
import { CliError, McodeMissingError, log } from "./util.js";
import { RunStore } from "./store.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { installPlugin } from "./install.js";
import { runMax, runPlan, runResume, runVerifyOnly } from "./orchestrator.js";
import { PERMISSIONS, type Permission } from "./types.js";

const VERSION = "0.1.0";

const HELP = `Oh My MiniMax Code — verified delivery for MiniMax Code

Usage:
  oh-my-mcode <command> [args]
  omm <command> [args]

Commands:
  max <goal>         Full loop to Accepted evidence
  plan <goal>        Discover + plan + review (no product edits)
  verify [run_id]    Independent acceptance (deterministic first)
  resume [run_id]    Continue a saved run from its phase
  doctor             Host + package health
  install            Copy plugin into ~/.minimax/plugins/oh-my-mcode

max is the only command you must remember.

Options:
  --workspace, -w DIR    Project root (default: cwd)
  --run-id, -r ID        Existing run
  --permission MODE      ask | smart | full | off (mcode exec)
  --approve-plan         Wait on a TTY before EXECUTE
  --max-repairs N        Repair loop bound (default: 3)
  --no-llm-verify        Skip the optional read-only LLM judge
  --release              After Accepted, move to RELEASE (you still do git/PR)
  --package-only         doctor: skip mcode-on-PATH (CI)
  --json                 Machine-readable stdout
  --help, -h             Show this help
  --version, -V          Print ${VERSION}

This is not a registered /max host command. Host already has /plan /goal /resume.
We coexist. Official marketplace listing is separate.

Examples:
  oh-my-mcode max "fix auth and prove tests pass"
  oh-my-mcode plan "migrate mysql to postgres"
  oh-my-mcode verify
  oh-my-mcode resume
  oh-my-mcode doctor
  oh-my-mcode install
`;

interface Flags {
  _: string[];
  workspace?: string;
  "run-id"?: string;
  permission?: string;
  "approve-plan"?: boolean;
  "max-repairs"?: string;
  "no-llm-verify"?: boolean;
  release?: boolean;
  "package-only"?: boolean;
  json?: boolean;
  help?: boolean;
  version?: boolean;
}

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
    if (token === "--approve-plan" || token === "--no-llm-verify" || token === "--release" || token === "--package-only" || token === "--json") {
      flags[token.slice(2) as keyof Flags] = true as never;
      continue;
    }
    if (token === "-w" || token === "--workspace") {
      flags.workspace = argv[++i];
      continue;
    }
    if (token === "-r" || token === "--run-id") {
      flags["run-id"] = argv[++i];
      continue;
    }
    if (token === "--permission" || token === "--max-repairs") {
      const key = token.slice(2) as "permission" | "max-repairs";
      flags[key] = argv[++i];
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

function permissionOf(flags: Flags): Permission {
  const value = flags.permission || "smart";
  if (!PERMISSIONS.includes(value as Permission)) {
    throw new CliError(`--permission must be ${PERMISSIONS.join("|")}`);
  }
  return value as Permission;
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
  const common = {
    workspace,
    runId: flags["run-id"],
    permission: permissionOf(flags),
    approvePlan: Boolean(flags["approve-plan"]),
    maxRepairs: flags["max-repairs"] ? Number(flags["max-repairs"]) : 3,
    llmVerify: !flags["no-llm-verify"],
    release: Boolean(flags.release),
  };

  if (command === "doctor") {
    const report = runDoctor({ packageOnly: Boolean(flags["package-only"]) });
    if (flags.json) print(report, true);
    else process.stdout.write(`${formatDoctor(report)}\n`);
    return report.ok ? 0 : 1;
  }

  if (command === "install") {
    const result = installPlugin();
    print(result, Boolean(flags.json));
    return 0;
  }

  if (command === "max") {
    if (!rest && !flags["run-id"]) throw new CliError('usage: oh-my-mcode max "<goal>"');
    try {
      const run = await runMax({ ...common, goal: rest });
      print(run, true);
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
    return 0;
  }

  if (command === "verify") {
    const run = await runVerifyOnly({ ...common, runId: rest || flags["run-id"] });
    print(run, true);
    return run.status === "accepted" ? 0 : 2;
  }

  if (command === "resume") {
    const run = await runResume({ ...common, runId: rest || flags["run-id"] });
    print(run, true);
    return run.status === "accepted" ? 0 : 0;
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
