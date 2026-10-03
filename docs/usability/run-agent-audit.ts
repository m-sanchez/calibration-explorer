import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, fitDataset, getRisk, parseDataset, type Dataset } from "../../src/domain.ts";
import { createAssessment, fingerprint, predictionCsv, reportHtml } from "../../src/evidence.ts";
import { assessmentStatus, changePolicy, inspectTest, lockPolicy, newPolicy, type PolicyState } from "../../src/policy.ts";
import { appVersion, numericalVersion, numericalRevision } from "../../src/version.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, ".cache/agent-audit");
mkdirSync(output, { recursive: true });
const settings = { bins: 15, strategy: "equal-width" } as const;
const results: Record<string, unknown>[] = [];

async function assessment(dataset: Dataset, text: string, split: "test" | "exploration", fit: ReturnType<typeof fitDataset> | null = null, policy: PolicyState = newPolicy(), includeRows = false) {
  const temperature = fit?.temperature ?? 1;
  const before = analyze(dataset, { ...settings, split });
  const after = fit ? analyze(dataset, { ...settings, split, temperature }) : null;
  const record = createAssessment({ dataset, hash: await fingerprint(text), before, after, ...settings, split, temperature, threshold: 0.8, policy, status: assessmentStatus(policy, split, dataset.rows.some(row => row.split === "policy_validation")), fit, includeRows });
  return { record, json: JSON.stringify(record, null, 2), html: reportHtml(record), csv: predictionCsv(dataset, before, after, split) };
}

function save(name: string, bundle: Awaited<ReturnType<typeof assessment>>) {
  for (const format of ["json", "html", "csv"] as const) {
    const path = join(output, `${name}.${format}`);
    writeFileSync(path, bundle[format]);
    assert.equal(readFileSync(path, "utf8"), bundle[format]);
  }
  assert.equal(JSON.parse(bundle.json).before.n, bundle.record.before.n);
  assert.ok(bundle.html.startsWith("<!doctype html>"));
  assert.equal(bundle.csv.split("\r\n").length, bundle.record.before.n + 1);
}

async function run(id: string, task: () => Promise<Record<string, unknown>>) {
  const start = performance.now();
  try {
    results.push({ id, status: "passed", ...(await task()), elapsedMilliseconds: Math.round(performance.now() - start) });
  } catch (error) {
    results.push({ id, status: "failed", error: String(error), elapsedMilliseconds: Math.round(performance.now() - start) });
    process.exitCode = 1;
  }
}

const csvText = "id,confidence,correct\n" + Array.from({ length: 10 }, (_, i) => `generated-${i},0.9,${i < 6}`).join("\n");
const rows = (["calibration", "policy_validation", "test"] as const).flatMap((split, partition) => Array.from({ length: partition === 0 ? 300 : 150 }, (_, i) => {
  const predicted = i % 3;
  return { id: `${split}-generated-${i}`, split, logits: Array.from({ length: 3 }, (_, c) => c === predicted ? 3 : c === (predicted + 1) % 3 ? 0 : -1), label: i % 10 < 7 ? predicted : i % 10 < 9 ? (predicted + 1) % 3 : (predicted + 2) % 3 };
}));
const logitText = JSON.stringify({ schemaVersion: 1, name: "Generated multiclass audit", classes: ["class-0", "class-1", "class-2"], provenance: { source: "Invented audit fixture; no real observations" }, rows });
const logits = parseDataset(logitText, "generated-logits.json");
writeFileSync(join(output, "input-confidence.csv"), csvText);
writeFileSync(join(output, "input-logits.json"), logitText);
writeFileSync(join(output, "input-invalid.csv"), "id,confidence,correct\nx,0.5,true\nx,0.7,false");

await run("A1", async () => {
  const dataset = parseDataset(csvText, "generated-confidence.csv");
  assert.equal(dataset.kind, "confidence");
  assert.ok(dataset.rows.every(row => row.split === "exploration"));
  const bundle = await assessment(dataset, csvText, "exploration");
  assert.equal(bundle.record.before.accuracy, 0.6);
  assert.ok(bundle.record.before.ece !== null);
  assert.ok(Math.abs(bundle.record.before.ece - 0.3) < 1e-12);
  assert.equal(bundle.record.before.nll, null);
  assert.throws(() => fitDataset(dataset), /logits/i);
  assert.throws(() => analyze(dataset, { ...settings, split: "exploration", temperature: 2 }), /logits/i);
  save("a1-confidence", bundle);
  return { scenario: "Confidence CSV import and export", rows: 10, accuracy: 0.6, ece: bundle.record.before.ece, nll: null, fittingRejected: true };
});

await run("A2", async () => {
  const fit = fitDataset(logits);
  assert.equal(fit.status, "converged");
  const modified = structuredClone(logits);
  modified.rows.filter(row => row.split !== "calibration").forEach(row => { row.label = (row.label! + 1) % 3; });
  assert.deepEqual(fitDataset(modified), fit);
  const validation = analyze(logits, { ...settings, split: "policy_validation", temperature: fit.temperature });
  assert.equal(validation.n, 150);
  const policy = inspectTest(lockPolicy(newPolicy(), fit.temperature, 0.8));
  const bundle = await assessment(logits, logitText, "test", fit, policy);
  assert.equal(bundle.record.before.n, 150);
  assert.equal(bundle.record.after!.accuracy, bundle.record.before.accuracy);
  assert.notEqual(bundle.record.after!.meanConfidence, bundle.record.before.meanConfidence);
  save("a2-logits", bundle);
  return { scenario: "Multiclass split fit and export", calibrationRows: 300, policyValidationRows: 150, testRows: 150, temperature: fit.temperature, unchangedFitAfterHeldOutLabelsChange: true, unchangedAccuracy: bundle.record.after!.accuracy, decision: bundle.record.decision };
});

