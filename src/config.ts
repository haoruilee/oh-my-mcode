import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERMISSIONS, type Permission } from "./types.js";

export interface TeamConfig {
  concurrency: number;
  worktree: boolean;
}

export interface OmmConfig {
  permission: Permission;
  maxRepairs: number;
  team: TeamConfig;
  llmVerify: boolean;
}

export const DEFAULT_CONFIG: OmmConfig = {
  permission: "smart",
  maxRepairs: 3,
  team: { concurrency: 2, worktree: false },
  llmVerify: true,
};

export function minimaxHomeDir(): string {
  return process.env.MINIMAX_HOME || path.join(os.homedir(), ".minimax");
}

export function configPaths(workspace: string): { home: string; workspace: string } {
  return {
    home: path.join(minimaxHomeDir(), "oh-my-mcode.json"),
    workspace: path.join(path.resolve(workspace), ".minimax", "oh-my-mcode.json"),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readConfigFile(filePath: string, source: "home" | "workspace" = "home"): Partial<OmmConfig> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = asObject(JSON.parse(readFileSync(filePath, "utf8")));
    const teamRaw = asObject(raw.team);
    const next: Partial<OmmConfig> = {};
    if (typeof raw.permission === "string" && PERMISSIONS.includes(raw.permission as Permission)) {
      if (source === "workspace" && raw.permission === "full") {
        // Workspace file cannot silently raise permission to full.
      } else {
        next.permission = raw.permission as Permission;
      }
    }
    if (typeof raw.maxRepairs === "number" && Number.isFinite(raw.maxRepairs) && raw.maxRepairs >= 0) {
      next.maxRepairs = Math.floor(raw.maxRepairs);
    }
    if (typeof raw.llmVerify === "boolean") next.llmVerify = raw.llmVerify;
    if (Object.keys(teamRaw).length > 0) {
      next.team = {
        concurrency:
          typeof teamRaw.concurrency === "number" && teamRaw.concurrency >= 1
            ? Math.floor(teamRaw.concurrency)
            : DEFAULT_CONFIG.team.concurrency,
        worktree: typeof teamRaw.worktree === "boolean" ? teamRaw.worktree : DEFAULT_CONFIG.team.worktree,
      };
    }
    return next;
  } catch {
    return {};
  }
}

function mergeConfig(base: OmmConfig, overlay: Partial<OmmConfig>): OmmConfig {
  return {
    permission: overlay.permission ?? base.permission,
    maxRepairs: overlay.maxRepairs ?? base.maxRepairs,
    llmVerify: overlay.llmVerify ?? base.llmVerify,
    team: {
      concurrency: overlay.team?.concurrency ?? base.team.concurrency,
      worktree: overlay.team?.worktree ?? base.team.worktree,
    },
  };
}

/** Home file, then workspace file. Flags override this result at the CLI. */
export function loadConfig(workspace: string): OmmConfig {
  const paths = configPaths(workspace);
  let cfg = { ...DEFAULT_CONFIG, team: { ...DEFAULT_CONFIG.team } };
  cfg = mergeConfig(cfg, readConfigFile(paths.home, "home"));
  cfg = mergeConfig(cfg, readConfigFile(paths.workspace, "workspace"));
  return cfg;
}

export interface ConfigFlagOverrides {
  permission?: string;
  maxRepairs?: number;
  llmVerify?: boolean;
  team?: boolean;
  worktree?: boolean;
  concurrency?: number;
}

export function applyFlagOverrides(cfg: OmmConfig, flags: ConfigFlagOverrides): OmmConfig {
  const next = mergeConfig(cfg, {
    permission: flags.permission && PERMISSIONS.includes(flags.permission as Permission) ? (flags.permission as Permission) : undefined,
    maxRepairs: flags.maxRepairs,
    llmVerify: flags.llmVerify,
    team:
      flags.concurrency !== undefined || flags.worktree !== undefined
        ? {
            concurrency: flags.concurrency ?? cfg.team.concurrency,
            worktree: flags.worktree ?? cfg.team.worktree,
          }
        : undefined,
  });
  if (flags.worktree === true) next.team.worktree = true;
  return next;
}
