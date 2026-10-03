import "./style.css";
import { appVersion, numericalVersion, numericalRevision } from "./version.ts";
import { workflowGuide, metricGuide, metricHelp, splitDescription } from "./help.ts";
import type { TemperatureFit } from "@m-sanchez/calibrated";
import { failedFit, type FitAttempt } from "./fit.ts";
import {
  createLearningDataset,
  normalizeLearningOptions,
  type LearningKind,
  type LearningOptions,
  type ConditionalReference,
} from "./learning.ts";
import {
  learningChooser,
  learningPanel,
  parseLearningSource,
  setLearningSource,
  type LearningState,
} from "./learning-view.ts";
import {
  parseDataset,
  getRisk,
  MAX_IMPORT_BYTES,
  type Dataset,
  type Split,
  type Strategy,
  type Analysis,
  type RiskPoint,
} from "./domain.ts";
import {
  escapeHtml as h,
  percent,
  decimal,
  reliabilitySvg,
  riskSvg,
} from "./charts.ts";
import {
  fingerprint,
  createAssessment,
  reportHtml,
  predictionCsv,
  interpretation,
} from "./evidence.ts";
import {
  newPolicy,
  changePolicy,
  lockPolicy,
  inspectTest,
  assessmentStatus,
  type PolicyState,
} from "./policy.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
let dataset: Dataset | null = null,
  hash = "",
  reference = false;
let split: Split = "policy_validation",
  bins = 15,
  strategy: Strategy = "equal-width",
  threshold = 0.8,
  group = "";
let fit: TemperatureFit | null = null,
  fitAttempt: FitAttempt | null = null;
let pendingFocus = "",
  modalOpener = "";
let learning: LearningState | null = null,
  conditional: ConditionalReference | null = null;
let referenceWorker: Worker | null = null,
  referenceBusy = false,
  referenceError = "",
  evaluationFailure: string | null = null;
let policy: PolicyState = newPolicy(),
  before: Analysis | null = null,
  after: Analysis | null = null,
  curve: RiskPoint[] = [];
let selected = -1,
  selectedSeries = "before",
  busy = "",
  error = "",
  toast = "",
  includeRows = false;
let worker: Worker | null = null,
  sequence = 0,
  loadEpoch = 0,
  importEpoch = 0;
let pending: {
    dataset: Dataset;
    text: string;
    bytes: ArrayBuffer;
    filename: string;
  } | null = null,
  importOpen = false;
const splitNames: Record<Split, string> = {
  calibration: "Calibration",
  policy_validation: "Policy validation",
  test: "Test",
  exploration: "Exploration",
};
const workspaceViews = ["inspect", "calibrate", "decide", "export"] as const;
type WorkspaceView = (typeof workspaceViews)[number];
let workspaceView: WorkspaceView = "inspect";
const viewNames: Record<WorkspaceView, string> = {
  inspect: "Inspect", calibrate: "Calibrate", decide: "Decide", export: "Export",
};
const panelAttributes = (view: WorkspaceView) =>
  `id="panel-${view}" role="tabpanel" aria-labelledby="tab-${view}" tabindex="0" ${workspaceView === view ? "" : "hidden"}`;

function setWorkspaceView(view: WorkspaceView, focus = true): void {
  workspaceView = view;
  for (const name of workspaceViews) {
    const tab = document.getElementById(`tab-${name}`);
    tab?.setAttribute("aria-selected", String(name === view));
    tab?.setAttribute("tabindex", name === view ? "0" : "-1");
    const panel = document.getElementById(`panel-${name}`);
    if (panel) panel.hidden = name !== view;
  }
  if (focus) document.getElementById(`tab-${view}`)?.focus({ preventScroll: true });
}

const temperature = () => fit?.temperature ?? 1;
const effectiveTemperature = () => (after ? temperature() : 1);
const count = (s: Split) =>
  dataset?.rows.filter((row) => row.split === s).length ?? 0;
const current = () => after ?? before;
const status = () =>
  assessmentStatus(
    policy,
    split,
    count("policy_validation") > 0,
    group || undefined,
  );
const inspectedKey = (value: string) =>
  `calibration-explorer:test-inspected:${value}`;
const learningFamily = () =>
  learning
    ? `learning-v1:${learning.kind}:${learning.options.seed}:${learning.options.redraw}`
    : null;

function loadSessionInspection(value: string): boolean {
  try {
    return sessionStorage.getItem(inspectedKey(value)) === "yes";
  } catch {
    return false;
  }
}
function rememberInspection(): void {
  try {
    sessionStorage.setItem(inspectedKey(hash), "yes");
    const family = learningFamily();
    if (family) sessionStorage.setItem(inspectedKey(family), "yes");
  } catch {}
}

function notify(message: string): void {
  toast = message;
  render();
  setTimeout(() => {
    toast = "";
    document.querySelector(".toast")?.remove();
  }, 3500);
}

async function activate(
  next: Dataset,
  text: string,
  isReference: boolean,
  epoch = ++loadEpoch,
  bytes?: ArrayBuffer,
  learningState: LearningState | null = null,
): Promise<void> {
  const nextHash = await fingerprint(bytes ?? text);
  if (epoch !== loadEpoch) return;
  worker?.terminate();
  sequence++;
  dataset = next;
  workspaceView = "inspect";
  hash = nextHash;
  reference = isReference;
  learning = learningState;
  fit = null;
  fitAttempt = null;
  before = null;
  after = null;
  curve = [];
  includeRows = false;
  group = "";
  selected = -1;
  const family = learningFamily();
  policy = newPolicy(
    loadSessionInspection(hash) ||
      (family !== null && loadSessionInspection(family)),
  );
  threshold = 0.8;
  error = "";
  pending = null;
  importOpen = false;
  (document.activeElement as HTMLElement)?.blur();
  pendingFocus = "assessment-title";
  split = count("policy_validation")
    ? "policy_validation"
    : count("calibration")
      ? "calibration"
      : count("exploration")
        ? "exploration"
        : "test";
  if (split === "test") {
    policy = inspectTest(policy);
    rememberInspection();
  }
  calculate();
}

