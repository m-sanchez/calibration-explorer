import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("every published pin, manifest and server.json carries the package version", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/versions.mjs", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
