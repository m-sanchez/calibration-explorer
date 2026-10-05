import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const examples = join(repoRoot, "public/examples");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const fixture = JSON.parse(readFileSync(join(pkgRoot, "test/fixtures/worked-example.json"), "utf8"));
const appVersion = /appVersion = "([^"]+)"/.exec(readFileSync(join(repoRoot, "src/version.ts"), "utf8"))[1];
const windows = process.platform === "win32";
const invalidFile = "Invalid prediction file. Check the documented CSV/JSON format and limits; use the browser's local import preview for detailed validation.";
const outsideRoots = "The selected path is outside the configured roots.";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => `"${value}"`;

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
  if (cli?.endsWith(".js")) return execFileSync(process.execPath, [cli, ...args], options);
  return windows ? execFileSync(["npm", ...args.map(quote)].join(" "), { ...options, shell: true }) : execFileSync("npm", args, options);
}

function close(actual, expected, path) {
  assert.ok(Math.abs(actual - expected) <= fixture.tolerance, `${path}: ${actual} differs from ${expected}`);
}

let work, project, bin, inputRoot, outputRoot, outside, installed;

function launch(args, options = {}) {
  return windows
    ? spawn([quote(bin), ...args.map(quote)].join(" "), { cwd: project, shell: true, ...options })
    : spawn(bin, args, { cwd: project, ...options });
}

function runCli(...args) {
  return windows
    ? spawnSync([quote(bin), ...args.map(quote)].join(" "), { cwd: project, encoding: "utf8", shell: true })
    : spawnSync(bin, args, { cwd: project, encoding: "utf8" });
}

