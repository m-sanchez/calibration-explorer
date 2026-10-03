import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  fitDataset,
  getRisk,
  MAX_CLASSES,
  MAX_IMPORT_BYTES,
  MAX_ROWS,
  MAX_TOTAL_LOGITS,
  parseDataset,
  riskCurve,
} from "../src/domain.ts";
import type { Dataset, Prediction, Row } from "../src/domain.ts";

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

function confidenceDataset(rows: Row[]): Dataset {
  return {
    schemaVersion: 1,
    name: "Fixture",
    kind: "confidence",
    provenance: {},
    rows,
  };
}

function logitDataset(rows: Row[]): Dataset {
  return {
    schemaVersion: 1,
    name: "Fixture",
    kind: "logits",
    provenance: {},
    rows,
  };
}

function parseRows(rows: unknown[]): Dataset {
  return parseDataset(JSON.stringify(rows), "fixture.json");
}

const analysisOptions = {
  split: "test",
  bins: 10,
  strategy: "equal-width",
} as const;

test("ECE equals 0.3 for ten predictions at 0.9 confidence with six correct", () => {
  const dataset = confidenceDataset(
    Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      split: "test",
      confidence: 0.9,
      correct: i < 6,
    })),
  );
  const result = analyze(dataset, analysisOptions);
  close(result.ece, 0.3);
  close(result.meanConfidence, 0.9);
  close(result.accuracy, 0.6);
  close(
    result.bins.reduce((sum, bin) => sum + bin.contribution, 0),
    0.3,
  );
  assert.equal(result.nll, null);
  assert.equal(result.n, 10);
});

test("coarse bins can cancel opposing gaps without changing any predictions", () => {
  const dataset = confidenceDataset([
    { id: "low", split: "test", confidence: 0.25, correct: false },
    { id: "high", split: "test", confidence: 0.75, correct: true },
  ]);
  const one = analyze(dataset, { ...analysisOptions, bins: 1 });
  const two = analyze(dataset, { ...analysisOptions, bins: 2 });
  close(one.ece, 0);
  close(two.ece, 0.25);
  assert.deepEqual(one.predictions, two.predictions);
});

test("empty selections and empty bins have no false zero-valued metrics", () => {
  const dataset = confidenceDataset([
    { id: "only", split: "test", confidence: 0.9, correct: true },
  ]);
  const empty = analyze(dataset, { ...analysisOptions, split: "exploration" });
  assert.equal(empty.n, 0);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.meanConfidence, null);
  assert.equal(empty.ece, null);
  assert.equal(empty.nll, null);
  assert.ok(
    empty.bins.every(
      (bin) =>
        bin.confidence === null &&
        bin.accuracy === null &&
        bin.gap === null &&
        bin.contribution === 0,
    ),
  );
  const populated = analyze(dataset, analysisOptions);
  assert.equal(populated.bins.filter((bin) => bin.count === 0).length, 9);
  assert.ok(
    populated.bins
      .filter((bin) => bin.count === 0)
      .every((bin) => bin.accuracy === null),
  );
});

test("group analysis respects both the group and the split", () => {
  const dataset = confidenceDataset([
    { id: "a", split: "test", group: "north", confidence: 0.9, correct: true },
    { id: "b", split: "test", group: "south", confidence: 0.8, correct: false },
    {
      id: "c",
      split: "calibration",
      group: "north",
      confidence: 0.7,
      correct: false,
    },
  ]);
  const result = analyze(dataset, { ...analysisOptions, group: "north" });
  assert.deepEqual(
    result.predictions.map((row) => row.id),
    ["a"],
  );
  assert.equal(result.predictions[0].group, "north");
  close(result.accuracy, 1);
});

test("CSV supports BOM, CRLF, commas, escaped quotes, and multiline quoted fields", () => {
  const csv =
    '\uFEFFid,confidence,correct,split,group\r\n"case, ""one""",0.9,TRUE,test,"north\r\nwest"\r\ncase-two,0.5,0,,plain\r\n';
  const dataset = parseDataset(csv, "quoted.csv");
  assert.equal(dataset.kind, "confidence");
  assert.deepEqual(dataset.rows[0], {
    id: 'case, "one"',
    confidence: 0.9,
    correct: true,
    split: "test",
    group: "north\r\nwest",
  });
  assert.equal(dataset.rows[1].split, "exploration");
  assert.equal(dataset.rows[1].correct, false);
});

test("CSV accepts optional group and split, preserving hostile-looking strings as data", () => {
  const dataset = parseDataset(
    "id,confidence,correct\n<img src=x onerror=alert(1)>,.75,true\n=1+1,1e-1,false",
    "input.csv",
  );
  assert.equal(dataset.rows[0].id, "<img src=x onerror=alert(1)>");
  assert.equal(dataset.rows[1].id, "=1+1");
  assert.equal(dataset.rows[1].confidence, 0.1);
  assert.equal(dataset.rows[0].split, "exploration");
});

