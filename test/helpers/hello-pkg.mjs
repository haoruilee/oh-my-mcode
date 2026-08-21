import { cpSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HELLO_PKG_FIXTURE = path.resolve("test/fixtures/hello-pkg");

export function copyHelloPkg(dest) {
  const target = dest || mkdtempSync(path.join(os.tmpdir(), "omm-hello-"));
  if (!existsSync(HELLO_PKG_FIXTURE)) {
    throw new Error(`missing hello-pkg fixture at ${HELLO_PKG_FIXTURE}`);
  }
  cpSync(HELLO_PKG_FIXTURE, target, { recursive: true });
  return target;
}
