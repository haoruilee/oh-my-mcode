import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { copyHelloRepair, HELLO_REPAIR_FIXTURE } from "./helpers/hello-repair.mjs";

test("hello-repair fixture exists and npm test fails (missing exports)", () => {
  assert.ok(existsSync(path.join(HELLO_REPAIR_FIXTURE, "package.json")));
  assert.ok(existsSync(path.join(HELLO_REPAIR_FIXTURE, "src/index.js")));
  assert.ok(existsSync(path.join(HELLO_REPAIR_FIXTURE, "test/hello.test.js")));
  assert.ok(existsSync(path.join(HELLO_REPAIR_FIXTURE, "test/greet.test.js")));

  const workspace = copyHelloRepair();
  const result = spawnSync("npm", ["test"], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /does not provide an export named ['"]?(hello|greet)['"]?/);
});
