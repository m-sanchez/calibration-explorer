import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataset } from "../src/domain.ts";
import { AssessmentWorkflow } from "../src/workflow.ts";

const history = () => {
  const keys = new Set<string>();
  return { has: (key: string) => keys.has(key), mark: (key: string) => { keys.add(key); } };
};
const dataset = parseDataset("id,confidence,correct,split\na,.8,1,test\nb,.7,0,policy_validation", "input.csv");

test("test-only CSV and logits remain unopened until explicit review", () => {
  for (const input of [
    parseDataset("id,confidence,correct,split\na,.8,1,test", "input.csv"),
    parseDataset('[{"id":"a","logits":[0,1],"label":1,"split":"test"}]', "input.json"),
  ]) {
    const workflow = new AssessmentWorkflow(input, ["test-only"], history());
    assert.equal(workflow.initialSplit(), null);
    assert.equal(workflow.state.testViewed, false);
    assert.throws(() => workflow.requireInspection("test"), /unopened/);
    workflow.reviewTest();
    workflow.requireInspection("test");
    assert.equal(workflow.status("test"), "Exploratory after test inspection");
  }
});

test("another handle and reload cannot erase inspection in the same history", () => {
  const ledger = history();
  const first = new AssessmentWorkflow(dataset, ["same"], ledger);
  const second = new AssessmentWorkflow(dataset, ["same"], ledger);
  assert.equal(first.initialSplit(), "policy_validation");
  first.lock(1, .8, "policy_validation");
  first.reviewTest();
  assert.match(first.status("test"), /^Policy locked/);
  second.lock(1, .8, "policy_validation");
  assert.equal(second.state.changedAfterTest, true);
  first.change();
  first.lock(1, .7, "policy_validation");
  assert.equal(first.state.changedAfterTest, true);
  assert.equal(new AssessmentWorkflow(dataset, ["same"], ledger).state.changedAfterTest, true);
});

test("source exposure and policy locks enforce boundaries", () => {
  const workflow = new AssessmentWorkflow(dataset, ["one"], history());
  assert.throws(() => workflow.exposeSourceRows(false), /explicit/);
  assert.equal(workflow.state.testViewed, false);
  assert.throws(() => workflow.lock(1, .8, "test"), /policy-validation/);
  assert.throws(() => workflow.lock(1, .8, "policy_validation", "group"), /full/);
  assert.throws(() => workflow.lock(1, .8, "policy_validation", undefined, "failed"), /successful/);
  workflow.exposeSourceRows(true);
  assert.equal(workflow.state.changedAfterTest, true);
});
