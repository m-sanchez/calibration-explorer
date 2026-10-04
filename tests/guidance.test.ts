import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAction } from "../src/guidance.ts";
import { newPolicy, inspectTest, lockPolicy } from "../src/policy.ts";
import { parseDataset } from "../src/domain.ts";
import { assessDataset } from "../src/assessment.ts";
import { interpretation } from "../src/evidence.ts";

const base = { kind: "logits" as const, counts: { calibration: 2, policy_validation: 2, test: 2, exploration: 0 }, split: "policy_validation" as const, policy: newPolicy(), fit: null, group: "", view: "inspect", evaluationFailure: null };
test("next actions respect available input and policy states", () => {
  assert.equal(nextAction(base).action, "calibrate");
  assert.equal(nextAction({ ...base, kind: "confidence" }).action, "next-policy");
  assert.equal(nextAction({ ...base, counts: { calibration: 0, policy_validation: 0, test: 0, exploration: 4 } }).action, "export");
  assert.equal(nextAction({ ...base, group: "one" }).action, "clear-group");
  assert.equal(nextAction({ ...base, policy: lockPolicy(newPolicy(), 1, .8), fit: { status: "applied", result: null, calibrationRows: 2, message: "applied" } }).action, "next-test");
  assert.equal(nextAction({ ...base, policy: inspectTest(newPolicy()) }).action, "export");
  assert.equal(nextAction({ ...base, fit: { status: "failed", result: null, calibrationRows: 2, message: "failed" } }).action, "export");
  assert.equal(nextAction({ ...base, evaluationFailure: "unavailable" }).action, "calibrate");
});

test("visible interpretation is deterministic for improvement, worsening, equality and empty selections", () => {
  const data = parseDataset('[{"id":"a","logits":[0,2],"label":1,"split":"exploration"}]', "one.json");
  const { before } = assessDataset(data, { split: "exploration", bins: 10, strategy: "equal-width", temperature: 1, applyTemperature: false });
  for (const delta of [-.01, 0, .01]) {
    const after = { ...before, nll: before.nll! + delta, ece: before.ece! + delta };
    const lines = interpretation(before, after);
    assert.equal(lines.length, 2);
    assert.match(lines.join(" "), delta === 0 ? /unchanged/ : delta < 0 ? /decreased/ : /increased/);
    assert.match(lines[1], /selected binning/);
  }
  assert.equal(interpretation(before, null).length, 2);
  assert.deepEqual(interpretation({ ...before, n: 0 }, null), ["No observations are available for this selection."]);
});