test("CSV rejects quote corruption, missing columns, and extra cells with locations", () => {
  assert.throws(
    () => parseDataset('id,confidence,correct\n"broken,0.9,true', "bad.csv"),
    /CSV row 2: unclosed quoted field/,
  );
  assert.throws(
    () => parseDataset('id,confidence,correct\n"id"oops,0.9,true', "bad.csv"),
    /CSV row 2: unexpected character/,
  );
  assert.throws(
    () => parseDataset('id,confidence,correct\nid"oops,0.9,true', "bad.csv"),
    /CSV row 2: a quote must begin/,
  );
  assert.throws(
    () => parseDataset("id,confidence\na,0.9", "bad.csv"),
    /missing required column "correct"/,
  );
  assert.throws(
    () => parseDataset("id,confidence,correct\na,0.9,true,extra", "bad.csv"),
    /CSV row 2: expected 3 columns, found 4/,
  );
  assert.throws(
    () => parseDataset("id,confidence,correct\na,0.9", "bad.csv"),
    /CSV row 2: expected 3 columns, found 2/,
  );
});

test("CSV rejects duplicate or unexpected headers and missing data", () => {
  assert.throws(
    () => parseDataset("id,confidence,correct,id\na,0.9,true,b", "bad.csv"),
    /duplicate column/,
  );
  assert.throws(
    () =>
      parseDataset("id,confidence,correct,__proto__\na,0.9,true,x", "bad.csv"),
    /unsupported column "__proto__"/,
  );
  assert.throws(
    () => parseDataset("id,confidence,correct\n", "bad.csv"),
    /at least one data row/,
  );
});

test("confidence imports reject nonfinite, blank, out-of-range, and malformed numbers", () => {
  for (const value of [
    "NaN",
    "Infinity",
    "-Infinity",
    "",
    " ",
    "0xFF",
    "=1+1",
    "1e999",
    "-0.1",
    "1.01",
  ]) {
    assert.throws(
      () => parseDataset(`id,confidence,correct\na,${value},true`, "bad.csv"),
      /CSV row 2: confidence must/,
    );
  }
  assert.throws(
    () => parseDataset("id,confidence,correct\na,0.9,yes", "bad.csv"),
    /correct must be true, false, 1, or 0/,
  );
  assert.throws(
    () => parseRows([{ id: "a", confidence: "0.9", correct: true }]),
    /confidence must be a finite number/,
  );
  assert.throws(
    () => parseRows([{ id: "a", confidence: 0.9, correct: 1 }]),
    /correct must be a boolean/,
  );
});

test("duplicate identifiers are rejected across splits and after surrounding whitespace", () => {
  assert.throws(
    () =>
      parseRows([
        {
          id: "duplicate",
          split: "calibration",
          confidence: 0.9,
          correct: true,
        },
        { id: " duplicate ", split: "test", confidence: 0.8, correct: false },
      ]),
    /JSON row 2: duplicate id.*JSON row 1.*unique across splits/,
  );
});

test("JSON object import retains provenance and ordered class names", () => {
  const dataset = parseDataset(
    JSON.stringify({
      schemaVersion: 1,
      name: "Held-out evaluation",
      classes: ["negative", "positive"],
      provenance: { source: "fixture", count: 1 },
      rows: [
        { id: "a", logits: [0, 2], label: 1, split: "test", group: "small" },
      ],
    }),
    "data.json",
  );
  assert.equal(dataset.name, "Held-out evaluation");
  assert.equal(dataset.kind, "logits");
  assert.deepEqual(dataset.classes, ["negative", "positive"]);
  assert.deepEqual(dataset.provenance, { source: "fixture", count: 1 });
  assert.equal(dataset.rows[0].label, 1);
});

test("JSON rejects invalid schema, unknown fields, mixed data, and absent identities", () => {
  assert.throws(() => parseDataset("{bad", "bad.json"), /Invalid JSON/);
  assert.throws(
    () => parseDataset("null", "bad.json"),
    /dataset object or an array/,
  );
  assert.throws(
    () => parseDataset('{"schemaVersion":2,"name":"x","rows":[]}', "bad.json"),
    /schemaVersion must be 1/,
  );
  assert.throws(
    () =>
      parseDataset(
        '{"schemaVersion":1,"name":"x","rows":[],"extra":1}',
        "bad.json",
      ),
    /unsupported field "extra"/,
  );
  assert.throws(
    () =>
      parseRows([
        {
          id: "a",
          confidence: 0.9,
          correct: true,
          logits: [0, 1],
          label: 1,
          split: "test",
        },
      ]),
    /remove confidence and correct/,
  );
  assert.throws(
    () => parseRows([{ confidence: 0.9, correct: true }]),
    /id must be a nonempty string/,
  );
  assert.throws(
    () =>
      parseRows([
        { id: "a", confidence: 0.9, correct: true },
        { id: "b", logits: [0, 1], label: 1 },
      ]),
    /cannot mix confidence rows and logit rows/,
  );
  assert.throws(() => parseRows([]), /at least one row/);
});