async function loadLearning(
  kind: LearningKind,
  options: Partial<LearningOptions> = {},
): Promise<void> {
  const state = { kind, options: normalizeLearningOptions(options) };
  const next = createLearningDataset(kind, state.options);
  await activate(
    next,
    JSON.stringify(next, null, 2),
    false,
    ++loadEpoch,
    undefined,
    state,
  );
}

async function loadReference(): Promise<void> {
  const epoch = ++loadEpoch;
  worker?.terminate();
  worker = null;
  sequence++;
  referenceWorker?.terminate();
  referenceWorker = null;
  referenceBusy = false;
  busy = "Loading reference predictions";
  render();
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}examples/optdigits.json`,
    );
    if (!response.ok)
      throw new Error(
        "The reference file is unavailable. You can still import your own file.",
      );
    const bytes = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    await activate(
      parseDataset(text, "optdigits.json"),
      text,
      true,
      epoch,
      bytes,
    );
  } catch (e) {
    if (epoch !== loadEpoch) return;
    busy = "";
    error = String(e instanceof Error ? e.message : e);
    render();
  }
}

function calculate(type: "analyze" | "fit" = "analyze"): void {
  if (!dataset) return;
  if (type === "fit") {
    fit = null;
    fitAttempt = null;
    policy = changePolicy(policy);
  }
  worker?.terminate();
  referenceWorker?.terminate();
  referenceWorker = null;
  referenceBusy = false;
  conditional = null;
  referenceError = "";
  const id = ++sequence;
  busy =
    type === "fit"
      ? "Fitting on calibration observations only"
      : "Calculating assessment";
  error = "";
  before = null;
  after = null;
  curve = [];
  evaluationFailure = null;
  render();
  worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent) => {
    if (event.data.id !== sequence) return;
    worker?.terminate();
    worker = null;
    busy = "";
    if (event.data.error) {
      if (type === "fit") {
        fitAttempt = failedFit(count("calibration"), event.data.error);
        calculate();
        return;
      }
      error = event.data.error;
      render();
      return;
    }
    if (type === "fit") {
      fitAttempt = event.data.attempt;
      fit = fitAttempt?.status === "applied" ? fitAttempt.result : null;
      calculate();
      return;
    }
    before = event.data.before;
    after = event.data.after;
    curve = event.data.curve;
    evaluationFailure = event.data.evaluationFailure;
    if (evaluationFailure) policy = changePolicy(policy);
    const selectedBins =
      (selectedSeries === "after" ? after : before)?.bins ?? [];
    if (selected < 0 || !selectedBins[selected]?.count) {
      selectedSeries = after ? "after" : "before";
      selected = (after ?? before)!.bins.findIndex((b) => b.count > 0);
    }
    render();
    calculateReference(id);
  };
  worker.onerror = () => {
    if (id !== sequence) return;
    worker?.terminate();
    worker = null;
    busy = "";
    if (type === "fit") {
      fitAttempt = failedFit(
        count("calibration"),
        "The calculation worker could not complete.",
      );
      calculate();
      return;
    }
    error =
      "The calculation could not complete. Reduce the file size or reload the application.";
    render();
  };
  worker.postMessage({
    id,
    type,
    dataset,
    options: {
      split,
      bins,
      strategy,
      temperature: temperature(),
      applyTemperature: fit !== null,
      group: group || undefined,
    },
  });
}

function calculateReference(id: number): void {
  if (!dataset || learning?.kind !== "sampling") return;
  referenceBusy = true;
  renderReference();
  const task = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  referenceWorker = task;
  task.onmessage = (event: MessageEvent) => {
    if (id !== sequence) return;
    task.terminate();
    referenceWorker = null;
    referenceBusy = false;
    conditional = event.data.reference ?? null;
    referenceError = event.data.error ?? "";
    renderReference();
  };
  task.onerror = () => {
    if (id !== sequence) return;
    task.terminate();
    referenceWorker = null;
    referenceBusy = false;
    referenceError =
      "The reference simulation could not complete. Observed metrics remain available.";
    renderReference();
  };
  task.postMessage({
    id,
    type: "reference",
    dataset,
    options: { split, bins, strategy, temperature: 1 },
  });
}

function renderReference(): void {
  const panel = document.getElementById("learning-panel");
  if (!panel || !learning) return;
  const focused = (document.activeElement as HTMLElement)?.id;
  panel.innerHTML = learningPanel(
    learning,
    conditional,
    referenceError,
    referenceBusy,
  );
  bindLearningControls(panel);
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

function metrics(): string {
  if (!before) return "";
  const active = current()!;
  return `<div class="metrics"><div><div class="metric-label">Accuracy ${metricHelp("accuracy")}</div><strong>${percent(active.accuracy)}</strong><small>${after ? `Original ${percent(before.accuracy)}` : "Correct predictions"}</small></div><div><div class="metric-label">ECE ${metricHelp("ece")}</div><strong>${decimal(active.ece)}</strong><small>${after ? `Original ${decimal(before.ece)}` : "0–1 scale"}</small></div><div><div class="metric-label">${dataset?.kind === "logits" ? "NLL" : "Confidence"} ${metricHelp(dataset?.kind === "logits" ? "nll" : "confidence")}</div><strong>${dataset?.kind === "logits" ? decimal(active.nll) : percent(active.meanConfidence)}</strong><small>${dataset?.kind === "logits" ? (after ? `Original ${decimal(before.nll)}` : "Nats per observation") : "Mean confidence"}</small></div></div>`;
}

function comparison(): string {
  if (!before || !after) return "";
  return `<div class="fit-comparison"><h3>Results on ${h(splitNames[split].toLowerCase())}</h3><table><thead><tr><th>Measure</th><th>Original</th><th>Scaled</th></tr></thead><tbody><tr><th>Accuracy</th><td>${percent(before.accuracy)}</td><td>${percent(after.accuracy)}</td></tr><tr><th>ECE</th><td>${decimal(before.ece)}</td><td>${decimal(after.ece)}</td></tr><tr><th>NLL</th><td>${decimal(before.nll)}</td><td>${decimal(after.nll)}</td></tr></tbody></table><p class="small muted">${after.n.toLocaleString()} observations · ${bins} ${strategy} bins${group ? ` · ${h(group)}` : ""}</p><button class="text-button" data-view-link="inspect">Inspect the reliability diagram</button></div>`;
}

function fitSummary(): string {
  if (fit)
    return `<span class="eyebrow">Fitted temperature</span><strong>${decimal(fit.temperature, 5)}</strong><p>${count("calibration")} calibration observations · ${h(fit.status)}</p><p class="muted">Calibration NLL: ${decimal(fit.nllBefore)} to ${decimal(fit.nllAfter)}</p>${fitAttempt && fit.status !== "converged" ? `<p class="warning">${h(fitAttempt.message)}</p>` : ""}`;
  if (fitAttempt)
    return `<span class="eyebrow">${fitAttempt.status === "failed" ? "Fit failed" : "Fit not applied"}</span><strong class="placeholder-temperature">T = 1</strong><p class="warning">${h(fitAttempt.message)}</p><p>The report includes this attempt with the original assessment. You can retry or import another file.</p>`;
  return '<span class="eyebrow">Original probabilities</span><strong class="placeholder-temperature">T = 1</strong><p>No temperature fitted yet.</p>';
}

function binDetail(): string {
  const result = selectedSeries === "after" ? after : before;
  const bin = result?.bins[selected];
  if (!bin || !bin.count)
    return "<p>Select a populated point to inspect the evidence behind ECE.</p>";
  const matches = result!.predictions.filter(
    (row) =>
      row.confidence >= bin.range[0] &&
      (strategy === "equal-mass" || bin.range[1] === 1
        ? row.confidence <= bin.range[1]
        : row.confidence < bin.range[1]),
  );
  return `<p class="eyebrow">${selectedSeries === "after" ? "After scaling" : "Original"} · Bin ${selected + 1}</p><h3>Selected bin</h3><div class="bin-n"><strong>${bin.count}</strong><span>predictions</span></div><dl class="bin-values"><div><dt>Mean confidence</dt><dd>${percent(bin.confidence)}</dd></div><div><dt>Observed accuracy</dt><dd>${percent(bin.accuracy)}</dd></div><div><dt>Absolute gap</dt><dd>${percent(bin.gap)}</dd></div><div class="contribution"><dt>Contribution to ECE</dt><dd>${decimal(bin.contribution)}</dd></div></dl><p class="formula">${bin.count} / ${result!.n} × ${decimal(bin.gap)} = ${decimal(bin.contribution)}</p><details><summary>Inspect ${Math.min(matches.length, 5)} sample rows</summary><table class="mini-table"><thead><tr><th>ID</th><th>Confidence</th><th>Correct</th></tr></thead><tbody>${matches
    .slice(0, 5)
    .map(
      (row) =>
        `<tr><td>${h(row.id)}</td><td>${percent(row.confidence)}</td><td>${row.correct ? "Yes" : "No"}</td></tr>`,
    )
    .join("")}</tbody></table></details>`;
}

function binTable(): string {
  const result = current();
  if (!result) return "";
  return `<details class="data-table" id="bin-table"><summary>View accessible bin table</summary><div class="table-scroll"><table><thead><tr><th>Bin</th><th>Count</th><th>Confidence</th><th>Accuracy</th><th>ECE contribution</th></tr></thead><tbody>${result.bins.map((b, i) => `<tr><td><button class="text-button" data-bin="${i}" data-series="${after ? "after" : "before"}" ${!b.count ? "disabled" : ""}>${i + 1}</button></td><td>${b.count}</td><td>${b.count ? percent(b.confidence) : "No observations"}</td><td>${percent(b.accuracy)}</td><td>${decimal(b.contribution)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function workspace(): string {
  if (!dataset)
    return `<section id="workspace" class="empty"><h2>Load predictions for analysis</h2><p>Open a confidence CSV or logit JSON file to begin, or load the reproducible UCI reference.</p><button class="primary" data-action="import">Import predictions</button></section>`;
  const active = current();
  const risk = active ? getRisk(active.predictions, threshold) : null;
  const groups = [
    ...new Set(dataset.rows.flatMap((row) => (row.group ? [row.group] : []))),
  ].sort();
  const names = Object.keys(splitNames) as Split[];
  return `<section id="workspace" aria-label="Prediction assessment"><div class="dataset-bar"><div><p class="eyebrow">${reference ? "UCI digits reference" : learning ? "Synthetic example" : "Your predictions"}</p><h2 id="assessment-title" tabindex="-1">${h(dataset.name)}</h2><p>${dataset.rows.length.toLocaleString()} observations · ${dataset.kind === "logits" ? `${dataset.classes?.length ?? dataset.rows[0]?.logits?.length} classes · logits` : "confidence and correctness"} </p></div><button class="secondary" data-action="import">Change input file</button></div>
    <div class="workflow-tabs" role="tablist" aria-label="Analysis workflow">${workspaceViews.map((view) => `<button id="tab-${view}" role="tab" data-workspace-tab="${view}" aria-controls="panel-${view}" aria-selected="${workspaceView === view}" tabindex="${workspaceView === view ? "0" : "-1"}">${viewNames[view]}</button>`).join("")}</div><div class="split-bar"><div class="split-tabs" role="group" aria-label="Observation split">${names
      .filter((s) => count(s) > 0)
      .map(
        (s) =>
          `<button data-split="${s}" aria-pressed="${split === s}" ${busy ? "disabled" : ""}>${splitNames[s]} <span>${count(s).toLocaleString()}</span>${s === "test" && !policy.testViewed ? ' <span aria-label="Results not yet inspected">◇</span>' : ""}</button>`,
      )
      .join(
        "",
      )}</div>${groups.length ? `<label>Slice<select id="group" ${busy ? "disabled" : ""}><option value="">All observations</option>${groups.map((g) => `<option value="${h(g)}" ${group === g ? "selected" : ""}>${h(g)}</option>`).join("")}</select></label>` : ""}<span class="status-chip ${policy.changedAfterTest ? "caution" : ""}">${h(status())}</span></div><details class="inline-help split-help" id="split-help"><summary>About this split</summary><p>${h(splitDescription(split))}</p></details>
    <div class="workflow-panel" ${panelAttributes("inspect")}>${learning ? `<details class="example-settings" id="example-settings"><summary>Example settings</summary><div id="learning-panel">${learningPanel(learning, conditional, referenceError, referenceBusy)}</div></details>` : ""}<div class="assessment-grid"><div class="measurement-panel"><div class="section-heading"><div><h2>Reliability diagram</h2></div><span class="eyebrow">${splitNames[split]} · ${active?.n ?? "…"} rows</span></div>${metrics()}
      <div class="chart-settings"><label>Bins<select id="bins" ${busy ? "disabled" : ""}>${[1, 5, 10, 15, 30].map((n) => `<option value="${n}" ${bins === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Binning<select id="strategy" ${busy ? "disabled" : ""}><option value="equal-width" ${strategy === "equal-width" ? "selected" : ""}>Equal width</option><option value="equal-mass" ${strategy === "equal-mass" ? "selected" : ""}>Equal mass</option></select></label><span class="legend"><span class="before-key">● Original</span>${after ? '<span class="after-key">◆ After scaling</span>' : ""}</span></div>
      <div id="chart">${before ? reliabilitySvg(before.bins, after?.bins ?? null, selected, selectedSeries) : '<div class="skeleton">Preparing the reliability diagram…</div>'}</div><p class="chart-hint">Select a point to inspect its bin.</p><details class="inline-help" id="chart-guide"><summary>How to read this chart</summary><p>Each point groups predictions with similar confidence. The diagonal marks equal confidence and accuracy. Points below it have lower observed accuracy than confidence; points above it have higher observed accuracy.</p>${metricGuide()}</details>${binTable()}
    </div><aside class="bin-panel" id="bin-detail" aria-live="polite">${binDetail()}</aside></div>
    <details class="interpretation" id="result-notes"><summary>Result interpretation and limits</summary><div>${
      before
        ? interpretation(before, after)
            .map((line) => `<p>${h(line)}</p>`)
            .join("")
        : ""
    }<p class="muted">${active && active.n < 100 ? "Small sample: fewer than 100 observations. " : ""}A low ECE is not proof of calibration. The bins and sample size matter.</p></div></details></div>
    <div class="workflow-panel" ${panelAttributes("calibrate")}><section class="recalibration section-card" id="recalibrate"><div class="section-heading"><div><h2>Temperature scaling</h2></div><span class="tag">p = softmax(logits / T)</span></div><div class="recalibration-grid"><div><p>Fit one temperature using the <strong>calibration split only</strong>. Compare the original and scaled predictions on another split.</p><details class="inline-help" id="temperature-help"><summary>How temperature scaling works</summary><p class="muted">Scaling divides every class logit by T before softmax. T > 1 softens the probabilities; T < 1 sharpens them. The fit minimises calibration NLL. Predicted classes stay unchanged, and results on another split can improve or worsen. Group slices change the comparison, not the calibration rows used to fit.</p></details><button class="primary" data-action="fit" ${busy || dataset.kind !== "logits" || !count("calibration") ? "disabled" : ""}>${fit ? "Refit temperature" : "Fit on calibration data"}</button>${fit || fitAttempt ? `<button class="text-button" data-action="reset-fit">${fit ? "Use original probabilities" : "Dismiss fit result"}</button>` : ""}${dataset.kind !== "logits" ? '<p class="input-note">This file contains confidence values. Temperature scaling requires full logits and class labels.</p>' : !count("calibration") ? '<p class="input-note">Add a separate calibration split to enable fitting.</p>' : ""}</div><div class="fit-result" aria-live="polite">${fitSummary()}${evaluationFailure ? `<p class="warning" role="alert">${h(evaluationFailure)}</p>` : ""}</div></div>${comparison()}</section></div>
    <div class="workflow-panel" ${panelAttributes("decide")}><section class="section-card" id="decisions"><div class="section-heading"><div><h2>Confidence threshold</h2></div><span class="tag">Confidence ≥ threshold</span></div><div class="decision-grid"><div><label class="threshold-label" for="threshold">Accept confidence at or above <output id="threshold-output">${percent(threshold, 0)}</output></label><input type="range" id="threshold" min="0" max="100" step="1" value="${Math.round(threshold * 100)}" ${busy ? "disabled" : ""}/><div class="risk-numbers" id="risk-numbers">${risk ? riskNumbers(risk) : ""}</div><details class="inline-help" id="threshold-help"><summary>Coverage and error rate explained</summary><p class="muted">Coverage is the fraction of observations accepted. Error rate is the fraction of accepted predictions that are wrong. Equal-confidence rows move together; an empty accepted set has no estimated error rate.</p></details>${count("test") ? `<div class="policy-lock"><button class="secondary" data-action="lock" ${busy || !before || !!evaluationFailure || split !== "policy_validation" || !!group ? "disabled" : ""}>${policy.locked ? "Update locked policy" : "Lock policy before test review"}</button><p>${policy.locked ? `Locked at ${percent(policy.locked.threshold, 0)}, T = ${decimal(policy.locked.temperature, 4)}.` : "Choose a threshold on policy validation, then lock it before opening test results."}</p>${policy.changedAfterTest ? '<p class="warning">Test results have already informed this session. Relocking does not restore an untouched-test claim.</p>' : ""}</div>` : ""}</div><div id="risk-chart">${risk ? riskSvg(curve, risk) : ""}</div></div></section></div>
    <div class="workflow-panel" ${panelAttributes("export")}><section class="export-section" id="export"><div><h2>Export assessment</h2><p>${h(splitNames[split])} · ${active?.n.toLocaleString() ?? 0} observations${group ? ` · ${h(group)}` : ""}</p><label class="check"><input type="checkbox" id="include-rows" ${includeRows ? "checked" : ""}/> Include all splits and supplied provenance in exports</label><p class="muted small">Includes test results if enabled. CSV always contains rows from the selected split.</p><details class="inline-help" id="export-help"><summary>What each export includes</summary><p>HTML contains charts, measurements, settings and limitations. JSON records results, fit details and the input hash. Optional source data includes all splits and supplied provenance, and counts as test inspection.</p><p>Prediction CSV contains original and scaled confidence, correctness and row IDs for this selection. Formula-like IDs receive a leading apostrophe for spreadsheet safety.</p></details></div><div class="export-actions"><button class="primary" data-action="report" ${!before || busy ? "disabled" : ""}>Download HTML report</button><button class="secondary" data-action="record" ${!before || busy ? "disabled" : ""}>Experiment JSON</button><button class="secondary" data-action="predictions" ${!before || busy ? "disabled" : ""}>Prediction CSV</button><button class="text-button" data-action="share">Copy configuration link</button></div></section>
    <details class="methods" id="methods"><summary>Methods, provenance, and limits</summary><div class="method-columns"><div><h3>What is measured</h3><p>ECE weights each bin’s absolute confidence–accuracy gap by its share of observations. Empty bins do not represent observed zero accuracy. NLL uses all class logits and the true label, in nats per observation.</p><p>Temperature is fitted on calibration rows only. Threshold exploration uses the selected split. Reports describe session behaviour, not whether you previously inspected these observations elsewhere.</p><p>Positive temperature preserves class ordering within a prediction. It can change confidence ranking across predictions, so acceptance outcomes must be measured directly.</p></div><div><h3>Local processing</h3><p>Files are read locally. This application sends no imported predictions to a server, uses no analytics, and keeps no raw files in browser storage. Opening this hosted page still creates ordinary hosting requests.</p><p>Input limits: 5 MiB, 20,000 rows, 100 classes, and 1,000,000 logit values. These are input limits, not a performance guarantee.</p><p>Only test-inspection markers are retained for this browser session: input fingerprints and the settings identifying reused synthetic outcomes. Config links contain no imported observations.</p></div></div><h3>Source record</h3><pre>SHA-256 ${h(hash)}
${h(JSON.stringify(dataset.provenance, null, 2))}</pre><p class="small">Numerics: @m-sanchez/calibrated ${numericalVersion}. <a href="https://github.com/m-sanchez/calibrated/tree/${numericalRevision}" target="_blank" rel="noopener noreferrer">Numerical source</a> · <a href="https://proceedings.mlr.press/v70/guo17a.html" target="_blank" rel="noopener noreferrer">Temperature scaling reference</a></p></details></div>
  </section>`;
}

function riskNumbers(risk: ReturnType<typeof getRisk>): string {
  return `<div><strong>${risk.accepted.toLocaleString()}</strong><span>accepted</span></div><div><strong>${risk.abstained.toLocaleString()}</strong><span>abstained</span></div><div><strong>${risk.errors.toLocaleString()}</strong><span>accepted mistakes</span></div><div><strong>${percent(risk.risk)}</strong><span>observed error</span></div>`;
}

function modal(): string {
  if (!importOpen) return "";
  return `<div class="modal-shade"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><button class="close" data-action="close-import" aria-label="Close import">×</button><p class="eyebrow">Local file analysis</p><h2 id="import-title">Import prediction file</h2><p>Your file is processed in this browser. Choose a confidence CSV or a logit JSON file.</p><label class="drop-zone" id="drop-zone"><input type="file" id="prediction-file" accept=".csv,.json,text/csv,application/json"/><strong>Choose a file or drop it here</strong><span>CSV or JSON · up to 5 MiB</span></label><div class="template-links"><a href="${import.meta.env.BASE_URL}templates/confidence.csv" download>Confidence CSV template</a><a href="${import.meta.env.BASE_URL}templates/logits.json" download>Logit JSON template</a></div>${error ? `<p class="error" role="alert">${h(error)}</p>` : ""}${
    pending
      ? `<div class="import-preview"><h3>Ready to analyse</h3><p>${h(pending.filename)} · ${pending.dataset.rows.length.toLocaleString()} valid rows · ${pending.dataset.kind}</p><div class="preview-counts">${(
          Object.keys(splitNames) as Split[]
        )
          .map((s) => {
            const n = pending!.dataset.rows.filter((r) => r.split === s).length;
            return n ? `<span>${splitNames[s]} <b>${n}</b></span>` : "";
          })
          .join(
            "",
          )}</div><div class="table-scroll"><table><thead><tr><th>ID</th><th>Split</th><th>${pending.dataset.kind === "logits" ? "Label" : "Correct"}</th></tr></thead><tbody>${pending.dataset.rows
          .slice(0, 5)
          .map(
            (r) =>
              `<tr><td>${h(r.id)}</td><td>${h(r.split)}</td><td>${r.split === "test" ? "Hidden until test review" : h(r.label ?? r.correct)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><button class="primary" data-action="confirm-import">Analyse this file</button></div>`
      : '<p class="small muted">CSV: id, confidence, correct. JSON: id, logits, label, split. Optional group and CSV split fields support explicit comparisons.</p>'
  }</section></div>`;
}

function render(): void {
  const focus = (document.activeElement as HTMLElement)?.id;
  if (focus) pendingFocus = focus;
  const openDetails = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details[id][open]"),
  ).map((el) => el.id);
  const selection =
    document.activeElement instanceof HTMLInputElement
      ? document.activeElement.selectionStart
      : null;
  app.innerHTML = `<header class="topbar" ${importOpen ? "inert" : ""}><div class="topbar-inner"><a class="brand" href="https://miguelsanchez.co.uk" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12L18 6M6 12L18 18" stroke="var(--accent)" stroke-width="2.25" stroke-linecap="round"/><circle cx="6" cy="12" r="2.8" fill="var(--accent)"/><circle cx="18" cy="6" r="2.8" fill="var(--accent)"/><circle cx="18" cy="18" r="2.35" fill="var(--bg)" stroke="var(--accent)" stroke-width="1.7"/></svg><span><span class="brand-first">Miguel</span> <strong>Sánchez</strong></span></a><nav aria-label="Page navigation"><a href="#workspace">Assessment</a><a href="#usage-guide" data-action="guide">How to use</a><a href="https://github.com/m-sanchez/calibrated" target="_blank" rel="noopener noreferrer">Numerical library</a></nav><span class="local-badge">Browser-based analysis</span></div></header>
    <main ${importOpen ? "inert" : ""}><section class="intro compact-intro" aria-labelledby="app-title"><div><h1 id="app-title">Calibration Explorer</h1><p class="intro-description">Check whether your classifier’s confidence matches how often it is correct. Upload saved predictions with known outcomes to measure calibration and export a report.</p></div><div class="intro-actions"><button class="primary" data-action="import">Import predictions</button><button class="secondary" data-action="reference">Load digits example</button><span class="input-caption">CSV or JSON · Processed in your browser</span></div></section>
    <div class="reference-tools">${workflowGuide(import.meta.env.BASE_URL)}<details class="learning-disclosure" id="learning-examples"><summary>Try a controlled example</summary>${learningChooser()}</details></div>${error && !importOpen ? `<div class="error" role="alert">${h(error)}</div>` : ""}${busy ? `<div class="busy" role="status"><span></span>${h(busy)}…</div>` : ""}${workspace()}
    <footer><p><a href="https://miguelsanchez.co.uk" target="_blank" rel="noopener noreferrer">Miguel Sánchez Durán</a></p><p><a href="${import.meta.env.BASE_URL}LICENSE.txt" target="_blank" rel="noopener noreferrer">MIT license</a><a href="https://github.com/m-sanchez/calibration-explorer" target="_blank" rel="noopener noreferrer">Source</a><span>Version ${appVersion}</span></p></footer></main>${modal()}${toast ? `<div class="toast" role="status">${h(toast)}</div>` : ""}`;
  bind();
  openDetails.forEach((id) => {
    const element = document.getElementById(id);
    if (element instanceof HTMLDetailsElement) element.open = true;
  });
  if (pendingFocus) {
    const element = document.getElementById(pendingFocus);
    if (
      element &&
      !element.matches(":disabled") &&
      !element.closest("[inert], [hidden]")
    ) {
      element.focus({ preventScroll: true });
      pendingFocus = "";
    }
    if (
      selection !== null &&
      element instanceof HTMLInputElement &&
      element.type === "text"
    )
      element.setSelectionRange(selection, selection);
  }
}

async function readFile(file: File): Promise<void> {
  const epoch = ++importEpoch;
  error = "";
  pending = null;
  try {
    if (file.size > MAX_IMPORT_BYTES)
      throw new Error(
        "File exceeds the 5 MiB input limit. Export a smaller evaluation file.",
      );
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (epoch !== importEpoch || !importOpen) return;
    pending = {
      dataset: parseDataset(text, file.name),
      text,
      bytes,
      filename: file.name,
    };
  } catch (e) {
    if (epoch !== importEpoch) return;
    error = e instanceof Error ? e.message : String(e);
  }
  render();
}

function selectBin(element: Element): void {
  selected = Number(element.getAttribute("data-bin"));
  selectedSeries = element.getAttribute("data-series") ?? "before";
  const detail = document.querySelector("#bin-detail");
  if (detail) detail.innerHTML = binDetail();
  const chart = document.querySelector("#chart");
  if (chart && before) {
    chart.innerHTML = reliabilitySvg(
      before.bins,
      after?.bins ?? null,
      selected,
      selectedSeries,
    );
    bindBins(chart);
  }
}

function bindBins(scope: ParentNode = document): void {
  scope.querySelectorAll("[data-bin]").forEach((element) => {
    element.addEventListener("click", () => selectBin(element));
    element.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        selectBin(element);
        document
          .querySelector<HTMLElement>(
            `#chart [data-bin="${selected}"][data-series="${selectedSeries}"]`,
          )
          ?.focus();
      }
    });
  });
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = `Save ${name}`;
  const notice = document.createElement("div");
  notice.className = "toast export-ready";
  notice.setAttribute("role", "status");
  notice.append("Export prepared. ", a);
  document.querySelector(".export-ready")?.remove();
  app.append(notice);
  a.click();
  setTimeout(() => {
    notice.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

function exportRecord() {
  if (!dataset || !before)
    throw new Error("Complete an assessment before exporting.");
  if (busy)
    throw new Error(
      "Wait for the current assessment to finish before exporting.",
    );
  if (includeRows && count("test")) {
    policy = inspectTest(policy);
    rememberInspection();
    render();
  }
  return createAssessment({
    dataset,
    hash,
    before,
    after,
    bins,
    strategy,
    split,
    temperature: effectiveTemperature(),
    threshold,
    group: group || undefined,
    policy,
    status: status(),
    fit,
    fitAttempt,
    evaluationFailure,
    learning: learning
      ? {
          ...(dataset.provenance.learning as Record<string, unknown>),
          conditionalReference: conditional,
          conditionalReferenceStatus:
            learning.kind !== "sampling"
              ? "not-requested"
              : referenceBusy
                ? "pending"
                : referenceError
                  ? "failed"
                  : conditional
                    ? "complete"
                    : "pending",
          conditionalReferenceError: referenceError || null,
        }
      : null,
    includeRows,
    trustedReference: reference,
  });
}

async function action(name: string): Promise<void> {
  if (name === "guide") {
    const guide = document.querySelector<HTMLDetailsElement>("#usage-guide");
    if (guide) {
      guide.open = true;
      guide.scrollIntoView({ block: "start" });
      guide.querySelector("summary")?.focus({ preventScroll: true });
    }
  }
  if (name.startsWith("learn-")) {
    const kind = name.slice(6) as LearningKind;
    if (
      ["sampling", "binning", "temperature", "group-failure"].includes(kind)
    ) {
      bins = kind === "binning" ? 1 : 15;
      strategy = "equal-width";
      await loadLearning(kind);
    }
  }
  if (name === "redraw-learning" && learning)
    await loadLearning(learning.kind, {
      ...learning.options,
      redraw: learning.options.redraw + 1,
    });
  if (
    (name === "combine-bins" || name === "separate-bins") &&
    learning?.kind === "binning"
  ) {
    bins = name === "combine-bins" ? 1 : 10;
    strategy = "equal-width";
    selected = -1;
    calculate();
  }
  if (name === "learning-input" && learning && dataset) {
    if (count("test")) {
      policy = inspectTest(policy);
      rememberInspection();
      render();
    }
    download(
      "synthetic-predictions.json",
      JSON.stringify(dataset, null, 2),
      "application/json",
    );
  }
  if (name === "import") {
    modalOpener = (document.activeElement as HTMLElement)?.id ?? "";
    pendingFocus = "prediction-file";
    loadEpoch++;
    importEpoch++;
    importOpen = true;
    error = "";
    pending = null;
    if (!worker) busy = "";
    render();
    document.querySelector<HTMLInputElement>("#prediction-file")?.focus();
  }
  if (name === "close-import") {
    importEpoch++;
    importOpen = false;
    pending = null;
    error = "";
    render();
    pendingFocus = "";
    document.getElementById(modalOpener)?.focus({ preventScroll: true });
  }
  if (name === "confirm-import" && pending)
    await activate(
      pending.dataset,
      pending.text,
      false,
      ++loadEpoch,
      pending.bytes,
    );
  if (name === "reference") await loadReference();
  if (name === "fit") calculate("fit");
  if (name === "reset-fit") {
    fit = null;
    fitAttempt = null;
    policy = changePolicy(policy);
    calculate();
  }
  if (name === "lock") {
    if (
      split !== "policy_validation" ||
      group ||
      busy ||
      !before ||
      evaluationFailure
    )
      return;
    policy = lockPolicy(policy, effectiveTemperature(), threshold);
    notify(
      policy.changedAfterTest
        ? "Policy recorded. Results remain exploratory after test inspection."
        : "Policy locked. Open the Test split to evaluate it.",
    );
  }
  if (name === "report")
    download(
      "calibration-assessment.html",
      reportHtml(exportRecord()),
      "text/html",
    );
  if (name === "record")
    download(
      "calibration-assessment.json",
      JSON.stringify(exportRecord(), null, 2),
      "application/json",
    );
  if (name === "predictions" && dataset && before)
    download(
      "assessed-predictions.csv",
      predictionCsv(dataset, before, after, split),
      "text/csv",
    );
  if (name === "share") {
    const url = new URL(location.origin + import.meta.env.BASE_URL);
    if (learning) setLearningSource(url.searchParams, learning);
    else url.searchParams.set("source", reference ? "optdigits-v1" : "import");
    url.searchParams.set("bins", String(bins));
    url.searchParams.set("strategy", strategy);
    try {
      await navigator.clipboard.writeText(url.href);
      notify(
        reference || learning
          ? "Example and chart configuration link copied. Fits and policy choices are not included."
          : "Configuration link copied. The recipient must supply their prediction file.",
      );
    } catch {
      notify(`Copy this configuration URL: ${url.href}`);
    }
  }
}

function bindActions(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>("[data-action]").forEach((el) =>
    el.addEventListener("click", (event) => {
      if (el.dataset.action === "guide") event.preventDefault();
      void action(el.dataset.action!).catch((e) => {
        error = String(e);
        render();
      });
    }),
  );
}
function bindLearningControls(scope: ParentNode, actions = true): void {
  if (actions) {
    scope
      .querySelectorAll<HTMLElement>("[data-action]")
      .forEach((el) => (el.id = `action-${el.dataset.action}-0`));
    bindActions(scope);
  }
  for (const [id, key] of [
    ["learning-n", "n"],
    ["learning-distortion", "distortion"],
  ] as const) {
    scope
      .querySelector<HTMLSelectElement>(`#${id}`)
      ?.addEventListener("change", (event) => {
        if (learning)
          void loadLearning(learning.kind, {
            ...learning.options,
            [key]: Number((event.target as HTMLSelectElement).value),
          });
      });
  }
}
function bind(): void {
  document.querySelectorAll<HTMLDetailsElement>("details[id]").forEach((details) => {
    const summary = details.querySelector<HTMLElement>(":scope > summary");
    if (summary && !summary.id) summary.id = `${details.id}-summary`;
  });
  document.querySelectorAll<HTMLDetailsElement>(".metric-help").forEach((help) => {
    help.addEventListener("toggle", () => {
      if (help.open) {
        document.querySelectorAll<HTMLDetailsElement>(".metric-help[open]").forEach((other) => {
          if (other !== help) other.open = false;
        });
      }
    });
    help.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      help.open = false;
      help.querySelector("summary")?.focus();
    });
  });
  const occurrences = new Map<string, number>();
  document
    .querySelectorAll<HTMLElement>("[data-action],[data-split]")
    .forEach((el) => {
      const key = el.dataset.action
        ? `action-${el.dataset.action}`
        : `split-${el.dataset.split}`;
      const n = occurrences.get(key) ?? 0;
      occurrences.set(key, n + 1);
      el.id = `${key}-${n}`;
    });
  document.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setWorkspaceView(tab.dataset.workspaceTab as WorkspaceView));
    tab.addEventListener("keydown", (event) => {
      const index = workspaceViews.indexOf(tab.dataset.workspaceTab as WorkspaceView);
      const next = event.key === "ArrowRight" ? (index + 1) % workspaceViews.length
        : event.key === "ArrowLeft" ? (index + workspaceViews.length - 1) % workspaceViews.length
        : event.key === "Home" ? 0 : event.key === "End" ? workspaceViews.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      setWorkspaceView(workspaceViews[next]);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => setWorkspaceView(button.dataset.viewLink as WorkspaceView));
  });
  bindActions(document);
  bindLearningControls(document, false);
  document.querySelectorAll<HTMLElement>("[data-split]").forEach((el) =>
    el.addEventListener("click", () => {
      const next = el.dataset.split as Split;
      if (next === "test" && !policy.testViewed && !policy.locked) {
        if (
          !window.confirm(
            "Test results have not been inspected in this session. Opening them without a locked policy makes this assessment exploratory. Open test results?",
          )
        )
          return;
      }
      split = next;
      if (split === "test") {
        policy = inspectTest(policy);
        rememberInspection();
      }
      selected = -1;
      calculate();
    }),
  );
  document
    .querySelector<HTMLSelectElement>("#bins")
    ?.addEventListener("change", (event) => {
      bins = Number((event.target as HTMLSelectElement).value);
      selected = -1;
      calculate();
    });
  document
    .querySelector<HTMLSelectElement>("#strategy")
    ?.addEventListener("change", (event) => {
      strategy = (event.target as HTMLSelectElement).value as Strategy;
      selected = -1;
      calculate();
    });
  document
    .querySelector<HTMLSelectElement>("#group")
    ?.addEventListener("change", (event) => {
      group = (event.target as HTMLSelectElement).value;
      selected = -1;
      calculate();
    });
  document
    .querySelector<HTMLInputElement>("#threshold")
    ?.addEventListener("input", (event) => {
      threshold = Number((event.target as HTMLInputElement).value) / 100;
      policy = changePolicy(policy);
      const risk = current()
        ? getRisk(current()!.predictions, threshold)
        : null;
      document.querySelector("#threshold-output")!.textContent = percent(
        threshold,
        0,
      );
      if (risk) {
        document.querySelector("#risk-numbers")!.innerHTML = riskNumbers(risk);
        document.querySelector("#risk-chart")!.innerHTML = riskSvg(curve, risk);
      }
    });
  document
    .querySelector<HTMLInputElement>("#threshold")
    ?.addEventListener("change", () => render());
  document
    .querySelector<HTMLInputElement>("#include-rows")
    ?.addEventListener("change", (event) => {
      includeRows = (event.target as HTMLInputElement).checked;
    });
  document
    .querySelector<HTMLInputElement>("#prediction-file")
    ?.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) void readFile(file);
    });
  const drop = document.querySelector("#drop-zone");
  drop?.addEventListener("dragover", (event) => event.preventDefault());
  drop?.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files[0];
    if (file) void readFile(file);
  });
  bindBins();
  const dialog = document.querySelector<HTMLElement>(".modal");
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      void action("close-import");
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,a[href],select",
      ),
    );
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
}

const sharedParams = new URL(location.href).searchParams;
const sharedBins = Number(sharedParams.get("bins"));
if ([1, 5, 10, 15, 30].includes(sharedBins)) bins = sharedBins;
const sharedStrategy = sharedParams.get("strategy");
if (sharedStrategy === "equal-width" || sharedStrategy === "equal-mass")
  strategy = sharedStrategy;
render();
const sharedLearning = parseLearningSource(sharedParams);
if (sharedLearning)
  void loadLearning(sharedLearning.kind, sharedLearning.options);
else if (sharedParams.get("source") !== "import") void loadReference();
