import assert from "node:assert/strict";
import { test } from "node:test";
import { add } from "./add.js";

test("add sums two numbers", () => {
  assert.equal(add(2, 3), 5);
});
