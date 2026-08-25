import assert from "node:assert/strict";
import { test } from "node:test";
import * as mod from "../src/index.js";

test("exports hello() returning hello", () => {
  assert.equal(typeof mod.hello, "function");
  assert.equal(mod.hello(), "hello");
});

test("does not export greet", () => {
  assert.equal(typeof mod.greet, "undefined");
  assert.equal("greet" in mod, false);
});
