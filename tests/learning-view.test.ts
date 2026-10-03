import { test } from "node:test";
import assert from "node:assert/strict";
import {
  learningChooser,
  learningPanel,
  parseLearningSource,
  setLearningSource,
} from "../src/learning-view.ts";
import type { ConditionalReference } from "../src/learning.ts";

const sampling = {
  kind: "sampling",
  options: { n: 500, seed: 42, redraw: 0, distortion: 2.5 },
} as const;
const reference: ConditionalReference = {
  median: 0.1234,
  mean: 0.125,
  p95: 0.2345,
  n: 500,
  bins: 15,
  strategy: "equal-width",
  iterations: 500,
  seed: 42,
};

test("learning links round-trip versioned state without disturbing chart settings", () => {
  const params = new URLSearchParams("bins=30&strategy=equal-mass");
  const state = {
    kind: "group-failure",
    options: { n: 2000, seed: 123, redraw: 8, distortion: 4 },
  } as const;
  setLearningSource(params, state);
  assert.equal(params.get("source"), "learn-v1-group-failure");
  assert.deepEqual(parseLearningSource(params), state);
  assert.equal(params.get("bins"), "30");
  assert.equal(params.get("strategy"), "equal-mass");
});

test("unknown link versions are rejected and invalid parameters use normalized defaults", () => {
  assert.equal(
    parseLearningSource(new URLSearchParams("source=learn-v2-sampling")),
    null,
  );
  assert.equal(
    parseLearningSource(new URLSearchParams("source=learn-v1-unknown")),
    null,
  );
  assert.deepEqual(
    parseLearningSource(
      new URLSearchParams(
        "source=learn-v1-sampling&n=99&seed=Infinity&redraw=-1&distortion=0x4",
      ),
    ),
    sampling,
  );
  assert.equal(
    parseLearningSource(new URLSearchParams("source=learn-v1-sampling&seed="))
      ?.options.seed,
    42,
  );
});

test("reference UI suppresses previous quantiles while busy or failed and escapes errors", () => {
  const ready = learningPanel(sampling, reference, "", false);
  assert.match(ready, /0\.1234/);
  assert.match(ready, /0\.2345/);
  assert.match(ready, /not pass\/fail limits or a bias correction/);
  const busy = learningPanel(sampling, reference, "", true);
  assert.doesNotMatch(busy, /0\.1234/);
  assert.match(busy, /Calculating the conditional/);
  const failed = learningPanel(
    sampling,
    reference,
    '<img src=x onerror="boom">',
    false,
  );
  assert.doesNotMatch(failed, /0\.1234|<img/);
  assert.match(failed, /&lt;img/);
});

test("the fixed binning fixture exposes only controls that can change its assessment", () => {
  const markup = learningPanel(
    { ...sampling, kind: "binning" },
    null,
    "",
    false,
  );
  assert.match(markup, /data-action="combine-bins"/);
  assert.match(markup, /data-action="separate-bins"/);
  assert.doesNotMatch(
    markup,
    /id="learning-n"|id="learning-distortion"|data-action="redraw-learning"/,
  );
  assert.match(markup, /zero ECE/);
  assert.match(markup, /ECE 0\.20/);
});

test("all four examples are available and a valid custom distortion remains selected", () => {
  const chooser = learningChooser();
  for (const kind of ["sampling", "binning", "temperature", "group-failure"]) {
    assert.match(chooser, new RegExp(`data-action="learn-${kind}"`));
  }
  const markup = learningPanel(
    { kind: "temperature", options: { ...sampling.options, distortion: 3 } },
    null,
    "",
    false,
  );
  assert.match(markup, /id="learning-n"/);
  assert.match(markup, /id="learning-distortion"/);
  assert.match(markup, /value="3" selected/);
  assert.match(markup, /Known generator correction: T = 3/);
});
