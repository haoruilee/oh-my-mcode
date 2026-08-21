import assert from "node:assert/strict";
import { test } from "node:test";
import { hello } from "../src/index.js";

test('hello() returns "hello"', () => {
  assert.equal(hello(), "hello");
});
