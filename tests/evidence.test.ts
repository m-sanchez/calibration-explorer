import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  analyze,
  fitDataset,
  getRisk,
  parseDataset,
  type Dataset,
} from "../src/domain.ts";
import {
  createAssessment,
  fingerprint,
  predictionCsv,
  reportHtml,
} from "../src/evidence.ts";
import {
  assessmentStatus,
  inspectTest,
  lockPolicy,
  newPolicy,
} from "../src/policy.ts";

const source = readFileSync(
  new URL("../public/examples/optdigits.json", import.meta.url),
  "utf8",
);
const digits = parseDataset(source, "optdigits.json");
const options = { split: "test", bins: 15, strategy: "equal-width" } as const;
const scipyReference = {
  temperature: 0.725965852598385,
  accuracy: 0.9488035614913745,
  before: { nll: 0.17595188348336863, ece: 0.03654894805642031 },
  after: { nll: 0.1575263522458592, ece: 0.010078978667266432 },
  generator:
    "scripts/prepare_digits.py; scipy 1.17.1 logsumexp and bounded minimize_scalar in log-temperature",
};

function close(
  actual: number | null,
  expected: number,
  tolerance: number,
): void {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs(actual! - expected) <= tolerance,
    `${actual} differs from ${expected}; tolerance ${tolerance}`,
  );
}

function assess(dataset: Dataset = digits, includeRows = false) {
  const fit = fitDataset(dataset);
  const validation = analyze(dataset, {
    ...options,
    split: "policy_validation",
    temperature: fit.temperature,
  });
  const policyRisk = getRisk(validation.predictions, 0.8);
  assert.ok(policyRisk.accepted > 0);
  const policy = inspectTest(lockPolicy(newPolicy(), fit.temperature, 0.8));
  const before = analyze(dataset, options);
  const after = analyze(dataset, { ...options, temperature: fit.temperature });
  const record = createAssessment({
    dataset,
    hash: createHash("sha256").update(source).digest("hex"),
    before,
    after,
    ...options,
    temperature: fit.temperature,
    threshold: 0.8,
    policy,
    status: assessmentStatus(policy, "test", true),
    fit,
    includeRows,
    trustedReference: dataset === digits,
  });
  return { record, before, after, fit, validation, policyRisk };
}

test("saved real-model assessment agrees with the independent SciPy preparation reference", () => {
  const { before, after, fit, record } = assess();
  assert.equal(before.n, 1797);
  assert.equal(fit.status, "converged");
  close(fit.temperature, scipyReference.temperature, 1e-4);
  close(before.accuracy, scipyReference.accuracy, 1e-14);
  close(after.accuracy, scipyReference.accuracy, 1e-14);
  close(before.nll, scipyReference.before.nll, 1e-12);
  close(before.ece, scipyReference.before.ece, 1e-12);
  close(after.nll, scipyReference.after.nll, 1e-6);
  close(after.ece, scipyReference.after.ece, 1e-5);
  assert.equal(
    record.status,
    "Policy locked before test inspection in this session",
  );
  assert.deepEqual(
    before.predictions.map((row) => row.correct),
    after.predictions.map((row) => row.correct),
  );
});

test("test-label changes cannot alter temperature fitting on the saved real-model dataset", () => {
  const changed = structuredClone(digits);
  changed.rows.forEach((row) => {
    if (row.split === "test" || row.split === "policy_validation")
      row.label = (row.label! + 1) % 10;
  });
  assert.deepEqual(fitDataset(changed), fitDataset(digits));
});

test("default experiment and report omit raw observations and source membership identifiers", () => {
  const { record } = assess();
  const json = JSON.stringify(record);
  const html = reportHtml(record);
  assert.equal(record.observations, undefined);
  assert.equal("predictions" in record.before, false);
  assert.equal("predictions" in record.after!, false);
  for (const id of digits.rows.map((row) => row.id)) {
    assert.equal(json.includes(id), false, `Default JSON leaked ${id}`);
    assert.equal(html.includes(id), false, `Default HTML leaked ${id}`);
  }
  const membership = (
    digits.provenance.splitMethod as { modelFitRowIds: string[] }
  ).modelFitRowIds;
  for (const id of membership) {
    assert.equal(
      json.includes(id),
      false,
      `Default JSON leaked model-fit ID ${id}`,
    );
    assert.equal(
      html.includes(id),
      false,
      `Default HTML leaked model-fit ID ${id}`,
    );
  }
  assert.match(html, /Raw observations and row identifiers are omitted/);
});

test("explicit raw-data inclusion preserves reproducible observations in the JSON record", () => {
  const { record } = assess(digits, true);
  const restored = JSON.parse(JSON.stringify(record));
  assert.deepEqual(restored.observations, digits.rows);
  assert.deepEqual(restored.data.provenance, digits.provenance);
  assert.match(
    reportHtml(record),
    /Observations are included in the companion JSON export/,
  );
});

