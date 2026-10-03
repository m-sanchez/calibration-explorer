import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newPolicy,
  changePolicy,
  lockPolicy,
  inspectTest,
  assessmentStatus,
} from "../src/policy.ts";

test("a frozen policy can be evaluated without a claim about prior external access", () => {
  const state = inspectTest(lockPolicy(newPolicy(), 2, 0.8));
  assert.equal(
    assessmentStatus(state, "test", true),
    "Policy locked before test inspection in this session",
  );
});

test("changing after test inspection cannot recover held-out status by relocking", () => {
  let state = inspectTest(lockPolicy(newPolicy(), 2, 0.8));
  state = lockPolicy(changePolicy(state), 3, 0.9);
  assert.equal(
    assessmentStatus(state, "test", true),
    "Exploratory after test inspection",
  );
});

test("inspecting an unlocked test and reimporting an inspected file remain exploratory", () => {
  assert.equal(inspectTest(newPolicy()).changedAfterTest, true);
  assert.equal(newPolicy(true).changedAfterTest, true);
});
