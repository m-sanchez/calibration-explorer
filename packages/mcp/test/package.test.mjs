import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const examples = join(repoRoot, "public/examples");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const windows = process.platform === "win32";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function files(path) {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => files(join(path, name))) : [path];
}

function treeHash(directory, entries) {
  const hash = createHash("sha256");
  for (const path of entries.flatMap((entry) => files(join(directory, entry))).sort()) {
    hash.update(relative(directory, path).replaceAll("\\", "/")).update("\0").update(readFileSync(path)).update("\0");
  }
  return hash.digest("hex");
}

function npm(args, cwd) {
  const cli = process.env.npm_execpath;
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  return cli?.endsWith(".js") ? execFileSync(process.execPath, [cli, ...args], options) : execFileSync("npm", args, { ...options, shell: windows });
}

test("the packed tarball installs and its bin serves a real MCP round trip", { timeout: 300000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), "calibration-mcp-package-"));
  const packOutput = npm(["pack", "--json", "--pack-destination", work], pkgRoot);
  const [packed] = JSON.parse(packOutput.slice(packOutput.indexOf("[")));
  assert.deepEqual(packed.files.map((file) => file.path).sort(), [
    "LICENSE", "README.md", "dist/NOTICE.txt", "dist/cli.js", "package.json", "public/examples/README.txt", "public/examples/optdigits.json",
  ]);
  const bundle = readFileSync(join(pkgRoot, "dist/cli.js"), "utf8");
  assert.ok(bundle.startsWith("#!/usr/bin/env node\n"));
  assert.ok(bundle.split("\n").length > 1000, "The bundle should stay readable, not minified.");

  const project = join(work, "project");
  await mkdir(project);
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "calibration-mcp-install-check", private: true }));
  npm(["install", "--no-audit", "--no-fund", join(work, packed.filename)], project);
  const installed = join(project, "node_modules", pkg.name);
  assert.equal(readFileSync(join(installed, "public/examples/optdigits.json")).compare(readFileSync(join(examples, "optdigits.json"))), 0);
  const bin = join(project, "node_modules", ".bin", windows ? "calibration-explorer-mcp.cmd" : "calibration-explorer-mcp");
  assert.ok(existsSync(bin));

  const run = (...args) => spawnSync(windows ? `"${bin}"` : bin, args, { cwd: project, encoding: "utf8", shell: windows });
  const version = run("--version");
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `${pkg.version}\n`);
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--input-root DIRECTORY/);
  assert.match(help.stdout, /--output-root DIRECTORY/);
  const missing = run();
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "Configure at least one input root and one output root.");
  const unknown = run("--root", examples);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /^Usage: calibration-explorer-mcp --input-root/);
  const absent = run("--input-root", join(work, "absent"), "--output-root", work);
  assert.equal(absent.status, 1);

  const reports = join(work, "reports");
  await mkdir(reports);
  const client = new Client({ name: "calibration-package-check", version: "1.0.0" }, { capabilities: { elicitation: { form: {} } } });
  await client.connect(new StdioClientTransport({ command: bin, args: ["--input-root", examples, "--output-root", reports], cwd: project, stderr: "pipe" }));
  const call = async (name, args, error = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(!!result.isError, error, JSON.stringify(result));
    return result.structuredContent;
  };
  try {
    const appVersion = /appVersion = "([^"]+)"/.exec(readFileSync(join(repoRoot, "src/version.ts"), "utf8"))[1];
    assert.deepEqual(client.getServerVersion(), { name: "calibration-explorer", version: appVersion });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["assess_predictions", "create_report", "fit_temperature", "load_predictions", "review_test", "set_policy"]);
    assert.equal(tools.find((tool) => tool.name === "review_test")._meta["anthropic/requiresUserInteraction"], true);

    const reference = readFileSync(join(examples, "optdigits.json"));
    let digits = await call("load_predictions", { path: join(examples, "optdigits.json") });
    assert.equal(digits.sha256, sha256(reference));
    assert.equal(digits.rowCount, 2945);
    assert.equal(digits.policy.testViewed, false);
    assert.equal((await call("load_predictions", { reference: true })).sha256, digits.sha256);
    await call("load_predictions", { path: join(pkgRoot, "package.json") }, true);

    digits = await call("fit_temperature", { run: digits.run, revision: digits.revision });
    assert.equal(digits.fit.status, "applied");
    assert.ok(Math.abs(digits.fit.result.temperature - 0.7259783904070843) < 1e-12);
    digits = await call("assess_predictions", { run: digits.run, revision: digits.revision, split: "policy_validation" });
    assert.equal(digits.before.n, 574);
    const saved = await call("create_report", { run: digits.run, revision: digits.revision, directory: reports, name: "package-check" });
    for (const artifact of saved.artifacts) {
      assert.equal(dirname(artifact.path), join(reports, "package-check"));
      assert.equal(sha256(await readFile(artifact.path)), artifact.sha256);
    }
    const record = JSON.parse(await readFile(saved.artifacts[1].path, "utf8"));
    assert.equal(record.configuration.split, "policy_validation");
    assert.equal(record.policy.testViewed, false);
    assert.equal(record.observations, undefined);
    assert.deepEqual(record.software, {
      app: `calibration-explorer/${appVersion}`,
      numericalLibrary: `@m-sanchez/calibrated/${JSON.parse(readFileSync(join(repoRoot, "node_modules/@m-sanchez/calibrated/package.json"), "utf8")).version}`,
      upstreamCommit: /#([a-f0-9]{40})$/.exec(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).dependencies["@m-sanchez/calibrated"])[1],
      appSourceSha256: treeHash(repoRoot, ["src", "mcp", "package.json", "package-lock.json"]),
      numericalDistributionSha256: treeHash(join(repoRoot, "node_modules/@m-sanchez/calibrated"), ["dist"]),
      interface: "local-mcp/stdio; SDK 2.3.0",
    });
    const resource = await client.readResource({ uri: saved.reportUri });
    assert.equal(resource.contents[0].text, await readFile(saved.artifacts[0].path, "utf8"));
  } finally {
    await client.close();
  }
});
