import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const library = join(root, "node_modules/@m-sanchez/calibrated");
const outputRoot = join(root, ".space-build");
const content = new Map<string, Buffer>();
const normalized = (path: string) => path.replaceAll("\\", "/");
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

function files(path: string): string[] {
  const entry = lstatSync(path);
  assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${path}`);
  if (entry.isDirectory())
    return readdirSync(path).flatMap((name) => files(join(path, name))).sort();
  assert.ok(entry.isFile(), `Expected a regular file: ${path}`);
  return [path];
}

function treeHash(directory: string, entries: string[]): string {
  const hash = createHash("sha256");
  for (const path of entries.flatMap((entry) => files(join(directory, entry))).sort()) {
    hash.update(normalized(relative(directory, path)));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function put(path: string, value: Buffer | string): void {
  assert.ok(
    !path.startsWith("/") && !path.includes("\\") &&
      !path.split("/").includes("..") && !content.has(path),
    `Invalid or duplicate package path: ${path}`,
  );
  content.set(path, typeof value === "string" ? Buffer.from(value, "utf8") : value);
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

assert.ok(existsSync(join(dist, "index.html")), "Run npm run build before packaging.");
const appPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const libraryPackage = JSON.parse(readFileSync(join(library, "package.json"), "utf8"));
const dependency = appPackage.dependencies?.["@m-sanchez/calibrated"];
assert.equal(typeof dependency, "string", "The numerical dependency is missing.");
assert.match(
  dependency,
  /^(?:git\+)?https:\/\/github\.com\/m-sanchez\/calibrated(?:\.git)?#[a-f0-9]{40}$/u,
  "Pin the numerical dependency to an exact public Git commit before packaging.",
);
assert.equal(appPackage.license, "MIT");
assert.equal(libraryPackage.license, "MIT");

const appBuildEntries = [
  "src", "index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts",
];
const appBuildHash = treeHash(root, appBuildEntries);
const numericalHash = treeHash(library, ["dist"]);
const builtFiles = files(dist);
const bundle = builtFiles.filter((path) => path.endsWith(".js"))
  .map((path) => readFileSync(path, "utf8")).join("\n");
assert.ok(bundle.includes(appBuildHash), "Application build is stale. Run npm run build.");
assert.ok(bundle.includes(numericalHash), "Numerical build is stale. Run npm run build.");

const publicRoot = join(root, "public");
const publicPaths = new Set<string>();
for (const path of files(publicRoot)) {
  const local = normalized(relative(publicRoot, path));
  publicPaths.add(local);
  const built = join(dist, local);
  assert.ok(existsSync(built), `Missing built public asset: ${local}`);
  assert.equal(digest(readFileSync(built)), digest(readFileSync(path)), `Stale public asset: ${local}`);
}
for (const path of builtFiles) {
  const local = normalized(relative(dist, path));
  assert.ok(
    local === "index.html" || publicPaths.has(local) || /^assets\/[^/]+\.(?:js|css)$/u.test(local),
    `Unexpected production file: ${local}`,
  );
  put(local, readFileSync(path));
}

const card = readFileSync(join(root, "release/SPACE_CARD.md"), "utf8");
assert.match(card, /^---\r?\n/u);
assert.match(card, /^sdk: static\s*$/mu);
assert.match(card, /^app_file: index\.html\s*$/mu);
assert.match(card, /^license: mit\s*$/mu);
assert.match(card, /^pinned: true\s*$/mu);
assert.match(card, /^thumbnail: https:\/\/huggingface\.co\/spaces\/m-sanchez\/calibration-explorer\/resolve\/main\/social-preview\.png\s*$/mu);
assert.doesNotMatch(card, /^app_build_command:/mu);
put("README.md", card);
const appLicense = readFileSync(join(root, "LICENSE"));
const numericalLicense = readFileSync(join(library, "LICENSE"));
assert.match(appLicense.toString("utf8"), /MIT License/u);
assert.match(numericalLicense.toString("utf8"), /MIT License/u);
put("LICENSE", appLicense);
put("licenses/calibrated-MIT.txt", numericalLicense);
put("licenses/UCI-digits-CC-BY-4.0.txt", `Dataset: Optical Recognition of Handwritten Digits
Authors: E. Alpaydin and C. Kaynak (1998)
Source: UCI Machine Learning Repository
DOI: https://doi.org/10.24432/C50P49
License: Creative Commons Attribution 4.0 International
License text: https://creativecommons.org/licenses/by/4.0/legalcode
Source record: examples/README.txt and examples/optdigits.json
Changes: Original training rows were partitioned; pixel features were divided by 16; a multinomial logistic-regression classifier was trained; logits and labels were exported. Source images are not bundled. Original test rows were retained. No endorsement by the dataset authors is implied.
`);
for (const notice of ["fonts/Inter-OFL.txt", "fonts/JetBrainsMono-OFL.txt"]) {
  const bytes = content.get(notice);
  assert.ok(bytes, `Missing font license: ${notice}`);
  assert.match(bytes.toString("utf8"), /SIL Open Font License, Version 1\.1/u);
}
put("social-preview.png", readFileSync(join(root, "docs/assets/social-preview.png")));
put("NOTICE.txt", `Calibration Explorer ${appPackage.version}
Application: Copyright (c) 2026 Miguel Sánchez Durán, MIT. See LICENSE.
Numerical library: ${libraryPackage.name} ${libraryPackage.version}, Copyright (c) 2026 Miguel Sanchez, MIT. See licenses/calibrated-MIT.txt.
Reference data: Alpaydin, E. & Kaynak, C. (1998), Optical Recognition of Handwritten Digits, UCI Machine Learning Repository, https://doi.org/10.24432/C50P49. CC BY 4.0. Attribution and adaptations: licenses/UCI-digits-CC-BY-4.0.txt.
Inter: Copyright (c) 2016 The Inter Project Authors. SIL Open Font License 1.1: fonts/Inter-OFL.txt.
JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors. SIL Open Font License 1.1: fonts/JetBrainsMono-OFL.txt.
Source and reproduction: https://github.com/m-sanchez/calibration-explorer
`);

const status = git(["status", "--porcelain"]);
const manifest = {
  schemaVersion: 1,
  hosting: { sdk: "static", appFile: "index.html", remoteBuildCommand: null },
  application: {
    name: appPackage.name,
    version: appPackage.version,
    source: "https://github.com/m-sanchez/calibration-explorer",
    gitHead: git(["rev-parse", "--verify", "HEAD"]),
    workingTreeDirty: status === null ? null : status.length > 0,
    buildSourceSha256: appBuildHash,
    license: appPackage.license,
  },
  numericalLibrary: {
    name: libraryPackage.name,
    version: libraryPackage.version,
    dependency,
    gitCommit: dependency.split("#")[1],
    sourceSha256: treeHash(library, ["src", "package.json"]),
    distributionSha256: numericalHash,
    license: libraryPackage.license,
  },
  packagingSourceSha256: treeHash(root, ["scripts/build-space.ts", "release/SPACE_CARD.md", "LICENSE"]),
  node: process.version,
  hashEncoding: "Sorted relative paths with forward slashes, NUL, file bytes, NUL for source trees; SHA-256 of file bytes for individual files.",
  files: [...content.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) })),
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
put("manifest.json", manifestBytes);
const stage = join(outputRoot, `calibration-explorer-${digest(manifestBytes).slice(0, 16)}`);
assert.equal(relative(root, outputRoot), ".space-build");
assert.equal(dirname(stage), outputRoot);
if (existsSync(outputRoot)) {
  assert.ok(lstatSync(outputRoot).isDirectory() && !lstatSync(outputRoot).isSymbolicLink(), "The output root must be a local directory.");
} else {
  mkdirSync(outputRoot);
}
if (existsSync(stage)) {
  const existing = files(stage).map((path) => normalized(relative(stage, path))).sort();
  assert.deepEqual(existing, [...content.keys()].sort(), "Existing payload contains different files; it was not overwritten.");
  for (const [path, bytes] of content)
    assert.equal(digest(readFileSync(join(stage, path))), digest(bytes), `Existing payload differs at ${path}; it was not overwritten.`);
} else {
  mkdirSync(stage);
  for (const [path, bytes] of content) {
    const destination = join(stage, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx" });
  }
}
console.log(JSON.stringify({ stage, files: content.size, bytes: [...content.values()].reduce((sum, value) => sum + value.length, 0), manifestSha256: digest(manifestBytes) }, null, 2));
