import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataset } from "../src/domain.ts";
import { AssessmentWorkflow } from "../src/workflow.ts";
import { assessDataset } from "../src/assessment.ts";
import { createAssessment, predictionCsv } from "../src/evidence.ts";
import { exportSnapshot } from "../src/export-snapshot.ts";

export const exposureMatrix = [
  { browser: "Import metadata", mcp: "load_predictions / unloaded summary resource", split: null, raw: false, inspected: false },
  { browser: "Calibration metrics, report preview and download", mcp: "assess_predictions calibration / create_report / report resource", split: "calibration", raw: false, inspected: false },
  { browser: "Policy-validation metrics, report preview and download", mcp: "assess_predictions policy_validation / create_report", split: "policy_validation", raw: false, inspected: false },
  { browser: "Confidence-only exploratory report", mcp: "assess_predictions exploration / create_report", split: "exploration", raw: false, inspected: false },
  { browser: "Selected non-test prediction CSV", mcp: "create_report predictionCsv with client disclosure", split: "policy_validation", raw: false, inspected: false },
  { browser: "Explicit test review", mcp: "review_test with accepted client disclosure", split: "test", raw: false, inspected: true },
  { browser: "All-source JSON with explicit disclosure", mcp: "create_report includeRows with accepted client disclosure", split: "calibration", raw: true, inspected: true },
] as const;

test("cross-interface exposure matrix uses the shared controller for metrics, previews, resources and raw rows", () => {
  const data = parseDataset("id,confidence,correct,split\ncal,.8,1,calibration\npolicy,.8,0,policy_validation\ntest,.9,0,test\nexplore,.7,1,exploration", "matrix.csv");
  for (const row of exposureMatrix) {
    const ledger = new Set<string>();
    const flow = new AssessmentWorkflow(data, ["matrix"], { has: key => ledger.has(key), mark: key => { ledger.add(key); } });
    if (row.split === "test") {
      assert.throws(() => flow.requireInspection("test"), /unopened/);
      assert.equal(flow.state.testViewed, false);
      flow.reviewTest();
    }
    if (row.raw) {
      assert.throws(() => flow.exposeSourceRows(false), /explicit/);
      assert.equal(flow.state.testViewed, false);
      flow.exposeSourceRows(true);
    }
    if (row.split) {
      flow.requireInspection(row.split);
      const assessed = assessDataset(data, { split: row.split, bins: 15, strategy: "equal-width", temperature: 1, applyTemperature: false });
      const record = createAssessment({ dataset: data, hash: "matrix", ...assessed, split: row.split, bins: 15, strategy: "equal-width", temperature: 1, threshold: .8, policy: flow.state, status: flow.status(row.split), fit: null, includeRows: row.raw });
      const snapshot = exportSnapshot(record);
      assert.deepEqual(JSON.parse(snapshot.json), JSON.parse(JSON.stringify(snapshot.record)));
      record.configuration.threshold = .1;
      assert.equal(snapshot.record.configuration.threshold, .8);
      assert.ok(snapshot.html.includes(snapshot.record.status));
      assert.equal(!!snapshot.record.observations, row.raw);
      if (!row.raw && row.split !== "test") assert.ok(!snapshot.html.includes('"id": "test"'));
      const csv = predictionCsv(data, assessed.before, null, row.split);
      assert.equal(csv.split("\r\n").length, 2);
      assert.equal(flow.state.testViewed, row.inspected, row.browser);
    }
    assert.equal(flow.state.testViewed, row.inspected, row.mcp);
  }
});
