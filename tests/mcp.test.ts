import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseDataset } from "../src/domain.ts";
import { attemptFit } from "../src/fit.ts";
import { assessDataset } from "../src/assessment.ts";

async function host(root: string, supportsElicitation = true) {
  const client = new Client({ name: "calibration-integration-check", version: "1.0.0" }, { capabilities: supportsElicitation ? { elicitation: { form: {} } } : {} });
  let approve = true;
  let questions = 0;
  if (supportsElicitation) client.setRequestHandler("elicitation/create", async () => {
    questions++;
    return approve ? { action: "accept", content: { confirm: true } } : { action: "decline" };
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("mcp/cli.ts"), "--input-root", root, "--output-root", root], cwd: process.cwd(), stderr: "pipe" }));
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(!!result.isError, error, JSON.stringify(result));
    return result.structuredContent as Record<string, any>;
  };
  return { client, call, setApproval: (value: boolean) => { approve = value; }, questions: () => questions };
}

test("real stdio client completes local confidence/logit workflows and preserves disclosure boundaries", { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "calibration-mcp-"));
  const confidence = join(root, "confidence.csv");
  await writeFile(confidence, "id,confidence,correct,split\nprivate-a,.9,1,exploration\nprivate-b,.9,0,exploration");
  const testOnly = join(root, "test-only.json");
  await writeFile(testOnly, '[{"id":"private-test","split":"test","logits":[0,1],"label":1}]');
  const hostClient = await host(root);
  const { call, client } = hostClient;
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ["assess_predictions", "create_report", "fit_temperature", "load_predictions", "review_test", "set_policy"]);
    let run = await call("load_predictions", { path: confidence });
    assert.equal(run.policy.testViewed, false);
    assert.equal(run.before, undefined);
    assert.ok(!JSON.stringify(run).includes("private-a"));
    await call("load_predictions", { path: resolve("package.json") }, true);
    const bad = join(root, "invalid.csv");
    await writeFile(bad, "id,confidence,correct\nsecret-id,1.5,true");
    await call("load_predictions", { path: bad }, true);
    const oversized = join(root, "oversized.csv");
    await writeFile(oversized, Buffer.alloc(5 * 1024 * 1024 + 1));
    await call("load_predictions", { path: oversized }, true);
    const outside = await mkdtemp(join(tmpdir(), "calibration-outside-"));
    await writeFile(join(outside, "input.csv"), await readFile(confidence));
    const link = join(root, "escape");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await call("load_predictions", { path: join(link, "input.csv") }, true);
    run = await call("assess_predictions", { run: run.run, revision: run.revision, split: "exploration" });
    assert.equal(run.before.accuracy, .5);
    assert.equal(run.before.ece, .4);
    assert.equal(run.before.nll, null);
    await writeFile(confidence, "id,confidence,correct\nchanged,.1,0");
    const originalHash = run.sha256;
    run = await call("fit_temperature", { run: run.run, revision: run.revision });
    assert.equal(run.fit.status, "failed");
    run = await call("assess_predictions", { run: run.run, revision: run.revision, split: "exploration" });
    assert.equal(run.sha256, originalHash);
    assert.equal(run.before.n, 2);
    const confidenceSaved = await call("create_report", { run: run.run, revision: run.revision, directory: root, name: "confidence" });
    const confidenceRecord = JSON.parse(await readFile(confidenceSaved.artifacts[1].path, "utf8"));
    assert.equal(confidenceRecord.observations, undefined);
    assert.equal(confidenceRecord.data.provenance.included, false);
    assert.equal(confidenceRecord.before.accuracy, .5);
    await call("create_report", { run: run.run, revision: confidenceSaved.revision, directory: root, name: "confidence" }, true);

    let untouched = await call("load_predictions", { path: testOnly });
    assert.equal(untouched.policy.testViewed, false);
    const beforeReview = JSON.stringify(await client.readResource({ uri: untouched.summaryUri }));
    assert.ok(!beforeReview.includes('"accuracy"'));
    await call("assess_predictions", { run: untouched.run, revision: 0, split: "test" }, true);
    hostClient.setApproval(false);
    await call("review_test", { run: untouched.run, revision: 0 }, true);
    assert.ok(!JSON.stringify(await client.readResource({ uri: untouched.summaryUri })).includes('"accuracy"'));
    hostClient.setApproval(true);
    untouched = await call("review_test", { run: untouched.run, revision: 0 });
    assert.equal(untouched.policy.changedAfterTest, true);
    const reopened = await call("load_predictions", { path: testOnly });
    assert.equal(reopened.policy.changedAfterTest, true);

    let digits = await call("load_predictions", { reference: true });
    const original = parseDataset(await readFile("public/examples/optdigits.json", "utf8"), "optdigits.json");
    const fit = attemptFit(original);
    digits = await call("assess_predictions", { run: digits.run, revision: digits.revision, split: "calibration" });
    let unopenedReport = await call("create_report", { run: digits.run, revision: digits.revision, directory: root, name: "calibration-unopened" });
    assert.equal(unopenedReport.policy.testViewed, false);
    assert.equal(JSON.parse(await readFile(unopenedReport.artifacts[1].path, "utf8")).configuration.split, "calibration");
    digits = unopenedReport;
    digits = await call("fit_temperature", { run: digits.run, revision: digits.revision });
    assert.equal(digits.fit.result.temperature, fit.result!.temperature);
    digits = await call("assess_predictions", { run: digits.run, revision: digits.revision, split: "policy_validation" });
    unopenedReport = await call("create_report", { run: digits.run, revision: digits.revision, directory: root, name: "policy-unopened", predictionCsv: true });
    assert.equal(unopenedReport.policy.testViewed, false);
    assert.equal(JSON.parse(await readFile(unopenedReport.artifacts[1].path, "utf8")).configuration.split, "policy_validation");
    digits = unopenedReport;
    const racing = await Promise.all([
      client.callTool({ name: "set_policy", arguments: { run: digits.run, revision: digits.revision, threshold: .8, lock: true } }),
      client.callTool({ name: "set_policy", arguments: { run: digits.run, revision: digits.revision, threshold: .9, lock: true } }),
    ]);
    assert.equal(racing.filter(result => result.isError).length, 1);
    digits = racing.find(result => !result.isError)!.structuredContent as Record<string, any>;
    digits = await call("review_test", { run: digits.run, revision: digits.revision });
    assert.match(digits.status, /^Policy locked/);
    const expected = assessDataset(original, { split: "test", bins: 15, strategy: "equal-width", temperature: fit.result!.temperature, applyTemperature: true });
    assert.equal(digits.before.n, 1797);
    assert.equal(digits.after.nll, expected.after!.nll);
    assert.equal(digits.after.ece, expected.after!.ece);
    assert.equal(digits.before.accuracy, digits.after.accuracy);
    const saved = await call("create_report", { run: digits.run, revision: digits.revision, directory: root, name: "digits", predictionCsv: true });
    const record = JSON.parse(await readFile(saved.artifacts[1].path, "utf8"));
    assert.equal(record.after.nll, digits.after.nll);
    assert.equal(record.status, digits.status);
    assert.match(record.software.appSourceSha256, /^[a-f0-9]{64}$/);
    assert.match(record.software.numericalDistributionSha256, /^[a-f0-9]{64}$/);
    for (const artifact of saved.artifacts) assert.equal(createHash("sha256").update(await readFile(artifact.path)).digest("hex"), artifact.sha256);
    const csv = await readFile(saved.artifacts[2].path, "utf8");
    assert.equal(csv.split("\r\n").length, 1798);
    const resource = await client.readResource({ uri: saved.reportUri });
    assert.equal((resource.contents[0] as { text: string }).text, await readFile(saved.artifacts[0].path, "utf8"));
    digits = await call("set_policy", { run: digits.run, revision: saved.revision, threshold: .7, lock: true });
    assert.equal(digits.policy.changedAfterTest, true);

    let rawRun = await call("load_predictions", { reference: true });
    rawRun = await call("assess_predictions", { run: rawRun.run, revision: rawRun.revision, split: "calibration" });
    hostClient.setApproval(false);
    await call("create_report", { run: rawRun.run, revision: rawRun.revision, directory: root, name: "raw", includeRows: true }, true);
    hostClient.setApproval(true);
    const raw = await call("create_report", { run: rawRun.run, revision: rawRun.revision, directory: root, name: "raw", includeRows: true });
    assert.equal(raw.policy.testViewed, true);
    assert.ok(JSON.parse(await readFile(raw.artifacts[1].path, "utf8")).observations.length > 1797);
    assert.ok(!JSON.stringify(raw).includes('"observations"'));
    await mkdir(".cache", { recursive: true });
    await writeFile(".cache/mcp-verification.json", JSON.stringify({ checkedAt: new Date().toISOString(), transport: "stdio", client: "official TypeScript SDK 2.3.0", humanParticipants: 0,
      confirmation: "Automated client handlers exercised accept and decline; no human host UI was tested.", status: "passed", testRows: record.before.n, temperature: fit.result!.temperature,
      before: { nll: record.before.nll, ece: record.before.ece, accuracy: record.before.accuracy }, after: { nll: record.after.nll, ece: record.after.ece, accuracy: record.after.accuracy },
      confirmationRequests: hostClient.questions(), evidenceDirectory: root, artifactHashes: saved.artifacts.map((file: any) => ({ name: file.path.split(/[\\/]/).at(-1), sha256: file.sha256 })) }, null, 2));
  } finally { await client.close(); }
  const unavailable = await host(root, false);
  try {
    const run = await unavailable.call("load_predictions", { path: testOnly });
    await assert.rejects(async () => {
      const result = await unavailable.client.callTool({ name: "review_test", arguments: { run: run.run, revision: 0 } });
      if (result.isError) throw new Error("Elicitation unavailable");
    });
    const metadata = JSON.stringify(await unavailable.client.readResource({ uri: run.summaryUri }));
    assert.ok(!metadata.includes('"accuracy"'));
  } finally { await unavailable.client.close(); }
});
