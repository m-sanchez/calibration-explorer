import {
  escapeHtml as h,
  percent,
  decimal,
  reliabilitySvg,
  riskSvg,
} from "./charts.ts";
import { getRisk, riskCurve, type Dataset, type analyze } from "./domain.ts";
import type { PolicyState } from "./policy.ts";
import type { FitAttempt } from "./fit.ts";
import { appVersion, numericalVersion, numericalRevision } from "./version.ts";

export type Analysis = ReturnType<typeof analyze>;
export interface Assessment {
  schemaVersion: 1;
  generatedAt: string;
  software: {
    app: string;
    numericalLibrary: string;
    upstreamCommit: string;
    appSourceSha256: string | null;
    numericalDistributionSha256: string | null;
  };
  data: {
    name: string;
    kind: string;
    sha256: string;
    rowCount: number;
    splitCounts: Record<string, number>;
    classes?: string[];
    provenance: Record<string, unknown>;
  };
  configuration: {
    split: string;
    bins: number;
    strategy: string;
    temperature: number;
    threshold: number;
    group: string | null;
  };
  status: string;
  policy: PolicyState;
  fit: unknown;
  fitAttempt?: FitAttempt | null;
  learning?: Record<string, unknown> | null;
  evaluationFailure?: string | null;
  before: Omit<Analysis, "predictions">;
  after: Omit<Analysis, "predictions"> | null;
  decision: ReturnType<typeof getRisk>;
  riskCurve: ReturnType<typeof riskCurve>;
  interpretation: string[];
  limitations: string[];
  observations?: Dataset["rows"];
}

export function interpretation(
  before: Analysis,
  after: Analysis | null,
): string[] {
  const lines: string[] = [];
  if (!before.n) return ["No observations are available for this selection."];
  if (after && before.nll !== null && after.nll !== null) {
    const difference = after.nll - before.nll;
    lines.push(
      `Negative log-likelihood ${Math.abs(difference) < 1e-10 ? "was unchanged" : difference < 0 ? "decreased" : "increased"} from ${decimal(before.nll)} to ${decimal(after.nll)} on the selected split.`,
    );
    lines.push(
      `Accuracy ${before.accuracy === after.accuracy ? "was unchanged" : "changed"}: ${percent(before.accuracy)} before, ${percent(after.accuracy)} after.`,
    );
  } else {
    lines.push(
      `On ${before.n.toLocaleString("en-US")} observations, mean confidence is ${percent(before.meanConfidence)} and observed accuracy is ${percent(before.accuracy)}.`,
    );
  }
  lines.push(
    `Measured ECE is ${decimal((after ?? before).ece)}. This estimate depends on the sample and binning choices; it is not a deployment verdict.`,
  );
  return lines;
}

