import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, fitDataset, getRisk, parseDataset } from "../src/domain.ts";
import { numericalRevision } from "../src/version.ts";
import {
  createAssessment,
  fingerprint,
  predictionCsv,
  reportHtml,
} from "../src/evidence.ts";
import {
  assessmentStatus,
  inspectTest,
  lockPolicy,
  newPolicy,
} from "../src/policy.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libraryRoot = resolve(root, "node_modules/@m-sanchez/calibrated");
const output = join(root, "review");
const text = readFileSync(join(root, "public/examples/optdigits.json"), "utf8");
const dataset = parseDataset(text, "optdigits.json");
const hash = await fingerprint(text);
const fit = fitDataset(dataset);
const settings = { bins: 15, strategy: "equal-width" } as const;
const threshold = 0.8;
const validation = analyze(dataset, {
  ...settings,
  split: "policy_validation",
  temperature: fit.temperature,
});
const validationDecision = getRisk(validation.predictions, threshold);
const locked = lockPolicy(newPolicy(), fit.temperature, threshold);
const policy = inspectTest(locked);
const before = analyze(dataset, { ...settings, split: "test" });
const after = analyze(dataset, {
  ...settings,
  split: "test",
  temperature: fit.temperature,
});
const assessment = createAssessment({
  dataset,
  hash,
  before,
  after,
  ...settings,
  split: "test",
  temperature: fit.temperature,
  threshold,
  policy,
  status: assessmentStatus(policy, "test", true),
  fit,
  includeRows: false,
  trustedReference: true,
});

function git(directory: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function treeHash(directory: string, entries: string[]): string {
  const hash = createHash("sha256");
  const paths = entries
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (!existsSync(path)) return [];
      return entry.endsWith("/") ? files(path) : [path];
    })
    .sort();
  for (const path of paths) {
    hash.update(relative(directory, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const appPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const libraryPackage = JSON.parse(
  readFileSync(join(libraryRoot, "package.json"), "utf8"),
);
const software = {
  ...assessment.software,
  app: `${appPackage.name}/${appPackage.version}`,
  numericalLibrary: `${libraryPackage.name}/${libraryPackage.version}`,
  referenceModelRevision: (dataset.provenance.model as { revision: string })
    .revision,
  node: process.version,
  appSource: {
    gitHead: git(root, ["rev-parse", "HEAD"]),
    workingTreeStatus: git(root, ["status", "--porcelain"])
      ? "uncommitted local changes"
      : "clean",
    sha256: treeHash(root, [
      "src/",
      "index.html",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
    ]),
  },
  numericalSource: {
    repository: "https://github.com/m-sanchez/calibrated",
    gitHead: numericalRevision,
    compiledDistributionSha256: treeHash(libraryRoot, ["dist/"]),
  },
  sourceDigestFormat:
    "Sorted relative file path, NUL, file bytes, NUL; UTF-8 path separators normalized to /",
};
const record = {
  ...assessment,
  software,
  review: {
    status: "Reproducible reference assessment",
    thresholdSelection:
      "Threshold fixed at 0.8 for the reproducible review workflow, assessed on policy-validation before test inspection; no threshold search",
    policyValidation: {
      count: validation.n,
      accuracy: validation.accuracy,
      nll: validation.nll,
      ece: validation.ece,
      decision: validationDecision,
    },
    reproduction: "node scripts/create-review-evidence.ts",
    rawObservationsIncluded: false,
    reusablePredictionsContainRowIdentifiers: true,
  },
};
mkdirSync(output, { recursive: true });
writeFileSync(
  join(output, "digits-assessment.html"),
  reportHtml(record),
  "utf8",
);
writeFileSync(
  join(output, "digits-experiment.json"),
  JSON.stringify(record, null, 2) + "\n",
  "utf8",
);
writeFileSync(
  join(output, "digits-predictions.csv"),
  predictionCsv(dataset, before, after, "test"),
  "utf8",
);
console.log(
  JSON.stringify(
    {
      output,
      dataSha256: hash,
      temperature: fit.temperature,
      status: record.status,
      policyValidation: record.review.policyValidation,
      testDecision: record.decision,
      before: { accuracy: before.accuracy, ece: before.ece, nll: before.nll },
      after: { accuracy: after.accuracy, ece: after.ece, nll: after.nll },
      software,
    },
    null,
    2,
  ),
);
