import { McpServer, acceptedContent, inputRequired, inputResponse, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDataset, MAX_IMPORT_BYTES, type Dataset, type Split, type Strategy } from "../src/domain.ts";
import { assessDataset, type DatasetAssessment } from "../src/assessment.ts";
import { attemptFit, type FitAttempt } from "../src/fit.ts";
import { AssessmentWorkflow } from "../src/workflow.ts";
import { createAssessment, reportHtml, predictionCsv, type Assessment } from "../src/evidence.ts";
import { appVersion, numericalVersion, numericalRevision } from "../src/version.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const reply = (data: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const confirmation = z.object({ confirm: z.boolean().meta({ title: "Proceed with this disclosure" }) });
const runArgs = { run: z.string().uuid(), revision: z.number().int().min(0) };
const chartArgs = { bins: z.number().int().min(1).max(100).default(15), strategy: z.enum(["equal-width", "equal-mass"]).default("equal-width") };

async function treeHash(directory: string, entries: string[]): Promise<string> {
  async function files(path: string): Promise<string[]> {
    if (!(await stat(path)).isDirectory()) return [path];
    return (await Promise.all((await readdir(path)).map(name => files(join(path, name))))).flat();
  }
  const paths = (await Promise.all(entries.map(entry => files(join(directory, entry))))).flat().sort();
  const hash = createHash("sha256");
  for (const path of paths) hash.update(relative(directory, path).replaceAll("\\", "/")).update("\0").update(await readFile(path)).update("\0");
  return hash.digest("hex");
}

interface Run {
  id: string;
  revision: number;
  dataset: Dataset;
  sha256: string;
  workflow: AssessmentWorkflow;
  fit: FitAttempt | null;
  threshold: number;
  split: Split | null;
  bins: number;
  strategy: Strategy;
  group?: string;
  assessment: DatasetAssessment | null;
  reference: boolean;
}

function contained(root: string, path: string): boolean {
  const delta = relative(root, path);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
}

async function scopedPath(path: string, roots: string[]): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Use an absolute local path.");
  const actual = await realpath(path).catch(() => { throw new Error("The selected path is unavailable."); });
  if (!roots.some(root => contained(root, actual))) throw new Error("The selected path is outside the configured roots.");
  return actual;
}

function consent(ctx: ServerContext, key: string, message: string) {
  const answer = inputResponse(ctx.mcpReq.inputResponses, key);
  if (answer.kind === "elicit" && answer.action !== "accept") return failure("Disclosure cancelled. No results were revealed or files written.");
  const accepted = acceptedContent(ctx.mcpReq.inputResponses, key, confirmation);
  if (accepted && !accepted.confirm) return failure("Disclosure declined. No results were revealed or files written.");
  if (!accepted) return inputRequired({ inputRequests: { [key]: inputRequired.elicit({ message, requestedSchema: confirmation }) } });
  return null;
}

