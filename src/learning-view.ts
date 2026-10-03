import { decimal, escapeHtml as h } from "./charts.ts";
import { normalizeLearningOptions } from "./learning.ts";
import type {
  ConditionalReference,
  LearningKind,
  LearningOptions,
} from "./learning.ts";

export interface LearningState {
  kind: LearningKind;
  options: LearningOptions;
}

const examples: Array<{ kind: LearningKind; title: string; summary: string }> =
  [
    {
      kind: "sampling",
      title: "Sampling noise",
      summary: "Calibrated predictions can still show a gap.",
    },
    {
      kind: "binning",
      title: "Binning choices",
      summary: "One bin can hide opposing errors.",
    },
    {
      kind: "temperature",
      title: "Temperature scaling",
      summary: "Fit a correction, then measure it elsewhere.",
    },
    {
      kind: "group-failure",
      title: "Different groups",
      summary: "One correction can leave different gaps.",
    },
  ];

export function learningChooser(): string {
  return `<section class="learning-chooser" aria-labelledby="learning-chooser-title"><div class="section-heading"><div><p class="eyebrow">Synthetic data</p><h2 id="learning-chooser-title">Controlled examples</h2></div></div><p>Each example uses generated observations with recorded settings. Load one to examine sampling variation, binning choices, or the assumptions behind temperature scaling.</p><div class="learning-choices">${examples.map(({ kind, title, summary }) => `<button type="button" class="secondary learning-choice" data-action="learn-${kind}"><strong>${h(title)}</strong><span>${h(summary)}</span></button>`).join("")}</div></section>`;
}

function referenceSummary(
  reference: ConditionalReference | null,
  referenceError: string,
  referenceBusy: boolean,
): string {
  if (referenceBusy)
    return '<div class="learning-reference" role="status">Calculating the conditional ECE reference…</div>';
  if (referenceError)
    return `<div class="learning-reference"><p class="error" role="alert">${h(referenceError)}</p></div>`;
  if (!reference)
    return '<div class="learning-reference"><p class="muted">The conditional ECE reference will appear when this assessment is ready.</p></div>';
  return `<div class="learning-reference" aria-live="polite"><p class="eyebrow">Conditional ECE reference · independent simulated outcomes</p><dl class="learning-reference-values"><div><dt>Median ECE</dt><dd>${decimal(reference.median)}</dd></div><div><dt>95th percentile ECE</dt><dd>${decimal(reference.p95)}</dd></div></dl><p>${h(reference.iterations)} simulations hold the ${h(reference.n)} confidence values fixed, using ${h(reference.bins)} ${h(reference.strategy)} bins and reference seed ${h(reference.seed)}.</p><p class="muted">These are reference quantiles under the stated assumptions. They are not pass/fail limits or a bias correction; falling below p95 does not establish calibration.</p></div>`;
}

