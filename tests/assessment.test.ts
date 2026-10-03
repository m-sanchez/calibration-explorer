import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDataset } from "../src/assessment.ts";
import { fitDataset, parseDataset } from "../src/domain.ts";

const options = {
  split: "test",
  bins: 10,
  strategy: "equal-width",
  applyTemperature: true,
} as const;

test("a converged interior fit preserves the original assessment when scaled evaluation overflows", () => {
  const dataset = parseDataset(
    JSON.stringify([
      ...[1, 1, 1, 0].map((label, index) => ({
        id: `calibration-${index}`,
        split: "calibration",
        logits: [0, 0.1],
        label,
      })),
      { id: "extreme-test", split: "test", logits: [0, -1e308], label: 1 },
    ]),
    "overflow.json",
  );
  const fitted = fitDataset(dataset);
  assert.equal(fitted.status, "converged");
  assert.ok(Math.abs(fitted.temperature - 0.1 / Math.log(3)) < 1e-4);

  const result = assessDataset(dataset, {
    ...options,
    temperature: fitted.temperature,
  });
  assert.equal(result.before.n, 1);
  assert.equal(result.before.nll, 1e308);
  assert.equal(result.before.accuracy, 0);
  assert.equal(result.before.ece, 1);
  assert.deepEqual(result.before.predictions, [
    { id: "extreme-test", confidence: 1, correct: false },
  ]);
  assert.equal(result.after, null);
  assert.match(
    result.evaluationFailure ?? "",
    /No scaled assessment is available/,
  );
  assert.match(
    result.evaluationFailure ?? "",
    /NLL exceeds finite numeric range/,
  );
  assert.match(
    result.evaluationFailure ?? "",
    /original probabilities \(T = 1\)/,
  );
  assert.deepEqual(result.curve, [
    { threshold: null, coverage: 0, risk: null, accepted: 0, errors: 0 },
    { threshold: 1, coverage: 1, risk: 1, accepted: 1, errors: 1 },
  ]);
});

test("a valid scaled assessment keeps separate measurements and uses scaled risk thresholds", () => {
  const dataset = parseDataset(
    JSON.stringify([
      { id: "correct", split: "test", logits: [Math.log(3), 0], label: 0 },
      { id: "incorrect", split: "test", logits: [Math.log(3), 0], label: 1 },
    ]),
    "ordinary.json",
  );
  const result = assessDataset(dataset, { ...options, temperature: 2 });
  const expectedConfidence = Math.sqrt(3) / (1 + Math.sqrt(3));
  const expectedNll =
    -(Math.log(expectedConfidence) + Math.log(1 - expectedConfidence)) / 2;
  assert.equal(result.evaluationFailure, null);
  assert.ok(result.after);
  assert.ok(Math.abs(result.before.meanConfidence! - 0.75) < 1e-12);
  assert.ok(
    Math.abs(result.after.meanConfidence! - expectedConfidence) < 1e-12,
  );
  assert.ok(Math.abs(result.after.nll! - expectedNll) < 1e-12);
  assert.equal(result.before.accuracy, 0.5);
  assert.equal(result.after.accuracy, 0.5);
  assert.deepEqual(
    result.after.predictions.map(({ id }) => id),
    ["correct", "incorrect"],
  );
  assert.ok(Math.abs(result.curve[1].threshold! - expectedConfidence) < 1e-12);
  assert.equal(result.curve[1].risk, 0.5);
  assert.equal(result.curve[1].coverage, 1);
});

test("an original-only assessment does not attempt scaling", () => {
  const dataset = parseDataset(
    "id,confidence,correct,split\nrow,0.8,true,test",
    "confidence.csv",
  );
  const result = assessDataset(dataset, {
    ...options,
    applyTemperature: false,
    temperature: 2,
  });
  assert.equal(result.evaluationFailure, null);
  assert.equal(result.after, null);
  assert.equal(result.before.meanConfidence, 0.8);
  assert.equal(result.curve[1].threshold, 0.8);
});

test("baseline failure propagates without inventing an original assessment", () => {
  const dataset = parseDataset(
    JSON.stringify([
      {
        id: "unrepresentable",
        split: "test",
        logits: [1e308, -1e308],
        label: 1,
      },
    ]),
    "invalid-baseline.json",
  );
  assert.throws(
    () => assessDataset(dataset, { ...options, temperature: 2 }),
    /NLL exceeds finite numeric range/,
  );
});