export async function createCalibrationServer(options: { inputRoots: string[]; outputRoots: string[] }) {
  if (!options.inputRoots.length || !options.outputRoots.length) throw new Error("Configure at least one input root and one output root.");
  const inputRoots = await Promise.all(options.inputRoots.map(root => realpath(resolve(root))));
  const outputRoots = await Promise.all(options.outputRoots.map(root => realpath(resolve(root))));
  for (const root of [...inputRoots, ...outputRoots]) if (!(await stat(root)).isDirectory()) throw new Error("Configured roots must be existing directories.");
  const server = new McpServer({ name: "calibration-explorer", version: appVersion });
  const runs = new Map<string, Run>();
  const seen = new Set<string>();
  const history = { has: (key: string) => seen.has(key), mark: (key: string) => { seen.add(key); } };
  let queue = Promise.resolve();
  const serial = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const software: Assessment["software"] = {
    app: `calibration-explorer/${appVersion}`, numericalLibrary: `@m-sanchez/calibrated/${numericalVersion}`,
    upstreamCommit: numericalRevision, appSourceSha256: await treeHash(project, ["src", "mcp", "package.json", "package-lock.json"]),
    numericalDistributionSha256: await treeHash(join(project, "node_modules/@m-sanchez/calibrated"), ["dist"]),
    interface: "local-mcp/stdio; SDK 2.3.0",
  };
  function getRun(id: string, revision?: number): Run {
    const run = runs.get(id);
    if (!run) throw new Error("Unknown run. Load a prediction file in this server session.");
    if (revision !== undefined && revision !== run.revision) throw new Error(`Stale run revision. Read its summary resource; current revision is ${run.revision}.`);
    return run;
  }
  function metadata(run: Run) {
    return { run: run.id, revision: run.revision, sha256: run.sha256, kind: run.dataset.kind, rowCount: run.dataset.rows.length,
      classCount: run.dataset.rows[0].logits?.length ?? null, splitCounts: run.workflow.counts, policy: run.workflow.state,
      split: run.split, summaryUri: `calibration://runs/${run.id}`, historyScope: "This running server process only; prior external inspection and independence are not established." };
  }
  function evaluate(run: Run, split: Split, bins = run.bins, strategy = run.strategy, group?: string) {
    run.workflow.requireInspection(split);
    const temperature = run.fit?.status === "applied" ? run.fit.result!.temperature : 1;
    const assessment = assessDataset(run.dataset, { split, bins, strategy, group, temperature, applyTemperature: run.fit?.status === "applied" });
    if (assessment.evaluationFailure) run.workflow.change();
    Object.assign(run, { split, bins, strategy, group, assessment });
  }
  function record(run: Run, includeRows = false): Assessment {
    if (!run.assessment || !run.split) throw new Error("Assess a permitted split before creating a report.");
    run.workflow.requireInspection(run.split);
    return createAssessment({ dataset: run.dataset, hash: run.sha256, ...run.assessment, bins: run.bins, strategy: run.strategy,
      split: run.split, temperature: run.assessment.after ? run.fit!.result!.temperature : 1, threshold: run.threshold,
      group: run.group, policy: run.workflow.state, status: run.workflow.status(run.split, run.group),
      fit: run.fit?.status === "applied" ? run.fit.result : null, fitAttempt: run.fit, includeRows,
      trustedReference: run.reference, software,
      historyScope: "MCP inspection history applies to this running server process. Restarting the server clears it; external inspection and data independence are not verified.",
    });
  }
  function summary(run: Run) {
    const base = metadata(run);
    if (!run.assessment) return base;
    const result = record(run);
    const compact = (value: Assessment["before"] | null) => value ? { n: value.n, accuracy: value.accuracy, ece: value.ece, nll: value.nll, meanConfidence: value.meanConfidence } : null;
    return { ...base, status: result.status, configuration: result.configuration, before: compact(result.before), after: compact(result.after),
      decision: result.decision, interpretation: result.interpretation, fit: run.fit, evaluationFailure: result.evaluationFailure };
  }
  server.registerResource("methods", "calibration://methods", { mimeType: "text/plain" }, async uri => ({ contents: [{ uri: uri.href, text: "Read local confidence CSV or raw-logit JSON. Fit only calibration rows; choose and lock a threshold on policy_validation; explicitly review test. No training, inference or automatic threshold selection. Raw files stay local by default; returned summaries can reach the client's model provider. Inspection history lasts only for this server process. Default reports require the matching input for reproduction." }] }));
  server.registerTool("load_predictions", { description: "Load one explicit local CSV/JSON path or the bundled digits reference. Returns metadata only; test outcomes stay unopened. Maximum 16 loaded runs per process.", inputSchema: z.object({ path: z.string().optional(), reference: z.boolean().default(false) }).strict() }, args => serial(async () => {
    if (runs.size >= 16) throw new Error("The 16-run session limit was reached. Restart the server to release its snapshots; inspection history will also reset.");
    if (args.reference === !!args.path) throw new Error("Choose exactly one local path or reference=true.");
    const path = args.reference ? join(project, "public/examples/optdigits.json") : await scopedPath(args.path!, inputRoots);
    const file = await open(path, "r");
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error("Choose a regular prediction file no larger than 5 MiB.");
      bytes = Buffer.alloc(MAX_IMPORT_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_IMPORT_BYTES) throw new Error("The input exceeds 5 MiB.");
      bytes = bytes.subarray(0, size);
    } finally { await file.close(); }
    let dataset: Dataset;
    try { dataset = parseDataset(new TextDecoder("utf-8", { fatal: true }).decode(bytes), basename(path)); }
    catch (error) { throw new Error(`Invalid prediction file: ${String(error instanceof Error ? error.message : error).replace(/"[^"\n]*"/g, '"[value]"')}`); }
    const sha256 = digest(bytes);
    const run: Run = { id: randomUUID(), revision: 0, dataset, sha256, workflow: new AssessmentWorkflow(dataset, [sha256], history), fit: null,
      threshold: .8, split: null, bins: 15, strategy: "equal-width", assessment: null, reference: args.reference };
    runs.set(run.id, run);
    server.registerResource(`run-${run.id}`, `calibration://runs/${run.id}`, { mimeType: "application/json" }, async uri => serial(() => ({ contents: [{ uri: uri.href, text: JSON.stringify(summary(run)) }] })));
    return reply(metadata(run));
  }));
  server.registerTool("assess_predictions", { description: "Measure an explicit non-test split using the recorded fit. Returns aggregates, never individual observations.", inputSchema: z.object({ ...runArgs, ...chartArgs, split: z.enum(["calibration", "policy_validation", "exploration"]), group: z.string().max(512).optional() }).strict() }, args => serial(() => {
    const run = getRun(args.run, args.revision);
    evaluate(run, args.split, args.bins, args.strategy, args.group);
    run.revision++;
    return reply(summary(run));
  }));
  server.registerTool("fit_temperature", { description: "Fit temperature using calibration logits only. Changing a fit invalidates any locked policy. Test results are not returned.", inputSchema: z.object(runArgs).strict() }, args => serial(() => {
    const run = getRun(args.run, args.revision);
    run.workflow.change();
    run.fit = attemptFit(run.dataset);
    run.assessment = null;
    run.split = null;
    run.revision++;
    return reply({ ...metadata(run), fit: run.fit });
  }));
  server.registerTool("set_policy", { description: "Evaluate an explicit threshold on full policy_validation, optionally locking the recorded temperature and threshold. Does not optimise thresholds.", inputSchema: z.object({ ...runArgs, threshold: z.number().min(0).max(1), lock: z.boolean().default(false) }).strict() }, args => serial(() => {
    const run = getRun(args.run, args.revision);
    if (!run.workflow.counts.policy_validation) throw new Error("Policy-validation rows are required.");
    evaluate(run, "policy_validation");
    if (args.threshold !== run.threshold) run.workflow.change();
    run.threshold = args.threshold;
    run.revision++;
    if (args.lock) run.workflow.lock(run.assessment!.after ? run.fit!.result!.temperature : 1, run.threshold, "policy_validation", undefined, run.assessment!.evaluationFailure);
    return reply(summary(run));
  }));
  server.registerTool("review_test", { _meta: { "anthropic/requiresUserInteraction": true }, description: "Explicitly reveal test outcomes after a user decision through the client's elicitation interface. Without a lock the assessment becomes exploratory. Clients without elicitation cannot reveal test data.", inputSchema: z.object({ ...runArgs, ...chartArgs }).strict() }, (args, ctx) => serial(() => {
    const run = getRun(args.run, args.revision);
    if (!run.workflow.counts.test) throw new Error("No test observations are available.");
    if (!run.workflow.state.testViewed) {
      const request = consent(ctx, `review-${run.id}-${run.revision}`, run.workflow.state.locked ? "Review test outcomes for the locked temperature and threshold? These outcomes will enter the assistant's context." : "Inspect test outcomes without a locked policy? This makes the assessment exploratory and sends aggregate outcomes to the assistant.");
      if (request) return request;
      run.workflow.reviewTest();
    }
    evaluate(run, "test", args.bins, args.strategy);
    run.revision++;
    return reply(summary(run));
  }));
  server.registerTool("create_report", { description: "Write matching HTML and JSON into a new folder under a configured output root. Optional CSV contains selected-split row IDs; optional source data contains all splits/provenance. Raw exports require client elicitation. Never overwrites.", inputSchema: z.object({ ...runArgs, directory: z.string(), name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).default("assessment"), includeRows: z.boolean().default(false), predictionCsv: z.boolean().default(false) }).strict() }, (args, ctx) => serial(async () => {
    const run = getRun(args.run, args.revision);
    if (!run.assessment || !run.split) throw new Error("Assess a permitted split first.");
    const directory = await scopedPath(args.directory, outputRoots);
    if (args.includeRows || args.predictionCsv) {
      const request = consent(ctx, `rows-${run.id}-${run.revision}`, `${args.includeRows ? "Save all supplied rows and provenance, including test outcomes, in JSON. This records test inspection." : "Save row identifiers, correctness and confidence from the selected split in CSV."} Files will be written under ${directory}.`);
      if (request) return request;
    }
    const destination = join(directory, args.name);
    await mkdir(destination).catch(() => { throw new Error("Choose a new report folder name; existing paths are never overwritten."); });
    if (args.includeRows) run.workflow.exposeSourceRows(true);
    const assessment = record(run, args.includeRows);
    const html = reportHtml(assessment);
    const files = [{ name: "assessment.html", text: html }, { name: "assessment.json", text: JSON.stringify(assessment, null, 2) }];
    if (args.predictionCsv) files.push({ name: "predictions.csv", text: predictionCsv(run.dataset, run.assessment.before, run.assessment.after, run.split) });
    const artifacts = [];
    for (const file of files) {
      const path = join(destination, file.name);
      await writeFile(path, file.text, { flag: "wx", encoding: "utf8" });
      artifacts.push({ path, sha256: digest(file.text), bytes: Buffer.byteLength(file.text) });
    }
    run.revision++;
    const uri = `calibration://reports/${randomUUID()}`;
    server.registerResource(`report-${run.id}-${run.revision}`, uri, { mimeType: "text/html" }, async url => ({ contents: [{ uri: url.href, mimeType: "text/html", text: Buffer.byteLength(html) <= 256 * 1024 ? html : "This report exceeds the 256 KiB resource limit. Open the returned local HTML path to inspect it." }] }));
    return { ...reply({ ...summary(run), artifacts, reportUri: uri, includesAllSourceRows: args.includeRows, includesSelectedPredictionRows: args.predictionCsv }), content: [
      { type: "text" as const, text: JSON.stringify({ artifacts, reportUri: uri, run: run.id, revision: run.revision, status: assessment.status }) },
      { type: "resource_link" as const, uri, name: "Calibration report", mimeType: "text/html" },
    ] };
  }));
  return server;
}
