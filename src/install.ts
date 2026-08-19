import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError, log, packageRoot } from "./util.js";

export function minimaxHome(): string {
  return process.env.MINIMAX_HOME || path.join(os.homedir(), ".minimax");
}

export function pluginInstallDir(): string {
  return path.join(minimaxHome(), "plugins", "oh-my-mcode");
}

export function installPlugin(): { dest: string } {
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
  log("Confirm on mcode 0.1.6:");
  log("  mcode --version");
  log("  mcode plugin list -m local");
  log("  mcode plugin list -m local --json");
  log("");
  log("Then say: max mode: <task>");
  log("Or:       oh-my-mcode max \"<task>\"");
  return { dest };
}
