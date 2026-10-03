import { test } from "node:test";
import assert from "node:assert/strict";
import { nullEce, softmax } from "@m-sanchez/calibrated";
import { analyze, fitDataset } from "../src/domain.ts";
import {
  conditionalReference,
  createLearningDataset,
  normalizeLearningOptions,
} from "../src/learning.ts";
import type { LearningKind, LearningOptions } from "../src/learning.ts";
import type { Dataset, Split } from "../src/domain.ts";

const kinds: LearningKind[] = [
  "sampling",
  "binning",
  "temperature",
  "group-failure",
];
const settings = { split: "test", bins: 15, strategy: "equal-width" } as const;

function close(
  actual: number | null,
  expected: number,
  tolerance = 1e-12,
): void {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs(actual! - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
}

function rowsIn(dataset: Dataset, split: Split) {
  return dataset.rows.filter((row) => row.split === split);
}

test("learning settings retain valid values and default unsupported or unbounded input", () => {
  const defaults = { n: 500, seed: 42, redraw: 0, distortion: 2.5 };
  assert.deepEqual(normalizeLearningOptions(), defaults);
  assert.deepEqual(
    normalizeLearningOptions({
      n: 100,
      seed: 0,
      redraw: 1_000_000,
      distortion: 0.25,
    }),
    { n: 100, seed: 0, redraw: 1_000_000, distortion: 0.25 },
  );
  assert.deepEqual(
    normalizeLearningOptions({ n: 2000, seed: 0xffffffff, distortion: 6 }),
    { n: 2000, seed: 0xffffffff, redraw: 0, distortion: 6 },
  );
  assert.deepEqual(
    normalizeLearningOptions({
      n: 501,
      seed: -1,
      redraw: 0.5,
      distortion: Infinity,
    } as unknown as LearningOptions),
    defaults,
  );
  assert.deepEqual(
    normalizeLearningOptions({
      seed: 0x100000000,
      redraw: 1_000_001,
      distortion: 0.24,
    }),
    defaults,
  );
});

test("each example is deterministic and records structured synthetic provenance", () => {
  for (const kind of kinds) {
    const first = createLearningDataset(kind, { n: 100, seed: 42 });
    assert.deepEqual(first, createLearningDataset(kind, { n: 100, seed: 42 }));
    assert.equal(first.provenance.synthetic, true);
    const learning = first.provenance.learning as {
      version: number;
      kind: LearningKind;
      options: LearningOptions;
      seeds: object;
    };
    assert.equal(learning.version, 1);
    assert.equal(learning.kind, kind);
    assert.equal(learning.options.seed, 42);
    assert.equal(typeof learning.seeds, "object");
    assert.equal(
      new Set(first.rows.map((row) => row.id)).size,
      first.rows.length,
    );
  }
});

test("outcome redraws preserve every sampling confidence and row identity", () => {
  const original = createLearningDataset("sampling", {
    n: 500,
    seed: 42,
    redraw: 0,
  });
  const redrawn = createLearningDataset("sampling", {
    n: 500,
    seed: 42,
    redraw: 1,
  });
  assert.deepEqual(
    original.rows.map((row) => [row.id, row.confidence]),
    redrawn.rows.map((row) => [row.id, row.confidence]),
  );
  assert.notDeepEqual(
    original.rows.map((row) => row.correct),
    redrawn.rows.map((row) => row.correct),
  );
  assert.ok(
    original.rows.every((row) => row.confidence! >= 0.5 && row.confidence! < 1),
  );
  const larger = createLearningDataset("sampling", {
    n: 2000,
    seed: 42,
    redraw: 0,
  });
  assert.deepEqual(original.rows, larger.rows.slice(0, 500));
  const unchanged = structuredClone(original);
  analyze(original, { split: "exploration", bins: 5, strategy: "equal-width" });
  analyze(original, { split: "exploration", bins: 30, strategy: "equal-mass" });
  assert.deepEqual(original, unchanged);
});

test("the exact twenty-row fixture has zero coarse-bin ECE and 0.2 separated-bin ECE", () => {
  const data = createLearningDataset("binning");
  assert.equal(data.rows.length, 20);
  assert.deepEqual(
    data.rows.slice(0, 10).map((row) => row.confidence),
    Array(10).fill(0.6),
  );
  assert.deepEqual(
    data.rows.slice(10).map((row) => row.confidence),
    Array(10).fill(0.9),
  );
  assert.equal(data.rows.slice(0, 10).filter((row) => row.correct).length, 8);
  assert.equal(data.rows.slice(10).filter((row) => row.correct).length, 7);
  const coarse = analyze(data, {
    split: "exploration",
    bins: 1,
    strategy: "equal-width",
  });
  const separated = analyze(data, {
    split: "exploration",
    bins: 10,
    strategy: "equal-width",
  });
  close(coarse.accuracy, 0.75);
  close(coarse.meanConfidence, 0.75);
  close(coarse.ece, 0);
  close(separated.ece, 0.2);
  assert.deepEqual(coarse.predictions, separated.predictions);
  assert.deepEqual(
    data.rows,
    createLearningDataset("binning", {
      n: 2000,
      seed: 123,
      redraw: 10,
      distortion: 6,
    }).rows,
  );
});

test("logit partitions have independent streams and stable prefixes across sample sizes", () => {
  for (const kind of ["temperature", "group-failure"] as const) {
    const small = createLearningDataset(kind, { n: 100 });
    const large = createLearningDataset(kind, { n: 500 });
    const learning = small.provenance.learning as {
      seeds: Record<string, { logits: number; labels: number }>;
    };
    const seeds = Object.values(learning.seeds).flatMap((seed) => [
      seed.logits,
      seed.labels,
    ]);
    assert.equal(new Set(seeds).size, 6);
    assert.equal(small.rows.length, 300);
    assert.deepEqual(small.classes, [
      "Class A",
      "Class B",
      "Class C",
      "Class D",
    ]);
    for (const split of ["calibration", "policy_validation", "test"] as const) {
      assert.deepEqual(
        rowsIn(small, split),
        rowsIn(large, split).slice(0, 100),
      );
      assert.ok(
        rowsIn(small, split).every(
          (row) =>
            row.logits!.length === 4 &&
            Number.isInteger(row.label) &&
            row.label! >= 0 &&
            row.label! < 4,
        ),
      );
    }
    assert.notDeepEqual(
      rowsIn(small, "calibration").map((row) => row.logits),
      rowsIn(small, "test").map((row) => row.logits),
    );
  }
});

test("changing held-out labels cannot change the fitted temperature", () => {
  const original = createLearningDataset("temperature", { n: 500 });
  const changed = structuredClone(original);
  for (const row of changed.rows) {
    if (row.split !== "calibration") row.label = (row.label! + 1) % 4;
  }
  assert.deepEqual(fitDataset(original), fitDataset(changed));
});

test("known temperature exactly reverses the generator distortion", () => {
  const unit = createLearningDataset("temperature", { n: 100, distortion: 1 });
  const distorted = createLearningDataset("temperature", {
    n: 100,
    distortion: 2.5,
  });
  for (let index = 0; index < unit.rows.length; index++) {
    assert.equal(unit.rows[index].label, distorted.rows[index].label);
    const original = softmax(unit.rows[index].logits!);
    const restored = softmax(distorted.rows[index].logits!, 2.5);
    for (let column = 0; column < 4; column++)
      close(restored[column], original[column]);
  }
});

test("calibration-only fitting approaches the oracle and improves held-out NLL across prespecified seeds", () => {
  for (const seed of [42, 2026, 0]) {
    const data = createLearningDataset("temperature", {
      n: 2000,
      seed,
      distortion: 2.5,
    });
    const fit = fitDataset(data);
    const before = analyze(data, settings);
    const fitted = analyze(data, { ...settings, temperature: fit.temperature });
    const oracle = analyze(data, { ...settings, temperature: 2.5 });
    assert.equal(fit.status, "converged");
    close(fit.temperature, 2.5, 0.5);
    close(fitted.nll, oracle.nll!, 0.02);
    assert.ok(fitted.nll! < before.nll!);
    assert.equal(fitted.accuracy, before.accuracy);
  }
});

test("group preset records different oracle temperatures and exposes global-fit limitations", () => {
  const data = createLearningDataset("group-failure", { n: 2000 });
  const learning = data.provenance.learning as {
    oracleTemperatures: Record<string, number>;
    limitations: string[];
  };
  assert.deepEqual(learning.oracleTemperatures, {
    "mild-distortion": 1,
    "strong-distortion": 4,
  });
  assert.ok(
    learning.limitations.some((line) =>
      line.includes("does not guarantee harm"),
    ),
  );
  for (const split of ["calibration", "policy_validation", "test"] as const) {
    for (const group of Object.keys(learning.oracleTemperatures)) {
      assert.equal(
        data.rows.filter((row) => row.split === split && row.group === group)
          .length,
        1000,
      );
    }
  }
  const fit = fitDataset(data);
  const groupMetrics = Object.entries(learning.oracleTemperatures).map(
    ([group, temperature]) => ({
      global: analyze(data, {
        ...settings,
        group,
        temperature: fit.temperature,
      }),
      oracle: analyze(data, { ...settings, group, temperature }),
    }),
  );
  assert.ok(
    groupMetrics.every(
      ({ global, oracle }) => global.nll! > oracle.nll! + 0.005,
    ),
  );
  assert.ok(
    groupMetrics.every(
      ({ global, oracle }) => global.accuracy === oracle.accuracy,
    ),
  );
  const aggregateBefore = analyze(data, settings);
  const aggregateAfter = analyze(data, {
    ...settings,
    temperature: fit.temperature,
  });
  assert.ok(aggregateAfter.nll! < aggregateBefore.nll!);
});

test("conditional reference passes the exact displayed confidences to the numerical package", () => {
  const data = createLearningDataset("sampling", { n: 100 });
  const options = {
    split: "exploration",
    bins: 10,
    strategy: "equal-width",
    iterations: 200,
    seed: 123,
  } as const;
  const expected = nullEce({
    confidences: data.rows.map((row) => row.confidence!),
    bins: 10,
    strategy: "equal-width",
    iterations: 200,
    seed: 123,
  });
  assert.deepEqual(conditionalReference(data, options), {
    ...expected,
    seed: 123,
  });
  assert.deepEqual(
    conditionalReference(data, options),
    conditionalReference(
      createLearningDataset("sampling", { n: 100, redraw: 1 }),
      options,
    ),
  );
  assert.ok(expected.median > 0 && expected.p95 >= expected.median);
});

test("conditional reference honors selected group, split, and temperature", () => {
  const data = createLearningDataset("group-failure", { n: 100 });
  const options = {
    ...settings,
    group: "strong-distortion",
    temperature: 4,
    iterations: 200,
    seed: 1,
  };
  const selected = analyze(data, options);
  const expected = nullEce({
    confidences: selected.predictions.map((row) => row.confidence),
    bins: 15,
    strategy: "equal-width",
    iterations: 200,
    seed: 1,
  });
  assert.deepEqual(conditionalReference(data, options), {
    ...expected,
    seed: 1,
  });
  assert.equal(selected.n, 50);
});

test("reference work is bounded and empty selections have no numeric evidence", () => {
  const data = createLearningDataset("sampling", { n: 100 });
  const options = {
    split: "exploration",
    bins: 3,
    strategy: "equal-width",
  } as const;
  assert.equal(
    conditionalReference(data, { ...options, iterations: 1 }).iterations,
    200,
  );
  assert.equal(
    conditionalReference(data, { ...options, iterations: 10_000 }).iterations,
    1000,
  );
  const empty = conditionalReference(data, { ...options, split: "test" });
  assert.deepEqual(
    [empty.n, empty.median, empty.mean, empty.p95],
    [0, null, null, null],
  );
  const oversized = createLearningDataset("temperature", { n: 2000 });
  oversized.rows.forEach((row) => {
    row.split = "test";
  });
  assert.throws(
    () => conditionalReference(oversized, settings),
    /at most 2,000 selected rows/,
  );
});