export function learningPanel(
  state: LearningState,
  reference: ConditionalReference | null,
  referenceError: string,
  referenceBusy: boolean,
): string {
  const options = normalizeLearningOptions(state.options);
  const logitExample =
    state.kind === "temperature" || state.kind === "group-failure";
  const fixed = state.kind === "binning";
  const example = examples.find(({ kind }) => kind === state.kind);
  if (!example) throw new Error("Unknown learning example.");
  const descriptions: Record<LearningKind, string> = {
    sampling:
      "Each outcome is sampled with success probability equal to its confidence. Calibration holds in the generator, while a finite sample can have nonzero ECE. Increase the sample size or redraw outcomes; the confidence values stay fixed when outcomes are redrawn.",
    binning:
      "This fixed 20-row example has ten 60%-confidence predictions with eight correct and ten 90%-confidence predictions with seven correct. Combining them gives zero ECE; separating the two confidence levels gives ECE 0.20. The observations never change.",
    temperature:
      "Labels are sampled from the original class probabilities, then logits are multiplied by the selected distortion. Fit on calibration rows and compare on a separate split. The known correction belongs to this generator; a finite-sample fit need not recover it exactly.",
    "group-failure":
      "The two groups receive different positive distortions. One global temperature cannot exactly undo both. Fit on the calibration split, then inspect each group on another split; overall improvement does not guarantee improvement in every group.",
  };
  const distortionValues = [...new Set([1, 2.5, 4, options.distortion])].sort(
    (a, b) => a - b,
  );
  const controls = fixed
    ? '<div class="learning-controls"><button type="button" class="secondary" data-action="combine-bins">Combine into one bin</button><button type="button" class="secondary" data-action="separate-bins">Separate the confidence levels</button></div>'
    : `<div class="learning-controls chart-settings"><label>${logitExample ? "Rows per split" : "Observations"}<select id="learning-n">${[100, 500, 2000].map((n) => `<option value="${n}" ${n === options.n ? "selected" : ""}>${n.toLocaleString("en-US")}</option>`).join("")}</select></label>${logitExample ? `<label>Confidence distortion<select id="learning-distortion">${distortionValues.map((value) => `<option value="${value}" ${value === options.distortion ? "selected" : ""}>${h(value)}×</option>`).join("")}</select></label>` : ""}<button type="button" class="secondary" data-action="redraw-learning">Redraw outcomes</button></div>`;
  const oracle =
    state.kind === "temperature"
      ? `<p class="muted">Known generator correction: T = ${h(options.distortion)}. Calibration, policy validation and test each contain ${h(options.n)} separately generated rows.</p>`
      : state.kind === "group-failure"
        ? `<p class="muted">Known group corrections: T = ${decimal(options.distortion * 0.4, 2)} for mild distortion and T = ${decimal(options.distortion * 1.6, 2)} for strong distortion. Each split contains ${h(options.n)} rows.</p>`
        : "";
  const showReference =
    state.kind === "sampling" ||
    reference !== null ||
    !!referenceError ||
    referenceBusy;
  return `<section class="section-card learning-panel" aria-labelledby="learning-title"><div class="section-heading"><div><p class="eyebrow">Synthetic example · ${h(example.title)}</p><h2 id="learning-title">${h(example.title)}</h2></div><span class="tag">Controlled observations</span></div><p>${h(descriptions[state.kind])}</p>${controls}${oracle}<p class="small muted">${fixed ? "Fixed fixture · no random draws. " : ""}Recorded seed ${h(options.seed)} · redraw ${h(options.redraw)}.${fixed ? " These settings do not change this fixture." : " Changing the sample or distortion starts a new assessment."}</p>${showReference ? referenceSummary(reference, referenceError, referenceBusy) : ""}<button type="button" class="text-button" data-action="learning-input">Download this example’s input JSON</button></section>`;
}

function numericParameter(
  params: URLSearchParams,
  key: string,
): number | undefined {
  const value = params.get(key);
  if (
    value === null ||
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)
  )
    return undefined;
  return Number(value);
}

export function parseLearningSource(
  params: URLSearchParams,
): LearningState | null {
  const source = params.get("source");
  const example = examples.find(({ kind }) => source === `learn-v1-${kind}`);
  if (!example) return null;
  return {
    kind: example.kind,
    options: normalizeLearningOptions({
      n: numericParameter(params, "n") as LearningOptions["n"] | undefined,
      seed: numericParameter(params, "seed"),
      redraw: numericParameter(params, "redraw"),
      distortion: numericParameter(params, "distortion"),
    }),
  };
}

export function setLearningSource(
  params: URLSearchParams,
  state: LearningState,
): void {
  if (!examples.some(({ kind }) => kind === state.kind))
    throw new Error("Unknown learning example.");
  const options = normalizeLearningOptions(state.options);
  params.set("source", `learn-v1-${state.kind}`);
  for (const key of ["n", "seed", "redraw", "distortion"] as const) {
    params.set(key, String(options[key]));
  }
}