test("logit imports require explicit supported splits and finite values", () => {
  assert.throws(
    () => parseRows([{ id: "a", logits: [0, 1], label: 1 }]),
    /logits require an explicit split/,
  );
  assert.throws(
    () => parseRows([{ id: "a", logits: [0, 1], label: 1, split: "train" }]),
    /split must be one of/,
  );
  assert.throws(
    () => parseRows([{ id: "a", logits: [0, null], label: 1, split: "test" }]),
    /logits\[1\] must be a finite number/,
  );
  assert.throws(
    () => parseRows([{ id: "a", logits: [0, "1"], label: 1, split: "test" }]),
    /logits\[1\] must be a finite number/,
  );
  assert.throws(
    () =>
      parseDataset(
        '[{"id":"a","logits":[0,1e999],"label":1,"split":"test"}]',
        "bad.json",
      ),
    /finite number/,
  );
});

test("logit imports reject inconsistent dimensions and invalid zero-based labels", () => {
  assert.throws(
    () => parseRows([{ id: "a", logits: [0], label: 0, split: "test" }]),
    /between 2 and/,
  );
  assert.throws(
    () =>
      parseRows([
        { id: "a", logits: [0, 1], label: 1, split: "test" },
        { id: "b", logits: [0, 1, 2], label: 1, split: "calibration" },
      ]),
    /JSON row 2: expected 2 logits, found 3/,
  );
  for (const label of [-1, 2, 0.5]) {
    assert.throws(
      () => parseRows([{ id: "a", logits: [0, 1], label, split: "test" }]),
      /zero-based integer from 0 to 1/,
    );
  }
  assert.throws(
    () =>
      parseDataset(
        JSON.stringify({
          schemaVersion: 1,
          name: "x",
          classes: ["a", "b", "c"],
          rows: [{ id: "a", logits: [0, 1], label: 1, split: "test" }],
        }),
        "bad.json",
      ),
    /do not match the 3 declared classes/,
  );
  assert.throws(
    () =>
      parseDataset(
        JSON.stringify({
          schemaVersion: 1,
          name: "x",
          classes: ["a", "a"],
          rows: [{ id: "a", logits: [0, 1], label: 1, split: "test" }],
        }),
        "bad.json",
      ),
    /class names must be unique/,
  );
});

test("explicit import limits reject oversized files, row counts, and class counts", () => {
  assert.throws(
    () => parseDataset(" ".repeat(MAX_IMPORT_BYTES + 1), "large.csv"),
    /5 MiB import limit/,
  );
  assert.throws(
    () =>
      parseDataset(
        "€".repeat(Math.floor(MAX_IMPORT_BYTES / 3) + 1),
        "large.csv",
      ),
    /5 MiB import limit/,
  );
  const rows = Array.from({ length: MAX_ROWS + 1 }, (_, index) => ({
    id: String(index),
    confidence: 0.9,
    correct: true,
  }));
  assert.throws(() => parseRows(rows), /20,000 row limit/);
  assert.throws(
    () =>
      parseRows([
        {
          id: "a",
          logits: Array(MAX_CLASSES + 1).fill(0),
          label: 0,
          split: "test",
        },
      ]),
    /between 2 and 100/,
  );
  const wideRows = Array.from(
    { length: MAX_TOTAL_LOGITS / MAX_CLASSES + 1 },
    (_, index) => ({
      id: String(index),
      logits: Array(MAX_CLASSES).fill(0),
      label: 0,
      split: "test",
    }),
  );
  assert.throws(() => parseRows(wideRows), /1,000,000 total-logit limit/);
  assert.throws(
    () => parseDataset("id,confidence,correct\na,0.9,true", "wrong.txt"),
    /Choose a .csv or .json file/,
  );
});

test("logit analysis computes NLL from the full probability distribution", () => {
  const dataset = logitDataset([
    { id: "correct", split: "test", logits: [Math.log(3), 0], label: 0 },
    { id: "incorrect", split: "test", logits: [Math.log(3), 0], label: 1 },
  ]);
  const result = analyze(dataset, analysisOptions);
  close(result.meanConfidence, 0.75);
  close(result.accuracy, 0.5);
  close(result.nll, (-Math.log(0.75) - Math.log(0.25)) / 2);
});

