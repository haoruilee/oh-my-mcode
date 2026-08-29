import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mcodeExists } from "./mcode.js";
import { CliError, log, packageRoot, promptYesNo } from "./util.js";

/** Official MiniMax Code CLI. We do not own this package. We are not a bundled host. */
export const OFFICIAL_HOST_PACKAGE = "@minimax-ai/code";
export const OFFICIAL_HOST_INSTALL_ARGV = ["install", "-g", OFFICIAL_HOST_PACKAGE] as const;

export function minimaxHome(): string {
  return process.env.MINIMAX_HOME || path.join(os.homedir(), ".minimax");
}

export function pluginInstallDir(): string {
  return path.join(minimaxHome(), "plugins", "oh-my-mcode");
}

export interface HostInstallResult {
  ok: boolean;
  command: string;
  output?: string;
  error?: string;
}

export type HostInstaller = () => HostInstallResult;

export interface InstallOptions {
  yes?: boolean;
  skipHost?: boolean;
  mcodeExists?: () => boolean;
  installHost?: HostInstaller;
  refreshPath?: () => void;
  confirm?: (message: string) => Promise<boolean>;
  /** Test injection. Defaults to `process.stdin.isTTY`. */
  stdinIsTTY?: boolean;
}

/**
 * Host install is skipped on non-TTY stdin unless `--yes`.
 * Does not change global `promptYesNo` (CI `--approve-plan` still defaults).
 */
export function shouldAttemptHostInstall(opts: {
  yes?: boolean;
  skipHost?: boolean;
  hostPresent: boolean;
  stdinIsTTY?: boolean;
  /** Injected confirm means the caller wants the prompt path (tests). */
  hasConfirm?: boolean;
}): boolean {
  if (opts.hostPresent || opts.skipHost) return false;
  if (opts.yes) return true;
  if (opts.hasConfirm) return true;
  return Boolean(opts.stdinIsTTY);
}

export interface InstallResult {
  dest: string;
  packageRoot: string;
  yes: boolean;
  skip_host: boolean;
  host_present_before: boolean;
  host_install_attempted: boolean;
  host_installed: boolean;
  host_present_after: boolean;
  plugin_installed: boolean;
  host_error?: string;
  /** False when a host install was attempted and failed (plugin may still be dropped). */
  ok: boolean;
}

function finishInstall(result: Omit<InstallResult, "ok">): InstallResult {
  const hostFailed = Boolean(result.host_error) || (result.host_install_attempted && !result.host_installed);
  return { ...result, ok: !hostFailed };
}

/**
 * Prepend `npm prefix -g`/bin so a just-installed `mcode` resolves.
 * Tests inject `refreshPath` and never call this against the registry.
 */
export function prependNpmGlobalBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const result = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", env });
  if (result.status !== 0) return undefined;
  const prefix = (result.stdout || "").trim();
  if (!prefix) return undefined;
  const bin = process.platform === "win32" ? prefix : path.join(prefix, "bin");
  const parts = (env.PATH || "").split(path.delimiter);
  if (!parts.includes(bin)) env.PATH = `${bin}${path.delimiter}${env.PATH || ""}`;
  return bin;
}

/** Official npm global install. Never curl a script. Never install MiniMax desktop. */
export function npmGlobalHostInstaller(): HostInstaller {
  return () => {
    if (process.env.CI === "true" || process.env.OMM_HERMETIC === "1") {
      return {
        ok: false,
        command: `npm ${OFFICIAL_HOST_INSTALL_ARGV.join(" ")}`,
        error: "refused to install the host from CI / hermetic mode (mock the installer in tests)",
      };
    }
    const result = spawnSync("npm", [...OFFICIAL_HOST_INSTALL_ARGV], {
      encoding: "utf8",
      env: process.env,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (result.status === 0) {
      return { ok: true, command: `npm ${OFFICIAL_HOST_INSTALL_ARGV.join(" ")}`, output };
    }
    return {
      ok: false,
      command: `npm ${OFFICIAL_HOST_INSTALL_ARGV.join(" ")}`,
      output,
      error: output || `npm exited ${result.status ?? 1}`,
    };
  };
}

export function installPlugin(opts: { yes?: boolean } = {}): { dest: string; packageRoot: string; yes: boolean } {
  const root = packageRoot();
  if (!existsSync(path.join(root, "plugin.json")) || !existsSync(path.join(root, ".minimax-plugin/plugin.json"))) {
    throw new CliError(`missing plugin manifests in ${root}`);
  }
  const dest = pluginInstallDir();
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(root, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = path.relative(root, src);
      if (!rel || rel === ".") return true;
      const top = rel.split(path.sep)[0];
      if (top === ".git" || top === "node_modules" || top === ".minimax") return false;
      return true;
    },
  });
  if (lstatSync(dest).isSymbolicLink()) {
    throw new CliError("refused to install a symlink as the plugin root");
  }
  log(`Installed oh-my-mcode to ${dest}`);
  log("");
  log("This is a local marketplace drop-in. Official MiniMax catalog listing is separate.");
  log("We do not own mcode. This package is the verified-delivery harness; @minimax-ai/code is the host.");
  log("Confirm on mcode 0.2.7+:");
  log("  mcode --version");
  log("  mcode plugin list -m local");
  log("  mcode plugin list -m local --json");
  log("");
  log("Then in MiniMax Code (desktop or mcode TUI) say:");
  log("  max mode: <your task>");
  log("");
  log("examples/AGENTS.max-mode.md is an opt-in Max Mode template for a product repo.");
  log("install does not write or overwrite a project AGENTS.md.");
  if (opts.yes) log("(install --yes: non-interactive)");
  return { dest, packageRoot: root, yes: Boolean(opts.yes) };
}

