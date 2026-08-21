import { cpSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HELLO_REPAIR_FIXTURE = path.resolve("test/fixtures/hello-repair");

export function copyHelloRepair(dest) {
  const target = dest || mkdtempSync(path.join(os.tmpdir(), "omm-hello-repair-"));
  if (!existsSync(HELLO_REPAIR_FIXTURE)) {
    throw new Error(`missing hello-repair fixture at ${HELLO_REPAIR_FIXTURE}`);
  }
  cpSync(HELLO_REPAIR_FIXTURE, target, { recursive: true });
  return target;
}
