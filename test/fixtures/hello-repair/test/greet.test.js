import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../src/index.js";

test('greet("world") returns "hello world"', () => {
  assert.equal(greet("world"), "hello world");
});
