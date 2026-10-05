import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const write = process.argv.includes("--write");
const { name, version } = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const pin = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@([0-9A-Za-z.+-]+)`, "g");
const jsonFields = {
  "packages/mcp/package-lock.json": [["version"], ["packages", "", "version"]],
  "packages/mcp/server.json": [["version"], ["packages", 0, "version"]],
  "plugins/calibration-explorer/.claude-plugin/plugin.json": [["version"]],
};
const pinnedFiles = [
  "README.md",
  "docs/mcp.md",
  "packages/mcp/Dockerfile",
  "packages/mcp/README.md",
  "plugins/calibration-explorer/.mcp.json",
  "plugins/calibration-explorer/README.md",
];

const stale = [];
for (const [file, fields] of Object.entries(jsonFields)) {
  const data = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  for (const keys of fields) {
    const parent = keys.slice(0, -1).reduce((value, key) => value[key], data);
    const key = keys[keys.length - 1];
    if (parent[key] !== version) stale.push(`${file} ${keys.join(".")} is ${parent[key]}`);
    parent[key] = version;
  }
  if (write) writeFileSync(join(repoRoot, file), `${JSON.stringify(data, null, 2)}\n`);
}
for (const file of pinnedFiles) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  const pins = [...text.matchAll(pin)].map((match) => match[1]);
  if (!pins.length) stale.push(`${file} has no ${name}@VERSION pin`);
  for (const found of pins) if (found !== version) stale.push(`${file} pins ${found}`);
  if (write) writeFileSync(join(repoRoot, file), text.replace(pin, `${name}@${version}`));
}
if (stale.length && !write) {
  process.stderr.write(`Versions differ from packages/mcp/package.json ${version}:\n${stale.join("\n")}\nRun node packages/mcp/scripts/versions.mjs --write.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${name} ${version}${write ? `: updated ${stale.length} stale value(s)` : " pinned consistently"}\n`);
}