export async function fingerprint(
  source: string | ArrayBuffer,
): Promise<string> {
  const bytes =
    typeof source === "string" ? new TextEncoder().encode(source) : source;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createAssessment(input: {
  dataset: Dataset;
  hash: string;
  before: Analysis;
  after: Analysis | null;
  bins: number;
  strategy: string;
  split: string;
  temperature: number;
  threshold: number;
  group?: string;
  policy: PolicyState;
  status: string;
  fit: unknown;
  fitAttempt?: FitAttempt | null;
  learning?: Record<string, unknown> | null;
  evaluationFailure?: string | null;
  includeRows: boolean;
  trustedReference?: boolean;
}): Assessment {
  const { predictions: beforeRows, ...before } = input.before;
  const after = input.after
    ? (({ predictions, ...rest }) => rest)(input.after)
    : null;
  const predictions = (input.after ?? input.before).predictions;
  const splitCounts: Record<string, number> = {};
  input.dataset.rows.forEach(
    (row) => (splitCounts[row.split] = (splitCounts[row.split] ?? 0) + 1),
  );
  const limitations = [
    "This measures top-prediction confidence calibration, not all class probabilities or production safety.",
    "Split separation is checked within this file and this session. Previous external use, entity overlap and statistical independence are not established.",
    "ECE depends on binning and finite sample size. Better ECE does not guarantee a better acceptance policy or performance under distribution shift.",
    "The acceptance rule is confidence >= threshold. Tied confidences are accepted together; an empty accepted set has no estimated error rate.",
    "Group results and threshold exploration are descriptive. No correction for repeated comparisons is applied.",
    "The input fingerprint identifies exact file contents. Reproduction without observations requires the matching input file and the recorded software.",
    "Aggregate results are not anonymisation: small bins and groups can disclose individual outcomes. Review this report before sharing.",
    "Default risk-coverage exports use a fixed 0.01 threshold grid rather than every individual confidence value.",
  ];
  if (input.before.n < 100)
    limitations.push(
      "Fewer than 100 observations support this selection. Inspect counts before interpreting rates.",
    );
  if (input.dataset.kind === "confidence")
    limitations.push(
      "Confidence-only observations do not provide logits for multiclass temperature scaling or NLL.",
    );
  let provenance: Record<string, unknown> = {
    included: false,
    note: "User-supplied provenance is omitted by default. It remains in the matching source file.",
  };
  if (input.includeRows) provenance = input.dataset.provenance;
  else if (input.trustedReference) {
    provenance = { source: "Bundled UCI handwritten-digits reference" };
    for (const key of [
      "dataset",
      "datasetDoi",
      "datasetUrl",
      "datasetVersion",
      "license",
      "attribution",
      "modelRevision",
      "modelIdentifier",
      "preprocessing",
    ]) {
      const value = input.dataset.provenance[key];
      if (typeof value === "string" || typeof value === "number")
        provenance[key] = value;
    }
    for (const [section, keys] of Object.entries({
      model: ["id", "revision", "estimator", "logitDefinition"],
      preprocessing: ["dtype", "transform", "learnedTransforms"],
      generation: ["script", "scriptSha256", "command", "requirements"],
      splitMethod: [
        "name",
        "membershipSha256",
        "firstHoldoutSize",
        "secondHoldoutSize",
      ],
    })) {
      const source = input.dataset.provenance[section];
      if (source && typeof source === "object" && !Array.isArray(source)) {
        const values: Record<string, unknown> = {};
        for (const key of keys) {
          const value = (source as Record<string, unknown>)[key];
          if (["string", "number", "boolean"].includes(typeof value))
            values[key] = value;
        }
        provenance[section] = values;
      }
    }
  }
  const exportedCurve = input.includeRows
    ? riskCurve(predictions)
    : Array.from({ length: 101 }, (_, i) => {
        const threshold = 1 - i / 100;
        const { coverage, risk, accepted, errors } = getRisk(
          predictions,
          threshold,
        );
        return { threshold, coverage, risk, accepted, errors };
      });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    software: {
      app: `calibration-explorer/${appVersion}`,
      numericalLibrary: `@m-sanchez/calibrated/${numericalVersion}`,
      upstreamCommit: numericalRevision,
      appSourceSha256: import.meta.env?.VITE_APP_SOURCE_SHA256 ?? null,
      numericalDistributionSha256:
        import.meta.env?.VITE_NUMERICAL_DIST_SHA256 ?? null,
    },
    data: {
      name: input.dataset.name,
      kind: input.dataset.kind,
      sha256: input.hash,
      rowCount: input.dataset.rows.length,
      splitCounts,
      classes: input.dataset.classes,
      provenance,
    },
    configuration: {
      split: input.split,
      bins: input.bins,
      strategy: input.strategy,
      temperature: input.temperature,
      threshold: input.threshold,
      group: input.group ?? null,
    },
    status: input.status,
    policy: structuredClone(input.policy),
    fit: input.fit,
    fitAttempt: input.fitAttempt ?? null,
    learning: input.learning ?? null,
    evaluationFailure: input.evaluationFailure ?? null,
    before,
    after,
    decision: getRisk(predictions, input.threshold),
    riskCurve: exportedCurve,
    interpretation: [
      ...interpretation(input.before, input.after),
      ...(input.fitAttempt ? [input.fitAttempt.message] : []),
      ...(input.evaluationFailure ? [input.evaluationFailure] : []),
    ],
    limitations,
    ...(input.includeRows ? { observations: input.dataset.rows } : {}),
  };
}

