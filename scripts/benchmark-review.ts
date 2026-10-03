import assert from "node:assert/strict";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  analyze,
  fitDataset,
  getRisk,
  MAX_IMPORT_BYTES,
  MAX_ROWS,
  MAX_TOTAL_LOGITS,
  parseDataset,
  riskCurve,
} from "../src/domain.ts";
import { createAssessment, reportHtml } from "../src/evidence.ts";
import { newPolicy } from "../src/policy.ts";

const measurements: Record<string, unknown>[] = [];

function memory() {
  const usage = process.memoryUsage();
  const mib = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
  return { rssMiB: mib(usage.rss), heapUsedMiB: mib(usage.heapUsed) };
}

function measure<T>(name: string, action: () => T): T {
  const before = memory();
  const start = performance.now();
  const value = action();
  measurements.push({
    operation: name,
    milliseconds: Math.round((performance.now() - start) * 100) / 100,
    before,
    after: memory(),
  });
  return value;
}

function close(
  actual: number | null,
  expected: number,
  tolerance = 1e-12,
): void {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs(actual! - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

const confidenceText = measure("Construct 20,000-row confidence CSV", () =>
  [
    "id,confidence,correct",
    ...Array.from(
      { length: MAX_ROWS },
      (_, index) =>
        `confidence-${index},${0.5 + (index % 400) / 800},${index % 5 !== 0}`,
    ),
  ].join("\n"),
);
assert.ok(Buffer.byteLength(confidenceText) < MAX_IMPORT_BYTES);
const confidence = measure("Parse 20,000-row confidence CSV", () =>
  parseDataset(confidenceText, "benchmark.csv"),
);
assert.equal(confidence.rows.length, MAX_ROWS);
const confidenceAnalysis = measure(
  "Analyze confidence data, 100 equal-mass bins",
  () =>
    analyze(confidence, {
      split: "exploration",
      bins: 100,
      strategy: "equal-mass",
    }),
);
assert.equal(confidenceAnalysis.n, MAX_ROWS);
close(confidenceAnalysis.accuracy, 0.8);
assert.equal(
  confidenceAnalysis.bins.reduce((count, bin) => count + bin.count, 0),
  MAX_ROWS,
);
close(
  confidenceAnalysis.bins.reduce((ece, bin) => ece + bin.contribution, 0),
  confidenceAnalysis.ece!,
);
const confidenceCurve = measure(
  "Sort complete confidence risk-coverage curve",
  () => riskCurve(confidenceAnalysis.predictions),
);
assert.equal(confidenceCurve.length, 401);
assert.equal(confidenceCurve.at(-1)!.accepted, MAX_ROWS);
assert.equal(confidenceCurve.at(-1)!.errors, 4000);
const confidenceReport = measure(
  "Create aggregate confidence record and HTML report",
  () => {
    const record = createAssessment({
      dataset: confidence,
      hash: "benchmark-only-no-file-fingerprint",
      before: confidenceAnalysis,
      after: null,
      bins: 100,
      strategy: "equal-mass",
      split: "exploration",
      temperature: 1,
      threshold: 0.8,
      policy: newPolicy(),
      status: "Synthetic benchmark only",
      fit: null,
      includeRows: false,
    });
    assert.equal(record.riskCurve.length, 101);
    assert.equal(record.observations, undefined);
    const html = reportHtml(record);
    assert.equal(html.includes("confidence-19999"), false);
    return { bytes: Buffer.byteLength(html), decision: record.decision };
  },
);

const rowCount = 10_000;
const classCount = 100;
const calibrationCount = 2000;
const logitsText = measure("Construct 1,000,000-logit JSON", () =>
  JSON.stringify({
    schemaVersion: 1,
    name: "Synthetic capacity check",
    classes: Array.from({ length: classCount }, (_, index) => String(index)),
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `logits-${index}`,
      split:
        index < calibrationCount
          ? "calibration"
          : index < 4000
            ? "policy_validation"
            : "test",
      logits: Array.from({ length: classCount }, (_, column) =>
        column === index % classCount ? 4 : 0,
      ),
      label: (index + (index % 7 === 0 ? 1 : 0)) % classCount,
    })),
  }),
);
assert.equal(rowCount * classCount, MAX_TOTAL_LOGITS);
assert.ok(Buffer.byteLength(logitsText) < MAX_IMPORT_BYTES);
const logits = measure("Parse JSON at the 1,000,000-logit cap", () =>
  parseDataset(logitsText, "benchmark.json"),
);
assert.equal(logits.rows.length, rowCount);
assert.equal(
  logits.rows.reduce((sum, row) => sum + row.logits!.length, 0),
  MAX_TOTAL_LOGITS,
);
const fit = measure("Fit temperature on 2,000 rows with 100 classes", () =>
  fitDataset(logits),
);
assert.equal(fit.status, "converged");
const calibrationCorrect = calibrationCount - Math.ceil(calibrationCount / 7);
const calibrationAccuracy = calibrationCorrect / calibrationCount;
const closedFormTemperature =
  4 /
  Math.log(
    ((classCount - 1) * calibrationAccuracy) / (1 - calibrationAccuracy),
  );
close(fit.temperature, closedFormTemperature, 1e-4);
const before = measure("Analyze 6,000 test rows, original logits", () =>
  analyze(logits, { split: "test", bins: 15, strategy: "equal-width" }),
);
const after = measure("Analyze 6,000 test rows, scaled logits", () =>
  analyze(logits, {
    split: "test",
    bins: 15,
    strategy: "equal-width",
    temperature: fit.temperature,
  }),
);
assert.equal(before.n, 6000);
assert.equal(after.n, before.n);
close(after.accuracy, before.accuracy!);
assert.deepEqual(
  before.predictions.map((prediction) => prediction.correct),
  after.predictions.map((prediction) => prediction.correct),
);
assert.ok(Number.isFinite(before.nll) && Number.isFinite(after.nll));
const decision = getRisk(after.predictions, 0.8);
assert.equal(decision.accepted + decision.abstained, after.n);

console.log(
  JSON.stringify(
    {
      purpose:
        "One local Node capacity smoke check with synthetic stress inputs; not a browser benchmark or universal performance guarantee",
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpuCount: cpus().length,
        systemMemoryGiB: Math.round((totalmem() / 1024 ** 3) * 100) / 100,
      },
      memoryMeasurement:
        "Process RSS and heap-used snapshots before and after each synchronous operation; not peak memory; affected by garbage collection and retained fixtures",
      confidence: {
        rows: confidence.rows.length,
        inputBytes: Buffer.byteLength(confidenceText),
        reportBytes: confidenceReport.bytes,
        decision: confidenceReport.decision,
      },
      logits: {
        rows: logits.rows.length,
        classes: classCount,
        totalValues: MAX_TOTAL_LOGITS,
        inputBytes: Buffer.byteLength(logitsText),
        calibrationRows: calibrationCount,
        testRows: before.n,
        fittedTemperature: fit.temperature,
        closedFormTemperature,
        decision,
      },
      assertions:
        "Passed row and value caps, complete bin support, ECE decomposition, known accuracy, tied-risk counts, default export omission, closed-form temperature agreement, unchanged test correctness, and finite NLL",
      measurements,
    },
    null,
    2,
  ),
);