test("default exports omit arbitrary provenance and use a fixed threshold grid", () => {
  const supplied = structuredClone(digits);
  supplied.provenance = {
    privateSubject: "subject-only-in-provenance",
    nested: { rows: [{ id: "private-nested-row" }] },
  };
  const { record } = assess(supplied);
  const json = JSON.stringify(record);
  assert.equal(json.includes("subject-only-in-provenance"), false);
  assert.equal(json.includes("private-nested-row"), false);
  assert.equal(record.data.provenance.included, false);
  assert.equal(record.riskCurve.length, 101);
  record.riskCurve.forEach((point, index) =>
    close(point.threshold, 1 - index / 100, 1e-14),
  );
  const curveJson = JSON.stringify(record.riskCurve);
  assert.doesNotMatch(curveJson, /"id"\s*:/u);
  supplied.rows.forEach((row) =>
    assert.equal(curveJson.includes(row.id), false),
  );
});

test("HTML report escapes hostile names and nested provenance without active markup", () => {
  const hostile = structuredClone(digits);
  hostile.name = '<img src=x onerror="alert(1)"> & "private"';
  hostile.provenance = {
    source: '</pre><script>alert("source")</script>',
    nested: { note: '<iframe src="https://example.invalid"></iframe>' },
  };
  const { record } = assess(hostile, true);
  const html = reportHtml(record);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/iu);
  assert.ok(
    html.includes(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;private&quot;",
    ),
  );
  assert.ok(html.includes("&lt;/pre&gt;&lt;script&gt;"));
  assert.ok(html.includes("&lt;iframe"));
  assert.doesNotMatch(html, /<script|<link\b|<img\b/iu);
});

test("CSV export neutralizes formula-leading identifiers and doubles embedded quotes", () => {
  const ids = [
    "=SUM(1,2)",
    "+cmd",
    "-cmd",
    "@SUM(A1)",
    "  =SUM(2,3)",
    "\t=1+1",
    "\r=1+1",
    'safe"quoted',
  ];
  const dataset: Dataset = {
    schemaVersion: 1,
    name: "CSV safety fixture",
    kind: "confidence",
    provenance: {},
    rows: ids.map((id, index) => ({
      id,
      split: "test",
      confidence: 0.5 + index / 100,
      correct: index % 2 === 0,
    })),
  };
  const before = analyze(dataset, options);
  const csv = predictionCsv(dataset, before, null, "test");
  for (const id of ids.slice(0, -1))
    assert.ok(
      csv.includes(`"'${id}","test"`),
      `Formula cell was not neutralized: ${JSON.stringify(id)}`,
    );
  assert.ok(csv.includes('"safe""quoted","test"'));
  assert.ok(
    csv.startsWith(
      "id,split,confidence_original,confidence_scaled,correct\r\n",
    ),
  );
});

test("JSON metrics, readable report, and exported predictions describe the same assessment", () => {
  const { record, before, after } = assess();
  const restored = JSON.parse(JSON.stringify(record));
  const html = reportHtml(restored);
  assert.deepEqual(restored.before, record.before);
  assert.deepEqual(restored.after, record.after);
  for (const [label, first, second] of [
    [
      "Accuracy",
      `${(before.accuracy! * 100).toFixed(1)}%`,
      `${(after.accuracy! * 100).toFixed(1)}%`,
    ],
    ["ECE", before.ece!.toFixed(4), after.ece!.toFixed(4)],
    ["NLL (nats / observation)", before.nll!.toFixed(4), after.nll!.toFixed(4)],
  ])
    assert.ok(
      html.includes(`<td>${label}</td><td>${first}</td><td>${second}</td>`),
    );
  assert.ok(html.includes(`${record.decision.accepted} accepted`));
  assert.ok(html.includes(`${record.decision.errors} accepted mistakes`));
  const exported = predictionCsv(digits, before, after, "test")
    .split("\r\n")
    .slice(1);
  assert.equal(exported.length, 1797);
  exported.forEach((line, index) => {
    const cells = line.slice(1, -1).split('","');
    assert.equal(cells[0], before.predictions[index].id);
    assert.equal(Number(cells[2]), before.predictions[index].confidence);
    assert.equal(Number(cells[3]), after.predictions[index].confidence);
    assert.equal(cells[4], String(before.predictions[index].correct));
  });
});

test("fingerprints match independent SHA-256 and identify exact bytes", async () => {
  assert.equal(
    await fingerprint("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const expected = createHash("sha256").update(source).digest("hex");
  assert.equal(await fingerprint(source), expected);
  assert.equal(await fingerprint(source), await fingerprint(source));
  assert.notEqual(await fingerprint(source), await fingerprint(source + " "));
});

test("byte fingerprints preserve a UTF-8 BOM and non-ASCII input exactly", async () => {
  const text = "id,confidence,correct\r\nSánchez-測定-🔎,0.8,true\r\n";
  const raw = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(text, "utf8"),
  ]);
  const bytes = new Uint8Array(raw).buffer;
  const expected = createHash("sha256").update(raw).digest("hex");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(decoded, text);
  assert.equal(await fingerprint(bytes), expected);
  assert.equal(await fingerprint(`\uFEFF${text}`), expected);
  assert.notEqual(await fingerprint(decoded), expected);
  assert.equal(
    await fingerprint(decoded),
    createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"),
  );
});
