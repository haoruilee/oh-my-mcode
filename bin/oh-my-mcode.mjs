#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", "cli.js");
const src = path.join(root, "src", "cli.ts");

function fail(error) {
  const err = error && typeof error === "object" ? error : { message: String(error) };
  process.stderr.write(`oh-my-mcode: ${err.message || error}\n`);
  process.exit(err.exitCode ?? 1);
}

if (existsSync(dist)) {
  const mod = await import(pathToFileURL(dist).href);
  const code = await mod.main(process.argv.slice(2)).catch(fail);
  process.exit(code ?? 0);
} else if (existsSync(src)) {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", src, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
} else {
  process.stderr.write("oh-my-mcode: missing dist/cli.js and src/cli.ts\n");
  process.exit(1);
}