async function connect() {
  const client = new Client({ name: "calibration-package-check", version: "1.0.0" }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler("elicitation/create", async () => ({ action: "accept", content: { confirm: true } }));
  await client.connect(new StdioClientTransport({ command: bin, args: ["--input-root", inputRoot, "--output-root", outputRoot], cwd: project, stderr: "pipe" }));
  const call = async (name, args, error = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(!!result.isError, error, JSON.stringify(result));
    return error ? result : result.structuredContent;
  };
  return { client, call };
}

describe("installed package", { timeout: 600000 }, () => {
  before(async () => {
    work = await mkdtemp(join(tmpdir(), "cal ex-"));
    let tarball = process.env.MCP_PACKAGE_TARBALL;
    if (!tarball) {
      const output = npm(["pack", "--json", "--pack-destination", work], pkgRoot);
      tarball = join(work, JSON.parse(output.slice(output.indexOf("[")))[0].filename);
    }
    project = join(work, "client project");
    inputRoot = join(work, "cal ex input");
    outputRoot = join(work, "cal ex reports");
    outside = join(work, "outside");
    for (const directory of [project, inputRoot, outputRoot, outside]) await mkdir(directory);
    copyFileSync(join(examples, "optdigits.json"), join(inputRoot, "optdigits.json"));
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "calibration-mcp-install-check", private: true }));
    npm(["install", "--no-audit", "--no-fund", resolve(tarball)], project);
    installed = join(project, "node_modules", pkg.name);
    bin = join(project, "node_modules", ".bin", windows ? "calibration-explorer-mcp.cmd" : "calibration-explorer-mcp");
  });

  after(async () => {
    if (work) await rm(work, { recursive: true, force: true, maxRetries: 5 });
  });

  test("installs the expected files with a readable bundle", async () => {
    assert.deepEqual(files(installed).map((path) => relative(installed, path).replaceAll("\\", "/")).sort(), [
      "LICENSE", "README.md", "dist/NOTICE.txt", "dist/cli.js", "package.json", "public/examples/README.txt", "public/examples/optdigits.json",
    ]);
    assert.ok(existsSync(bin));
    const bundle = await readFile(join(installed, "dist/cli.js"), "utf8");
    assert.ok(bundle.startsWith("#!/usr/bin/env node\n"));
    assert.ok(bundle.split("\n").length > 1000, "The bundle should stay readable, not minified.");
    assert.equal(sha256(readFileSync(join(installed, "public/examples/optdigits.json"))), fixture.input.sha256);
  });

  test("prints help and version, and reports startup errors on stderr only", () => {
    const version = runCli("--version");
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, `${pkg.version}\n`);
    const help = runCli("--help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--input-root DIRECTORY/);
    assert.match(help.stdout, /--output-root DIRECTORY/);
    const failures = [
      [[], /^Configure at least one input root and one output root\.$/],
      [["--root", inputRoot], /^Usage: calibration-explorer-mcp --input-root/],
      [["--output-root"], /^Usage: calibration-explorer-mcp --input-root/],
      [["--input-root", inputRoot], /^Configure at least one input root and one output root\.$/],
      [["--input-root", join(work, "absent"), "--output-root", outputRoot], /\S/],
    ];
    for (const [args, message] of failures) {
      const result = runCli(...args);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.equal(result.stdout, "", JSON.stringify(args));
      assert.match(result.stderr.trim(), message);
    }
  });

  test("the bundled worked example matches the committed fixture", async () => {
    const { client, call } = await connect();
    try {
      assert.deepEqual(client.getServerVersion(), { name: "calibration-explorer", version: appVersion });
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ["assess_predictions", "create_report", "fit_temperature", "load_predictions", "review_test", "set_policy"]);
      assert.equal(tools.find((tool) => tool.name === "review_test")._meta["anthropic/requiresUserInteraction"], true);

      let run = await call("load_predictions", { reference: true });
      for (const key of ["sha256", "kind", "rowCount", "classCount"]) assert.equal(run[key], fixture.input[key], key);
      assert.deepEqual(run.splitCounts, fixture.input.splitCounts);
      assert.equal(run.policy.testViewed, false);
      run = await call("fit_temperature", { run: run.run, revision: run.revision });
      assert.equal(run.fit.status, "applied");
      close(run.fit.result.temperature, fixture.temperature, "temperature");
      run = await call("assess_predictions", { run: run.run, revision: run.revision, split: "policy_validation" });
      assert.equal(run.before.n, fixture.policyValidation.n);
      run = await call("set_policy", { run: run.run, revision: run.revision, threshold: fixture.policyValidation.threshold, lock: true });
      for (const [key, value] of Object.entries(fixture.policyValidation.decision)) assert.equal(run.decision[key], value, `policy ${key}`);
      assert.equal(run.policy.testViewed, false);
      run = await call("review_test", { run: run.run, revision: run.revision });
      assert.equal(run.status, fixture.test.status);
      assert.equal(run.before.n, fixture.test.n);
      for (const stage of ["before", "after"]) {
        for (const [key, value] of Object.entries(fixture.test[stage])) close(run[stage][key], value, `test ${stage}.${key}`);
      }
      for (const [key, value] of Object.entries(fixture.test.decision)) assert.equal(run.decision[key], value, `test ${key}`);

      const saved = await call("create_report", { run: run.run, revision: run.revision, directory: outputRoot, name: "worked-example", predictionCsv: true });
      assert.deepEqual(saved.artifacts.map((artifact) => basename(artifact.path)), fixture.report.files);
      for (const artifact of saved.artifacts) {
        assert.equal(dirname(artifact.path), join(outputRoot, "worked-example"));
        assert.equal(sha256(await readFile(artifact.path)), artifact.sha256);
      }
      const record = JSON.parse(await readFile(saved.artifacts[1].path, "utf8"));
      assert.deepEqual(Object.keys(record), fixture.report.jsonKeys);
      assert.deepEqual(Object.keys(record.before), fixture.report.measureKeys);
      assert.deepEqual(Object.keys(record.after), fixture.report.measureKeys);
      assert.deepEqual(Object.keys(record.software), fixture.report.softwareKeys);
      assert.deepEqual(record.configuration, fixture.report.configuration);
      assert.deepEqual(record.policy, fixture.report.policy);
      assert.equal(record.status, fixture.test.status);
      assert.equal(record.data.sha256, fixture.input.sha256);
      assert.equal(record.before.bins.length, fixture.report.binCount);
      assert.equal(record.riskCurve.length, fixture.report.riskCurvePoints);
      for (const stage of ["before", "after"]) {
        for (const [key, value] of Object.entries(fixture.test[stage])) close(record[stage][key], value, `record ${stage}.${key}`);
      }
      for (const [key, value] of Object.entries(fixture.test.decision)) assert.equal(record.decision[key], value, `record ${key}`);
      assert.equal(record.observations, undefined);
      assert.deepEqual(record.software, {
        app: `calibration-explorer/${appVersion}`,
        numericalLibrary: `@m-sanchez/calibrated/${JSON.parse(readFileSync(join(repoRoot, "node_modules/@m-sanchez/calibrated/package.json"), "utf8")).version}`,
        upstreamCommit: /#([a-f0-9]{40})$/.exec(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).dependencies["@m-sanchez/calibrated"])[1],
        appSourceSha256: treeHash(repoRoot, ["src", "mcp", "package.json", "package-lock.json"]),
        numericalDistributionSha256: treeHash(join(repoRoot, "node_modules/@m-sanchez/calibrated"), ["dist"]),
        interface: "local-mcp/stdio; SDK 2.3.0",
      });
      const html = await readFile(saved.artifacts[0].path, "utf8");
      assert.deepEqual([...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => match[1]), fixture.report.htmlSections);
      assert.doesNotMatch(html, /<script/i);
      const csv = (await readFile(saved.artifacts[2].path, "utf8")).split("\r\n");
      assert.equal(csv[0], fixture.report.csvHeader);
      assert.equal(csv.length - 1, fixture.report.csvRows);
      const resource = await client.readResource({ uri: saved.reportUri });
      assert.equal(resource.contents[0].text, html);
    } finally {
      await client.close();
    }
  });

  test("refuses invalid files and paths outside the roots without crashing", async () => {
    const { client, call } = await connect();
    try {
      const bad = join(inputRoot, "invalid predictions.csv");
      await writeFile(bad, "id,confidence,correct\nsecret-row,1.5,true");
      const invalid = await call("load_predictions", { path: bad }, true);
      assert.deepEqual(invalid.content, [{ type: "text", text: invalidFile }]);
      assert.ok(!JSON.stringify(invalid).includes("secret-row"));
      await writeFile(join(outside, "input.csv"), "id,confidence,correct\na,.9,1\nb,.6,0");
      assert.deepEqual((await call("load_predictions", { path: join(outside, "input.csv") }, true)).content, [{ type: "text", text: outsideRoots }]);
      assert.deepEqual((await call("load_predictions", { path: "optdigits.json" }, true)).content, [{ type: "text", text: "Use an absolute local path." }]);

      let run = await call("load_predictions", { path: join(inputRoot, "optdigits.json") });
      assert.equal(run.sha256, fixture.input.sha256);
      run = await call("assess_predictions", { run: run.run, revision: run.revision, split: "calibration" });
      assert.deepEqual((await call("create_report", { run: run.run, revision: run.revision, directory: outside, name: "escape" }, true)).content, [{ type: "text", text: outsideRoots }]);
      assert.deepEqual((await call("create_report", { run: run.run, revision: run.revision, directory: inputRoot, name: "escape" }, true)).content, [{ type: "text", text: outsideRoots }]);
      await call("create_report", { run: run.run, revision: run.revision, directory: outputRoot, name: "../escape" }, true);
      assert.deepEqual(await readdir(outside), ["input.csv"]);
      assert.ok(!existsSync(join(work, "escape")));
      const saved = await call("create_report", { run: run.run, revision: run.revision, directory: outputRoot, name: "after-refusals" });
      assert.equal(dirname(saved.artifacts[0].path), join(outputRoot, "after-refusals"));
    } finally {
      await client.close();
    }
  });

  test("stdout carries only JSON-RPC frames", async () => {
    const child = launch(["--input-root", inputRoot, "--output-root", outputRoot], { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve) => child.on("close", resolve));
    const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    const messages = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "raw-stdio-check", version: "1.0.0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, "load_predictions", { path: join(inputRoot, "invalid predictions.csv") }),
      call(4, "load_predictions", { path: join(outside, "input.csv") }),
      call(5, "load_predictions", { reference: true }),
      { jsonrpc: "2.0", id: 6, method: "no/such/method" },
    ];
    const ids = messages.filter((message) => "id" in message).map((message) => message.id);
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    const frames = () => stdout.split("\n").filter((line) => line.trim());
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && ids.some((id) => !frames().some((line) => line.includes(`"id":${id}`)))) await new Promise((wait) => setTimeout(wait, 100));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 30000);
    const code = await exited;
    clearTimeout(timer);

    const parsed = frames().map((line) => JSON.parse(line));
    assert.ok(stdout.endsWith("\n"));
    for (const frame of parsed) assert.equal(frame.jsonrpc, "2.0", JSON.stringify(frame));
    const byId = new Map(parsed.filter((frame) => "id" in frame).map((frame) => [frame.id, frame]));
    assert.deepEqual([...byId.keys()].sort(), ids);
    assert.equal(byId.get(1).result.serverInfo.name, "calibration-explorer");
    assert.equal(byId.get(2).result.tools.length, 6);
    assert.equal(byId.get(3).result.isError, true);
    assert.equal(byId.get(4).result.isError, true);
    assert.equal(byId.get(5).result.structuredContent.sha256, fixture.input.sha256);
    assert.ok(byId.get(6).error);
    assert.equal(code, 0, stderr);
  });
});
