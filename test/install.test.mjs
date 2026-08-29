import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../dist/cli.js";
import { install, installPlugin, OFFICIAL_HOST_PACKAGE } from "../dist/install.js";

function tmp(prefix = "omm-ins-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakePackage() {
  const fakeRoot = tmp("omm-pkg-");
  mkdirSync(path.join(fakeRoot, ".minimax-plugin"), { recursive: true });
  writeFileSync(path.join(fakeRoot, "plugin.json"), JSON.stringify({ name: "oh-my-mcode", version: "0.0.0-fake" }));
  writeFileSync(
    path.join(fakeRoot, ".minimax-plugin/plugin.json"),
    JSON.stringify({ schemaVersion: 1, name: "oh-my-mcode", version: "0.0.0-fake" }),
  );
  return fakeRoot;
}

async function withInstallEnv(fn) {
  const fakeRoot = fakePackage();
  const home = tmp("omm-home-");
  const prevRoot = process.env.OMM_PACKAGE_ROOT;
  const prevHome = process.env.MINIMAX_HOME;
  process.env.OMM_PACKAGE_ROOT = fakeRoot;
  process.env.MINIMAX_HOME = home;
  try {
    return await fn({ fakeRoot, home });
  } finally {
    if (prevRoot) process.env.OMM_PACKAGE_ROOT = prevRoot;
    else delete process.env.OMM_PACKAGE_ROOT;
    if (prevHome) process.env.MINIMAX_HOME = prevHome;
    else delete process.env.MINIMAX_HOME;
  }
}

function captureLogs() {
  const logs = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    logs.push(String(chunk));
    return true;
  };
  return {
    logs,
    restore() {
      process.stderr.write = orig;
    },
  };
}

test("host present: install writes plugin and does not invoke host installer", async () => {
  await withInstallEnv(async () => {
    let hostCalls = 0;
    const cap = captureLogs();
    try {
      const result = await install({
        yes: true,
        mcodeExists: () => true,
        installHost: () => {
          hostCalls += 1;
          return { ok: true, command: `npm install -g ${OFFICIAL_HOST_PACKAGE}` };
        },
      });
      assert.equal(hostCalls, 0);
      assert.equal(result.host_install_attempted, false);
      assert.equal(result.host_installed, false);
      assert.equal(result.ok, true);
      assert.equal(result.plugin_installed, true);
      assert.ok(existsSync(path.join(result.dest, "plugin.json")));
      assert.match(cap.logs.join(""), /Confirm on mcode 0\.2\.7\+/);
    } finally {
      cap.restore();
    }
  });
});

test("host missing: install invokes mocked installer then writes plugin", async () => {
  await withInstallEnv(async () => {
    let present = false;
    let hostCalls = 0;
    const cap = captureLogs();
    try {
      const result = await install({
        yes: true,
        mcodeExists: () => present,
        installHost: () => {
          hostCalls += 1;
          present = true;
          return { ok: true, command: `npm install -g ${OFFICIAL_HOST_PACKAGE}` };
        },
        refreshPath: () => {},
      });
      assert.equal(hostCalls, 1);
      assert.equal(result.host_install_attempted, true);
      assert.equal(result.host_installed, true);
      assert.equal(result.plugin_installed, true);
      assert.ok(existsSync(path.join(result.dest, "plugin.json")));
      assert.match(cap.logs.join(""), new RegExp(OFFICIAL_HOST_PACKAGE));
    } finally {
      cap.restore();
    }
  });
});

test("install --skip-host writes plugin only when host is missing", async () => {
  await withInstallEnv(async () => {
    let hostCalls = 0;
    const cap = captureLogs();
    try {
      const result = await install({
        yes: true,
        skipHost: true,
        mcodeExists: () => false,
        installHost: () => {
          hostCalls += 1;
          return { ok: true, command: `npm install -g ${OFFICIAL_HOST_PACKAGE}` };
        },
      });
      assert.equal(hostCalls, 0);
      assert.equal(result.skip_host, true);
      assert.equal(result.host_install_attempted, false);
      assert.equal(result.plugin_installed, true);
      assert.ok(existsSync(path.join(result.dest, "plugin.json")));
    } finally {
      cap.restore();
    }
  });
});

test("failed host install is honest and still drops the plugin", async () => {
  await withInstallEnv(async () => {
    const cap = captureLogs();
    try {
      const result = await install({
        yes: true,
        mcodeExists: () => false,
        installHost: () => ({
          ok: false,
          command: `npm install -g ${OFFICIAL_HOST_PACKAGE}`,
          error: "network down",
        }),
        refreshPath: () => {},
      });
      assert.equal(result.host_install_attempted, true);
      assert.equal(result.host_installed, false);
      assert.equal(result.ok, false);
      assert.match(result.host_error || "", /network down/);
      assert.equal(result.plugin_installed, true);
      assert.ok(existsSync(path.join(result.dest, "plugin.json")));
      assert.match(cap.logs.join(""), /Host install failed/);
      assert.match(cap.logs.join(""), /plugin-only/);
    } finally {
      cap.restore();
    }
  });
});

test("cli install exits non-zero when injected host installer fails", async () => {
  await withInstallEnv(async () => {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      const code = await main(["install", "--yes"], {
        mcodeExists: () => false,
        installHost: () => ({
          ok: false,
          command: `npm install -g ${OFFICIAL_HOST_PACKAGE}`,
          error: "network down",
        }),
      });
      assert.equal(code, 2);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });
});

test("cli install --skip-host stays exit 0 (plugin-only)", async () => {
  await withInstallEnv(async () => {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
      const code = await main(["install", "--yes", "--skip-host"], {
        mcodeExists: () => false,
        installHost: () => {
          throw new Error("must not hit the registry");
        },
      });
      assert.equal(code, 0);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });
});

test("without --yes, missing host announces official package before plugin drop", async () => {
  await withInstallEnv(async () => {
    let confirmed = "";
    const cap = captureLogs();
    try {
      await install({
        yes: false,
        mcodeExists: () => false,
        confirm: async (message) => {
          confirmed = message;
          return true;
        },
        installHost: () => ({ ok: true, command: `npm install -g ${OFFICIAL_HOST_PACKAGE}` }),
        refreshPath: () => {},
      });
      assert.match(confirmed, new RegExp(OFFICIAL_HOST_PACKAGE));
      assert.match(cap.logs.join(""), /Will install official/);
    } finally {
      cap.restore();
    }
  });
});

test("installPlugin still copies from package root (plugin-only helper)", () => {
  const fakeRoot = fakePackage();
  writeFileSync(path.join(fakeRoot, "MARKER.txt"), "from-package-root\n");
  const home = tmp("omm-home-");
  const prevRoot = process.env.OMM_PACKAGE_ROOT;
  const prevHome = process.env.MINIMAX_HOME;
  process.env.OMM_PACKAGE_ROOT = fakeRoot;
  process.env.MINIMAX_HOME = home;
  const cap = captureLogs();
  try {
    const result = installPlugin({ yes: true });
    assert.equal(readFileSync(path.join(result.dest, "MARKER.txt"), "utf8"), "from-package-root\n");
  } finally {
    cap.restore();
    if (prevRoot) process.env.OMM_PACKAGE_ROOT = prevRoot;
    else delete process.env.OMM_PACKAGE_ROOT;
    if (prevHome) process.env.MINIMAX_HOME = prevHome;
    else delete process.env.MINIMAX_HOME;
  }
});