await run("A3", async () => {
  const cases = [
    ["duplicate IDs", "id,confidence,correct\nx,0.5,true\nx,0.7,false", "bad.csv"],
    ["confidence out of range", "id,confidence,correct\nx,1.1,true", "bad.csv"],
    ["incorrect correctness token", "id,confidence,correct\nx,0.5,maybe", "bad.csv"],
    ["malformed JSON", "{", "bad.json"],
    ["label outside class range", JSON.stringify([{ id: "x", logits: [0, 1], label: 2, split: "test" }]), "bad.json"],
    ["missing logit split", JSON.stringify([{ id: "x", logits: [0, 1], label: 1 }]), "bad.json"],
    ["mixed class dimensions", JSON.stringify([{ id: "x", logits: [0, 1], label: 1, split: "test" }, { id: "y", logits: [0, 1, 2], label: 1, split: "test" }]), "bad.json"],
  ];
  const errors = cases.map(([name, text, filename]) => {
    let message = "";
    try { parseDataset(text, filename); } catch (error) { message = (error as Error).message; }
    assert.ok(message, `${name} unexpectedly accepted`);
    return { case: name, error: message };
  });
  return { scenario: "Malformed import rejection", rejected: errors.length, errors };
});

await run("A4", async () => {
  const fit = fitDataset(logits);
  const locked = inspectTest(lockPolicy(newPolicy(), fit.temperature, 0.8));
  const early = lockPolicy(inspectTest(newPolicy()), fit.temperature, 0.8);
  const changed = lockPolicy(changePolicy(locked), fit.temperature, 0.9);
  assert.equal(assessmentStatus(locked, "test", true), "Policy locked before test inspection in this session");
  assert.equal(assessmentStatus(early, "test", true), "Exploratory after test inspection");
  assert.equal(assessmentStatus(changed, "test", true), "Exploratory after test inspection");
  assert.equal(assessmentStatus(locked, "test", true, "generated-group"), "Exploratory group analysis");
  assert.equal(newPolicy(true).changedAfterTest, true);
  const selected = analyze(logits, { ...settings, split: "test", temperature: fit.temperature });
  assert.equal(getRisk(selected.predictions, 1).accepted, 0);
  assert.equal(getRisk(selected.predictions, 1).risk, null);
  return { scenario: "Policy/test order", lockBeforeTest: assessmentStatus(locked, "test", true), testBeforeLock: assessmentStatus(early, "test", true), changedThenRelocked: assessmentStatus(changed, "test", true) };
});

await run("A5", async () => {
  const text = JSON.stringify({ schemaVersion: 1, name: "<script>generatedAudit()</script>", provenance: { marker: "generated-private-provenance" }, rows: [{ id: "=2+3", confidence: 0.9, correct: true, split: "test" }, { id: "generated-private-id", confidence: 0.6, correct: false, split: "test" }] });
  const dataset = parseDataset(text, "generated-export.json");
  const bundle = await assessment(dataset, text, "test");
  save("a5-escaping", bundle);
  assert.doesNotMatch(bundle.html, /<script\b|<iframe\b/i);
  assert.ok(bundle.html.includes("&lt;script&gt;generatedAudit()&lt;/script&gt;"));
  assert.ok(!bundle.json.includes("generated-private-id") && !bundle.json.includes("generated-private-provenance"));
  assert.equal(bundle.record.observations, undefined);
  assert.equal(bundle.record.riskCurve.length, 101);
  assert.ok(bundle.csv.includes('"\'=2+3"'));
  const raw = await assessment(dataset, text, "test", null, inspectTest(newPolicy()), true);
  assert.equal(raw.record.observations?.length, 2);
  assert.equal(raw.record.data.provenance.marker, "generated-private-provenance");
  assert.equal(raw.record.status, "Exploratory after test inspection");
  return { scenario: "Export content safety and raw-data choice", escapedHTML: true, defaultRawRowsOmitted: true, optedInRows: 2, csvFormulaPrefixed: true };
});

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
const sourceHash = createHash("sha256");
for (const path of [...files(join(root, "src")), join(root, "package.json"), join(root, "package-lock.json")].sort()) {
  sourceHash.update(relative(root, path).replaceAll("\\", "/") + "\0");
  sourceHash.update(readFileSync(path));
  sourceHash.update("\0");
}
const summary = { generatedAt: new Date().toISOString(), kind: "agent-led module/CLI audit, not human usability evidence", appVersion, numericalVersion, numericalRevision, node: process.version, gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sourceSha256: sourceHash.digest("hex"), sourceDigestEntries: ["src/", "package.json", "package-lock.json"], inputOrigin: "Generated fixtures only", artifacts: ".cache/agent-audit/", humanParticipants: 0, scenarios: results, limits: ["No browser interaction, rendering, downloads, worker messaging, session storage or hosted networking checked", "No real own-data imports or independent-user replication", "Timing describes this local audit run only"] };
writeFileSync(join(output, "results.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
