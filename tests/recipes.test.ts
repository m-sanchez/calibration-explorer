import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDataset } from "../src/domain.ts";

test("both Python recipes produce canonical import files with explicit partitions", () => {
  const directory = mkdtempSync(join(tmpdir(), "calibration-recipes-"));
  for (const [kind, extension, expected] of [["confidence", "csv", { exploration: 3 }], ["logits", "json", { calibration: 2, policy_validation: 2, test: 2 }]] as const) {
    const output = join(directory, `example.${extension}`);
    const result = spawnSync("python", [`public/recipes/export_${kind}.py`, output], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const dataset = parseDataset(readFileSync(output, "utf8"), output);
    assert.equal(dataset.kind, kind);
    const counts: Record<string, number> = {};
    for (const row of dataset.rows) counts[row.split] = (counts[row.split] ?? 0) + 1;
    assert.deepEqual(counts, expected);
    const repeated = spawnSync("python", [`public/recipes/export_${kind}.py`, output], { encoding: "utf8", windowsHide: true });
    assert.notEqual(repeated.status, 0);
  }
});