test("temperature scaling preserves raw-logit class choice even when probabilities round to a tie", () => {
  const dataset = logitDataset([
    { id: "tiny-gap", split: "test", logits: [0, Number.MIN_VALUE], label: 1 },
  ]);
  const result = analyze(dataset, {
    ...analysisOptions,
    temperature: Number.MAX_VALUE,
  });
  assert.equal(result.predictions[0].correct, true);
  close(result.predictions[0].confidence, 0.5);
});

test("temperature fitting uses calibration rows and is invariant to test and policy data", () => {
  const calibration: Row[] = Array.from({ length: 10 }, (_, index) => ({
    id: `fit-${index}`,
    split: "calibration",
    logits: [Math.log(9), 0],
    label: index < 6 ? 0 : 1,
  }));
  const baseline = fitDataset(logitDataset(calibration));
  const combined = fitDataset(
    logitDataset([
      ...calibration,
      { id: "test", split: "test", logits: [-100, 100], label: 0 },
      {
        id: "policy",
        split: "policy_validation",
        logits: [100, -100],
        label: 1,
      },
      { id: "explore", split: "exploration", logits: [100, -100], label: 1 },
    ]),
  );
  assert.deepEqual(combined, baseline);
  close(baseline.temperature, Math.log(9) / Math.log(1.5), 0.001);
});

test("temperature fitting refuses confidence-only data and missing calibration rows", () => {
  assert.throws(
    () =>
      fitDataset(
        confidenceDataset([
          { id: "a", split: "test", confidence: 0.9, correct: true },
        ]),
      ),
    /requires raw logits/,
  );
  assert.throws(
    () =>
      fitDataset(
        logitDataset([{ id: "a", split: "test", logits: [0, 1], label: 1 }]),
      ),
    /at least one row with split "calibration"/,
  );
});

test("analysis rejects unsupported bin counts, invalid temperatures, and confidence-only scaling", () => {
  const dataset = confidenceDataset([
    { id: "a", split: "test", confidence: 0.9, correct: true },
  ]);
  for (const bins of [0, 101, 2.5, NaN]) {
    assert.throws(
      () => analyze(dataset, { ...analysisOptions, bins }),
      /bins must be an integer/,
    );
  }
  for (const temperature of [0, -1, NaN, Infinity]) {
    assert.throws(
      () => analyze(dataset, { ...analysisOptions, temperature }),
      /temperature must be a finite positive number/,
    );
  }
  assert.throws(
    () => analyze(dataset, { ...analysisOptions, temperature: 2 }),
    /requires logits/,
  );
});

test("thresholds accept equality and every tied confidence", () => {
  const predictions: Prediction[] = [
    { id: "a", confidence: 0.9, correct: true },
    { id: "b", confidence: 0.8, correct: false },
    { id: "c", confidence: 0.8, correct: true },
    { id: "d", confidence: 0.4, correct: false },
  ];
  assert.deepEqual(getRisk(predictions, 0.8), {
    accepted: 3,
    abstained: 1,
    errors: 1,
    coverage: 0.75,
    risk: 1 / 3,
  });
  assert.deepEqual(riskCurve(predictions), [
    { threshold: null, accepted: 0, errors: 0, coverage: 0, risk: null },
    { threshold: 0.9, accepted: 1, errors: 0, coverage: 0.25, risk: 0 },
    { threshold: 0.8, accepted: 3, errors: 1, coverage: 0.75, risk: 1 / 3 },
    { threshold: 0.4, accepted: 4, errors: 2, coverage: 1, risk: 0.5 },
  ]);
  assert.deepEqual(
    riskCurve([...predictions].reverse()),
    riskCurve(predictions),
  );
  assert.deepEqual(
    predictions.map((prediction) => prediction.id),
    ["a", "b", "c", "d"],
  );
});

test("zero accepted cases have undefined risk, not zero error risk", () => {
  assert.deepEqual(getRisk([{ id: "a", confidence: 0.9, correct: false }], 1), {
    accepted: 0,
    abstained: 1,
    errors: 0,
    coverage: 0,
    risk: null,
  });
  assert.deepEqual(getRisk([], 0.5), {
    accepted: 0,
    abstained: 0,
    errors: 0,
    coverage: null,
    risk: null,
  });
  assert.deepEqual(riskCurve([]), [
    { threshold: null, accepted: 0, errors: 0, coverage: null, risk: null },
  ]);
  assert.throws(() => getRisk([], 1.1), /threshold must be between 0 and 1/);
  assert.throws(
    () => getRisk([{ id: "a", confidence: NaN, correct: true }], 0.5),
    /confidence must be a finite number/,
  );
});
