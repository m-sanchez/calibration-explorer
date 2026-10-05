import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const library = join(repoRoot, "node_modules/@m-sanchez/calibrated");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

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

const pkg = json(join(pkgRoot, "package.json"));
const app = json(join(repoRoot, "package.json"));
const appLock = json(join(repoRoot, "package-lock.json"));
const libraryPackage = json(join(library, "package.json"));
const pinned = /^git\+https:\/\/github\.com\/m-sanchez\/calibrated\.git#([a-f0-9]{40})$/u.exec(app.dependencies["@m-sanchez/calibrated"]);
assert.ok(pinned, "The app must pin @m-sanchez/calibrated to an exact Git commit.");
const commit = pinned[1];
const locked = appLock.packages["node_modules/@m-sanchez/calibrated"];
assert.ok(locked.resolved.endsWith(`#${commit}`), "package-lock.json resolves @m-sanchez/calibrated to a different commit.");
assert.equal(libraryPackage.version, locked.version, "Installed @m-sanchez/calibrated differs from package-lock.json. Run npm ci in the repository root.");
const installed = json(join(repoRoot, "node_modules/.package-lock.json")).packages["node_modules/@m-sanchez/calibrated"];
assert.ok(installed?.resolved?.endsWith(`#${commit}`), "Installed @m-sanchez/calibrated comes from a different commit. Run npm ci in the repository root.");
const versionSource = readFileSync(join(repoRoot, "src/version.ts"), "utf8");
assert.ok(versionSource.includes(`numericalRevision = "${commit}"`), "src/version.ts records a different numerical commit.");
assert.ok(versionSource.includes(`numericalVersion = "${libraryPackage.version}"`), "src/version.ts records a different numerical version.");
for (const name of Object.keys(pkg.dependencies)) {
  assert.equal(pkg.dependencies[name], app.dependencies[name], `${name} must match the exact version the app pins.`);
}
assert.equal(readFileSync(join(pkgRoot, "LICENSE"), "utf8"), readFileSync(join(repoRoot, "LICENSE"), "utf8"), "packages/mcp/LICENSE differs from the repository LICENSE.");

const hashedSources = ["src", "mcp", "package.json", "package-lock.json"];
if (process.env.npm_command === "publish") {
  const changes = execFileSync("git", ["status", "--porcelain", "--", ...hashedSources], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(changes, "", `Commit or discard these changes before publishing, so the recorded hashes match a checkout:\n${changes}`);
}
const appSourceSha256 = treeHash(repoRoot, hashedSources);
const numericalDistributionSha256 = treeHash(library, ["dist"]);
const runtimeHashes = new Map([
  ['await treeHash(project, ["src", "mcp", "package.json", "package-lock.json"])', appSourceSha256],
  ['await treeHash(join(project, "node_modules/@m-sanchez/calibrated"), ["dist"])', numericalDistributionSha256],
]);

const provenance = {
  name: "build-time-source-hashes",
  setup(build) {
    build.onLoad({ filter: /[\\/]mcp[\\/]server\.ts$/ }, (args) => {
      assert.equal(resolve(args.path), join(repoRoot, "mcp/server.ts"));
      let source = readFileSync(args.path, "utf8");
      for (const [expression, value] of runtimeHashes) {
        const parts = source.split(expression);
        assert.equal(parts.length, 2, `mcp/server.ts no longer contains exactly one ${expression}`);
        source = parts.join(JSON.stringify(value));
      }
      return { contents: source, loader: "ts" };
    });
  },
};

rmSync(join(pkgRoot, "dist"), { recursive: true, force: true });
rmSync(join(pkgRoot, "public"), { recursive: true, force: true });
const result = await build({
  entryPoints: [join(pkgRoot, "src/cli.js")],
  outfile: join(pkgRoot, "dist/cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  charset: "utf8",
  minify: false,
  legalComments: "inline",
  external: ["@modelcontextprotocol/server", "@modelcontextprotocol/server/*", "zod"],
  banner: { js: `#!/usr/bin/env node\n// ${pkg.name} ${pkg.version}. MIT. Bundles ${libraryPackage.name} ${libraryPackage.version} (MIT) from commit ${commit}; see NOTICE.txt.` },
  plugins: [provenance],
  metafile: true,
  logLevel: "warning",
});

const inputs = Object.keys(result.metafile.inputs).map((path) => resolve(path).replaceAll("\\", "/"));
assert.ok(inputs.some((path) => path.startsWith(`${library.replaceAll("\\", "/")}/dist/`)), "The bundle does not include the pinned numerical library.");
assert.ok(inputs.some((path) => path.endsWith("/mcp/server.ts")), "The bundle does not include mcp/server.ts.");
const externals = new Set(Object.values(result.metafile.outputs).flatMap((output) => output.imports.filter((entry) => entry.external).map((entry) => entry.path)));
for (const path of externals) {
  assert.ok(path.startsWith("node:") || path === "zod" || path.startsWith("@modelcontextprotocol/server"), `Unexpected runtime import: ${path}`);
}

mkdirSync(join(pkgRoot, "public/examples"), { recursive: true });
for (const name of ["optdigits.json", "README.txt"]) copyFileSync(join(repoRoot, "public/examples", name), join(pkgRoot, "public/examples", name));
writeFileSync(join(pkgRoot, "dist/NOTICE.txt"), `${pkg.name} ${pkg.version}
Source: https://github.com/m-sanchez/calibration-explorer (packages/mcp)

Application and server: Copyright (c) 2026 Miguel Sánchez Durán, MIT. See LICENSE.
Bundled numerical library: ${libraryPackage.name} ${libraryPackage.version}, Git commit ${commit}, MIT. Its license follows.
Reference data: Alpaydin, E. & Kaynak, C. (1998), Optical Recognition of Handwritten Digits, UCI Machine Learning Repository, https://doi.org/10.24432/C50P49. CC BY 4.0. Attribution, adaptations and provenance: public/examples/README.txt.

Build provenance, identical to a checkout of the same commit:
App and MCP source SHA-256 (src, mcp, package.json, package-lock.json): ${appSourceSha256}
Numerical distribution SHA-256 (dist): ${numericalDistributionSha256}

${readFileSync(join(library, "LICENSE"), "utf8")}`);
const summary = { version: pkg.version, appSourceSha256, numericalDistributionSha256, numericalCommit: commit, bytes: statSync(join(pkgRoot, "dist/cli.js")).size };
process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