export function reportHtml(record: Assessment): string {
  const b = record.before,
    a = record.after;
  const unavailable = record.evaluationFailure
    ? "Unavailable: scaled evaluation failed"
    : "Not fitted";
  const table = [
    ["Accuracy", percent(b.accuracy), a ? percent(a.accuracy) : unavailable],
    ["ECE", decimal(b.ece), a ? decimal(a.ece) : unavailable],
    [
      "NLL (nats / observation)",
      decimal(b.nll),
      a ? decimal(a.nll) : unavailable,
    ],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibration assessment · ${h(record.data.name)}</title><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{max-width:1000px;margin:48px auto;padding:0 28px;color:#403424;background:#fdfcfa;font:15px/1.6 system-ui,sans-serif}h1,h2{font-family:Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif;font-weight:500}h1{font-size:40px;line-height:1.15}h2{font-size:25px;margin-top:38px}.eyebrow{font-size:14px;color:#5b4c37}.status{padding:12px 16px;background:#f4f2ec;border-left:3px solid #f0ad3d}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:9px;text-align:left;border-bottom:1px solid #ded9d1}th{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f2ec;padding:18px;font-size:12px}svg{width:100%;height:auto;max-width:720px}.gridline{stroke:#e4dfd6;stroke-width:1}.tick,.axis-label{font-family:system-ui;fill:#6b5b42;font-size:12px}.ideal{stroke:#9c9487;stroke-dasharray:5 6}.ideal-label{fill:#6b5b42;font:11px system-ui}.before{fill:#5b4c37;stroke:#5b4c37}.after{fill:#9c4a2e;stroke:#9c4a2e}.gap-line{stroke-width:1;opacity:.35}.hit-area{fill:transparent;stroke:none}.risk-path{fill:none;stroke:#9c4a2e;stroke-width:2}.risk-active{fill:#9c4a2e;stroke:#fff;stroke-width:2}.key{display:flex;gap:20px;font-size:13px}.key span:first-child{color:#5b4c37}.key span:last-child{color:#9c4a2e}.foot{font-size:12px;color:#6b5b42;overflow-wrap:anywhere}li{margin:8px 0}@media print{body{margin:0;background:white}h2,table,svg{break-inside:avoid}pre{font-size:10px}}
  </style></head><body><p class="eyebrow">Calibration Explorer · Assessment record</p><h1>${h(record.data.name)}</h1><p class="status">${h(record.status)}</p><p>${h(b.n)} observations in <strong>${h(record.configuration.split)}</strong>${record.configuration.group ? ` · group ${h(record.configuration.group)}` : ""}. Generated ${h(record.generatedAt)}.</p>
  <h2>Findings</h2><ul>${record.interpretation.map((line) => `<li>${h(line)}</li>`).join("")}</ul>
  <table><thead><tr><th>Measurement</th><th>Original</th><th>After temperature scaling</th></tr></thead><tbody>${table.map((row) => `<tr>${row.map((cell) => `<td>${h(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <h2>Confidence and correctness</h2><p>${h(record.configuration.bins)} ${h(record.configuration.strategy)} bins. ECE is on a 0–1 scale; lower is not proof of calibration.</p><div class="key"><span>● Original</span>${a ? "<span>◆ After scaling</span>" : ""}</div>${reliabilitySvg(b.bins, a?.bins ?? null, -1, "before", false)}
  <table><thead><tr><th>Bin / series</th><th>Count</th><th>Confidence</th><th>Accuracy</th><th>ECE contribution</th></tr></thead><tbody>${[["Original", b], ...(a ? [["After", a]] : [])].flatMap(([name, result]) => (result as typeof b).bins.map((bin, i) => `<tr><td>${h(name)} ${i + 1}</td><td>${bin.count}</td><td>${bin.count ? percent(bin.confidence) : "No observations"}</td><td>${bin.count ? percent(bin.accuracy) : "Unavailable"}</td><td>${decimal(bin.contribution)}</td></tr>`)).join("")}</tbody></table>
  <h2>Acceptance at ${percent(record.configuration.threshold)}</h2><p>${record.decision.accepted} accepted · ${record.decision.abstained} abstained · ${record.decision.errors} accepted mistakes · ${percent(record.decision.risk)} observed error among accepted predictions.</p>${riskSvg(record.riskCurve, record.decision)}
  ${record.learning ? `<h2>Controlled example</h2><p>This is synthetic data. The generator, seeds, split sizes and any conditional calibration reference are recorded below. Reference quantiles describe simulated ECE under the recorded assumptions; they are not a pass/fail threshold or an amount to subtract from ECE.</p>` : ""}<h2>Configuration and provenance</h2><pre>${h(JSON.stringify({ data: record.data, configuration: record.configuration, policy: record.policy, fit: record.fit, fitAttempt: record.fitAttempt, learning: record.learning, evaluationFailure: record.evaluationFailure, software: record.software }, null, 2))}</pre>
  <h2>Limits of this assessment</h2><ul>${record.limitations.map((line) => `<li>${h(line)}</li>`).join("")}</ul><p class="foot">${record.observations ? "Observations are included in the companion JSON export." : "Raw observations and row identifiers are omitted from this report."} This HTML has no scripts, remote assets or telemetry.</p></body></html>`;
}

export function predictionCsv(
  dataset: Dataset,
  before: Analysis,
  after: Analysis | null,
  split: string,
): string {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = before.predictions.map((row, i) =>
    [
      row.id,
      split,
      row.confidence,
      after?.predictions[i].confidence ?? row.confidence,
      row.correct,
    ]
      .map(cell)
      .join(","),
  );
  return [
    "id,split,confidence_original,confidence_scaled,correct",
    ...rows,
  ].join("\r\n");
}
