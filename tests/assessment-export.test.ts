import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDataset } from "../src/assessment.ts";
import { parseDataset } from "../src/domain.ts";
import { createAssessment, reportHtml } from "../src/evidence.ts";
import { attemptFit } from "../src/fit.ts";
import {
  conditionalReference,
  createLearningDataset,
} from "../src/learning.ts";
import { newPolicy } from "../src/policy.ts";

function assertFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `Nonfinite number in export: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach(assertFiniteNumbers);
  } else if (value !== null && typeof value === "object") {
    Object.values(value).forEach(assertFiniteNumbers);
  }
}

function overflowRecord(extraFailureText = "") {
  const dataset = parseDataset(
    JSON.stringify([
      ...[1, 1, 1, 0].map((label, index) => ({
        id: `calibration-${index}`,
        split: "calibration",
        logits: [0, 0.1],
        label,
      })),
      {
        id: "private-extreme-test",
        split: "test",
        logits: [0, -1e308],
        label: 1,
      },
    ]),
    "overflow.json",
  );
  const fitAttempt = attemptFit(dataset);
  assert.equal(fitAttempt.status, "applied");
  assert.equal(fitAttempt.result?.status, "converged");
  const candidate = fitAttempt.result!;
  assert.ok(Math.abs(candidate.temperature - 0.1 / Math.log(3)) < 1e-4);
  const options = { split: "test", bins: 10, strategy: "equal-width" } as const;
  const assessed = assessDataset(dataset, {
    ...options,
    temperature: candidate.temperature,
    applyTemperature: true,
  });
  assert.ok(assessed.evaluationFailure);
  const record = createAssessment({
    dataset,
    hash: "overflow-fixture-fingerprint",
    before: assessed.before,
    after: assessed.after,
    ...options,
    temperature: assessed.after !== null ? candidate.temperature : 1,
    threshold: 0.8,
    policy: newPolicy(true),
    status: "Exploratory after test inspection",
    fit: candidate,
    fitAttempt,
    evaluationFailure: assessed.evaluationFailure + extraFailureText,
    includeRows: false,
  });
  return { assessed, candidate, record };
}

test("scaled overflow exports original results and keeps the fitted candidate separate", () => {
  const { assessed, candidate, record } = overflowRecord();
  assert.equal(record.configuration.temperature, 1);
  assert.notEqual(candidate.temperature, 1);
  assert.deepEqual(record.fit, candidate);
  assert.deepEqual(record.fitAttempt?.result, candidate);
  assert.equal(record.before.n, 1);
  assert.equal(record.before.nll, 1e308);
  assert.equal(record.before.ece, 1);
  assert.equal(record.before.accuracy, 0);
  assert.equal(record.after, null);
  assert.equal(record.evaluationFailure, assessed.evaluationFailure);
  assert.ok(record.interpretation.includes(assessed.evaluationFailure!));
  assert.deepEqual(record.decision, {
    accepted: 1,
    abstained: 0,
    errors: 1,
    coverage: 1,
    risk: 1,
  });
  assert.ok(
    record.riskCurve.every((point) => point.risk === 1 && point.errors === 1),
  );

  const html = reportHtml(record);
  assert.match(
    html,
    /<td>Accuracy<\/td><td>0\.0%<\/td><td>Unavailable: scaled evaluation failed<\/td>/,
  );
  assert.match(
    html,
    /<td>ECE<\/td><td>1\.0000<\/td><td>Unavailable: scaled evaluation failed<\/td>/,
  );
  assert.match(
    html,
    /<td>NLL \(nats \/ observation\)<\/td><td>1e\+308<\/td><td>Unavailable: scaled evaluation failed<\/td>/,
  );
  assert.equal(
    (html.match(/Unavailable: scaled evaluation failed/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    html,
    /<td>After \d+<\/td>|◆ After scaling|<td>Not fitted<\/td>/,
  );
  assert.match(html, /No scaled assessment is available/);

  assertFiniteNumbers(record);
  const json = JSON.stringify(record);
  assert.doesNotMatch(json, /NaN|Infinity/);
  const restored = JSON.parse(json);
  assert.equal(restored.before.nll, 1e308);
  assert.equal(restored.after, null);
  assert.equal(restored.configuration.temperature, 1);
  assert.equal(restored.fit.temperature, candidate.temperature);
  assert.equal(restored.observations, undefined);
  assert.equal("predictions" in restored.before, false);
  assert.doesNotMatch(json, /private-extreme-test/);
});

test("application failure details remain readable without becoming active HTML", () => {
  const { record } = overflowRecord(
    ' <img src=x onerror="alert(1)"> & </pre><script>bad()</script>',
  );
  const html = reportHtml(record);
  assert.match(html, /Unavailable: scaled evaluation failed/);
  assert.match(
    html,
    /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;\/pre&gt;&lt;script&gt;/,
  );
  assert.doesNotMatch(html, /<(?:img|script|iframe)\b/iu);
  const restored = JSON.parse(JSON.stringify(record));
  assert.equal(restored.evaluationFailure, record.evaluationFailure);
  assert.equal(restored.after, null);
});

test("synthetic assessment exports generator state and conditional reference without raw observations", () => {
  const settings = { n: 100, seed: 42, redraw: 3, distortion: 2.5 } as const;
  const dataset = createLearningDataset("sampling", settings);
  const options = {
    split: "exploration",
    bins: 15,
    strategy: "equal-width",
  } as const;
  const assessed = assessDataset(dataset, {
    ...options,
    applyTemperature: false,
  });
  const reference = conditionalReference(dataset, {
    ...options,
    iterations: 200,
    seed: 7,
  });
  const learning = {
    ...(dataset.provenance.learning as Record<string, unknown>),
    conditionalReference: reference,
    conditionalReferenceError: null,
  };
  const record = createAssessment({
    dataset,
    hash: "generated-fixture-fingerprint",
    before: assessed.before,
    after: assessed.after,
    ...options,
    temperature: 1,
    threshold: 0.8,
    policy: newPolicy(),
    status: "Exploratory analysis",
    fit: null,
    learning,
    includeRows: false,
  });
  assert.equal(record.learning?.version, 1);
  assert.equal(record.learning?.kind, "sampling");
  assert.deepEqual(record.learning?.options, settings);
  assert.match(
    String(record.learning?.generator),
    /independent Bernoulli outcomes/,
  );
  assert.deepEqual(record.learning?.splitSizes, { exploration: 100 });
  assert.ok(
    record.learning?.seeds && typeof record.learning.seeds === "object",
  );
  assert.deepEqual(record.learning?.conditionalReference, reference);
  assert.equal(reference.iterations, 200);
  assert.equal(reference.seed, 7);
  assert.equal(reference.n, 100);
  assert.equal(record.before.nll, null);
  assert.equal(record.after, null);
  assert.equal(record.observations, undefined);
  assert.equal("predictions" in record.before, false);
  assert.equal(record.data.provenance.included, false);

  assertFiniteNumbers(record);
  const json = JSON.stringify(record);
  assert.doesNotMatch(json, /NaN|Infinity/);
  const restored = JSON.parse(json);
  assert.deepEqual(restored.learning, learning);
  assert.equal(restored.before.nll, null);
  for (const row of dataset.rows)
    assert.equal(json.includes(`"${row.id}"`), false);
  const html = reportHtml(record);
  assert.match(html, /<h2>Controlled example<\/h2>/);
  assert.match(html, /This is synthetic data/);
  assert.match(
    html,
    /not a pass\/fail threshold or an amount to subtract from ECE/,
  );
  assert.match(html, /Raw observations and row identifiers are omitted/);
});
