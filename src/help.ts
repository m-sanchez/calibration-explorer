import { escapeHtml as h } from "./charts.ts";
import type { Split } from "./domain.ts";

export function workflowGuide(baseUrl: string): string {
  const base = /^(?:\/(?![\\/])|\.\.?\/)/u.test(baseUrl) ? baseUrl : "./";
  const prefix = h(base.endsWith("/") ? base : `${base}/`);
  return `<details id="usage-guide" class="usage-guide">
    <summary>Input format and workflow</summary>
    <details class="guide-section" id="guide-input-formats">
      <summary>Accepted input formats</summary>
      <p>Import saved predictions. This workbench does not train or run a classifier. These examples illustrate the format, not adequate evaluation data.</p>
      <div class="guide-grid">
      <div><h3>Confidence CSV</h3>
        <p>Required: unique <code>id</code>, predicted-class <code>confidence</code> from 0 to 1, and <code>correct</code> as true/false or 1/0. Optional: <code>split</code>, <code>group</code>. Missing split means exploration. Confidence alone cannot support temperature fitting or NLL.</p>
        <pre class="input-example"><code>id,confidence,correct,split
row-1,0.8,true,exploration</code></pre>
        <a href="${prefix}templates/confidence.csv" download>Download CSV template</a>
      </div>
      <div><h3>Logits JSON</h3>
        <p>Each row needs unique <code>id</code>, finite <code>logits</code> in consistent class order, zero-based true <code>label</code>, and explicit <code>split</code>; <code>group</code> is optional. Logits are unnormalized scores, not probabilities. Use an array or the template’s dataset object.</p>
        <pre class="input-example"><code>[{"id":"row-1","logits":[1,3],
  "label":1,"split":"calibration"}]</code></pre>
        <a href="${prefix}templates/logits.json" download>Download JSON template</a>
      </div>
      </div>
    </details>
    <details class="guide-section" id="guide-workflow">
      <summary>Fit, choose, lock, evaluate</summary>
      <ol class="guide-steps">
      <li><strong>Fit.</strong> With logits, estimate temperature using <code>calibration</code> rows only.</li>
      <li><strong>Choose.</strong> For a fixed-policy test evaluation, use separate <code>policy_validation</code> rows to choose an acceptance threshold.</li>
      <li><strong>Lock.</strong> Lock temperature and threshold on the full policy-validation partition before inspecting test results.</li>
      <li><strong>Evaluate.</strong> Open <code>test</code> to assess that fixed policy. Later changes make the session exploratory.</li>
      <li><strong>Export.</strong> Download the assessment and its settings. Raw observations are optional; aggregate reports can still contain sensitive information.</li>
      </ol>
      <p>With confidence-only data, skip fitting. Files without a policy-validation or test partition can still be inspected and exported as exploratory analyses.</p>
    </details>
    <details class="guide-section" id="guide-limitations">
      <summary>What the assessment cannot establish</summary>
      <p><code>exploration</code> is for unrestricted inspection. Group comparisons are exploratory. Split labels and session locks cannot verify independence, prior test use, or future performance. Keep related observations together when preparing partitions.</p>
    </details>
  </details>`;
}

export function metricHelp(kind: "accuracy" | "ece" | "nll" | "confidence"): string {
  const explanations = {
    accuracy: {
      label: "accuracy",
      text: "The fraction of correct predictions. Positive temperature preserves predicted classes, so accuracy stays fixed while confidence can change.",
    },
    ece: {
      label: "ECE",
      text: "The average absolute gap between accuracy and confidence across bins, weighted by each bin’s share of observations. It depends on sample size and binning; a small value does not establish calibration.",
    },
    nll: {
      label: "NLL",
      text: "The average negative log probability of the true class, measured in nats. Lower is better. This requires the full probability vector, available here from logits.",
    },
    confidence: {
      label: "mean confidence",
      text: "The mean probability assigned to the predicted class. It need not equal observed accuracy; higher confidence is not necessarily better.",
    },
  };
  const { label, text } = explanations[kind];
  return `<details id="metric-help-${kind}" class="metric-help"><summary class="help-trigger" aria-label="About ${h(label)}">?</summary><div class="help-content"><p>${h(text)}</p></div></details>`;
}

export function metricGuide(): string {
  return `<details id="metric-guide" class="metric-guide">
    <summary>How to read these measurements</summary>
    <div class="guide-grid">
      <p><strong>Accuracy</strong> is the fraction of correct predictions. Positive temperature preserves the predicted class, so accuracy stays fixed while confidence can change.</p>
      <p><strong>ECE</strong> = sum over bins of (bin count / total count) × |bin accuracy − mean bin confidence|. It depends on binning and sample size; a small value does not establish calibration.</p>
      <p><strong>NLL</strong> averages −log(probability of the true class), using the full probability vector. It is measured in nats; lower is better.</p>
      <p><strong>Equal-width</strong> bins divide confidence into fixed intervals. <strong>Equal-mass</strong> bins aim for similar counts; equal-confidence ties stay together, so counts may differ and fewer bins may result.</p>
    </div>
  </details>`;
}

export function splitDescription(split: Split): string {
  const descriptions: Record<Split, string> = {
    calibration:
      "Calibration rows estimate temperature; these are not held-out results for that fit.",
    policy_validation:
      "Use policy-validation rows to choose the acceptance threshold. When fitting temperature, fit on calibration rows first.",
    test: "Test rows assess the fixed policy; inspecting them before locking or changing the policy afterward makes the session exploratory.",
    exploration:
      "Exploration rows support unrestricted inspection without a held-out evaluation claim.",
  };
  return descriptions[split];
}