/**
 * One command, two products. If `mcode` is present, drop the plugin (today).
 * If missing: install official `@minimax-ai/code` via npm, re-resolve PATH, then drop the plugin.
 * `--skip-host` is plugin-only. Host install failure is honest and still drops the plugin.
 */
export async function install(opts: InstallOptions = {}): Promise<InstallResult> {
  const exists = opts.mcodeExists || mcodeExists;
  const presentBefore = exists();
  const skipHost = Boolean(opts.skipHost);
  let hostInstallAttempted = false;
  let hostInstalled = false;
  let hostError: string | undefined;

  const stdinIsTTY = opts.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  if (!presentBefore && !skipHost && !shouldAttemptHostInstall({
    yes: opts.yes,
    skipHost,
    hostPresent: presentBefore,
    stdinIsTTY,
    hasConfirm: Boolean(opts.confirm),
  })) {
    log("stdin is not a TTY; skipping host install (plugin-only). Pass --yes to install the host.");
    const plugin = installPlugin({ yes: opts.yes });
    return finishInstall({
      dest: plugin.dest,
      packageRoot: plugin.packageRoot,
      yes: plugin.yes,
      skip_host: true,
      host_present_before: false,
      host_install_attempted: false,
      host_installed: false,
      host_present_after: exists(),
      plugin_installed: true,
    });
  }

  if (!presentBefore && !skipHost) {
    log(`mcode is not on PATH. Will install official ${OFFICIAL_HOST_PACKAGE} (global npm), then this plugin.`);
    log("We do not own mcode. We are not a bundled host (not Senpi / omo-ai, not curl omp.sh/install).");
    if (!opts.yes) {
      const confirm = opts.confirm || ((message: string) => promptYesNo(message));
      const ok = await confirm(`Install official ${OFFICIAL_HOST_PACKAGE} and the oh-my-mcode plugin?`);
      if (!ok) {
        log("Host install declined. Continuing with plugin-only (--skip-host).");
        const plugin = installPlugin({ yes: opts.yes });
        return finishInstall({
          dest: plugin.dest,
          packageRoot: plugin.packageRoot,
          yes: plugin.yes,
          skip_host: true,
          host_present_before: false,
          host_install_attempted: false,
          host_installed: false,
          host_present_after: exists(),
          plugin_installed: true,
        });
      }
    }
    hostInstallAttempted = true;
    const installer = opts.installHost || npmGlobalHostInstaller();
    const result = installer();
    if (result.ok) {
      (opts.refreshPath || prependNpmGlobalBin)();
      hostInstalled = exists();
      if (hostInstalled) log(`Installed official host ${OFFICIAL_HOST_PACKAGE}.`);
      else {
        hostError = "host installer exited 0 but mcode still does not resolve on PATH";
        log(`Host install reported success, but mcode still missing. ${hostError}`);
      }
    } else {
      hostError = result.error || "host install failed";
      log(`Host install failed (${result.command}): ${hostError}`);
      log("Continuing with plugin-only. Install @minimax-ai/code yourself, or re-run without --skip-host.");
    }
  }

  const plugin = installPlugin({ yes: opts.yes });
  return finishInstall({
    dest: plugin.dest,
    packageRoot: plugin.packageRoot,
    yes: plugin.yes,
    skip_host: skipHost,
    host_present_before: presentBefore,
    host_install_attempted: hostInstallAttempted,
    host_installed: hostInstalled,
    host_present_after: exists(),
    plugin_installed: true,
    ...(hostError ? { host_error: hostError } : {}),
  });
}
