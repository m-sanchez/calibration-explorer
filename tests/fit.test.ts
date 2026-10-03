import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitTemperature } from "@m-sanchez/calibrated";
import type { LogitSample, TemperatureFit } from "@m-sanchez/calibrated";
import { analyze, parseDataset } from "../src/domain.ts";
import type { Dataset, Row } from "../src/domain.ts";
import { assessFit, attemptFit } from "../src/fit.ts";

const settings = { split: "test", bins: 10, strategy: "equal-width" } as const;

function dataset(rows: Row[]): Dataset {
  return {
    schemaVersion: 1,
    name: "Fit fixture",
    kind: "logits",
    provenance: {},
    rows,
  };
}

function calibrationSamples(): LogitSample[] {
  return Array.from({ length: 10 }, (_, index) => ({
    logits: [Math.log(9), 0],
    label: index < 6 ? 0 : 1,
  }));
}

test("a real-model fit is applied using calibration rows and improves measured held-out NLL", () => {
  const source = readFileSync(
    new URL("../public/examples/optdigits.json", import.meta.url),
    "utf8",
  );
  const data = parseDataset(source, "optdigits.json");
  const before = analyze(data, settings);
  const attempt = attemptFit(data);
  assert.equal(attempt.status, "applied");
  assert.equal(attempt.calibrationRows, 574);
  assert.equal(attempt.result?.status, "converged");
  assert.ok(Math.abs(attempt.result!.temperature - 0.725965852598385) < 0.0001);
  const after = analyze(data, {
    ...settings,
    temperature: attempt.result!.temperature,
  });
  assert.ok(after.nll! < before.nll!);
  assert.equal(after.accuracy, before.accuracy);
  assert.match(attempt.message, /calibration observations only/);
  assert.match(attempt.message, /other splits must be measured separately/);
});

test("an actual iteration-limited candidate remains diagnostic and is not applied", () => {
  const result = fitTemperature(calibrationSamples(), { maxIterations: 1 });
  assert.equal(result.status, "max-iterations");
  const attempt = assessFit(result, 10);
  assert.equal(attempt.status, "rejected");
  assert.equal(attempt.result, result);
  assert.equal(attempt.calibrationRows, 10);
  assert.match(attempt.message, /status max-iterations/);
  assert.match(attempt.message, /No temperature was applied/);
  assert.match(attempt.message, /uses original probabilities/);
});

test("a numerically stalled search is rejected despite its finite candidate", () => {
  const result = fitTemperature(calibrationSamples(), {
    tolerance: Number.MIN_VALUE,
  });
  assert.equal(result.status, "stalled");
  assert.ok(Number.isFinite(result.temperature));
  const attempt = assessFit(result, 10);
  assert.equal(attempt.status, "rejected");
  assert.equal(attempt.result, result);
  assert.match(attempt.message, /status stalled/);
  assert.match(attempt.message, /No temperature was applied/);
});

test("overflowing calibration NLL produces a failed attempt while original test predictions remain available", () => {
  const data = dataset([
    {
      id: "overflow",
      split: "calibration",
      logits: [-Number.MAX_VALUE, Number.MAX_VALUE],
      label: 0,
    },
    { id: "held-out", split: "test", logits: [Math.log(3), 0], label: 0 },
  ]);
  const unchanged = structuredClone(data);
  const before = analyze(data, settings);
  const attempt = attemptFit(data);
  assert.equal(attempt.status, "failed");
  assert.equal(attempt.result, null);
  assert.equal(attempt.calibrationRows, 1);
  assert.match(attempt.message, /NLL exceeds finite numeric range/);
  assert.match(attempt.message, /No temperature was applied/);
  assert.match(attempt.message, /uses original probabilities/);
  assert.deepEqual(data, unchanged);
  assert.deepEqual(analyze(data, settings), before);
  assert.ok(Math.abs(before.predictions[0].confidence - 0.75) < 1e-12);
});

test("a constant objective retains identity scaling with an explicit identifiability limitation", () => {
  const data = dataset([
    { id: "flat-fit", split: "calibration", logits: [3, 3], label: 0 },
    { id: "flat-test", split: "test", logits: [4, 4], label: 1 },
  ]);
  const attempt = attemptFit(data);
  assert.equal(attempt.status, "applied");
  assert.equal(attempt.result?.status, "constant");
  assert.equal(attempt.result?.temperature, 1);
  assert.equal(attempt.result?.improved, false);
  assert.match(attempt.message, /objective is constant/);
  assert.match(attempt.message, /unidentifiable/);
  assert.match(attempt.message, /no improvement is established/);
  assert.deepEqual(
    analyze(data, settings),
    analyze(data, { ...settings, temperature: attempt.result!.temperature }),
  );
});

test("a boundary fit is identified as a boundary rather than an established interior optimum", () => {
  const data = dataset([
    { id: "wrong", split: "calibration", logits: [2, 0], label: 1 },
  ]);
  const attempt = attemptFit(data);
  assert.equal(attempt.status, "applied");
  assert.equal(attempt.result?.status, "boundary");
  assert.equal(attempt.result?.atBound, "hi");
  assert.match(attempt.message, /reached a search boundary/);
  assert.match(attempt.message, /does not establish an interior optimum/);
});

test("invalid numeric candidates are rejected and removed from serializable results", () => {
  const valid = fitTemperature(calibrationSamples());
  const invalid: Partial<TemperatureFit>[] = [
    { temperature: NaN },
    { temperature: Infinity },
    { temperature: 0 },
    { temperature: -1 },
    { nllBefore: NaN },
    { nllBefore: Infinity },
    { nllAfter: NaN },
    { nllAfter: -Infinity },
  ];
  for (const fields of invalid) {
    const attempt = assessFit({ ...valid, ...fields }, 10);
    assert.equal(attempt.status, "rejected");
    assert.equal(attempt.result, null);
    assert.equal(attempt.calibrationRows, 10);
    assert.match(attempt.message, /invalid numerical result/);
    assert.match(attempt.message, /No temperature was applied/);
    assert.equal(JSON.parse(JSON.stringify(attempt)).result, null);
  }
});
