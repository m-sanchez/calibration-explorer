---
title: Calibration Explorer
emoji: 🔬
colorFrom: yellow
colorTo: gray
sdk: static
license: mit
app_file: index.html
fullWidth: true
pinned: true
thumbnail: https://huggingface.co/spaces/m-sanchez/calibration-explorer/resolve/main/social-preview.png
short_description: Compare confidence with accuracy on your own predictions.
tags:
  - calibration
  - model-evaluation
  - uncertainty
  - data-visualization
---

# Calibration Explorer

Check whether your classifier’s confidence matches how often it is correct. Import saved predictions with known outcomes, inspect calibration, and preview or export an HTML report, assessment JSON, or prediction CSV.

[Website copy](https://miguelsanchez.co.uk/calibration-explorer/) · [Worked example](https://miguelsanchez.co.uk/writing/calibration-explorer-accuracy-and-confidence/) · [Source and reproduction instructions](https://github.com/m-sanchez/calibration-explorer) · [Numerical library](https://github.com/m-sanchez/calibrated)

Related Hub collection: [Evaluation tools and baselines](https://huggingface.co/collections/m-sanchez/evaluation-tools-and-baselines-6ac382227ea49323315592f1).

## Inputs and workflow

- CSV requires unique `id`, `confidence` from 0 to 1, and `correct` as true/false or 1/0. Optional fields are `split` and `group`; missing splits become `exploration`.
- Logit JSON requires unique `id`, finite class `logits`, zero-based true `label`, and explicit `split`; `group` is optional. Class order and vector length must agree across rows.
- **Inspect** confidence and accuracy, **Calibrate** temperature on calibration logits, **Decide** an acceptance threshold on separate policy-validation rows, then lock it before test inspection and **Export** the assessment.

The app evaluates saved predictions without training or running a classifier. Confidence-only files do not support temperature fitting or NLL. Four controlled examples illustrate sampling variation, binning, temperature scaling, and different group distortions.

Test-only files require an explicit inspection choice before showing outcomes. Report previews and downloads share the same snapshot. The [Python preparation recipes](https://github.com/m-sanchez/calibration-explorer/blob/main/docs/prediction-recipes.md) write the supported input formats from your existing predictions.

For a workflow inside your project, use the separate [local MCP server](https://github.com/m-sanchez/calibration-explorer/blob/main/docs/mcp.md). It reads selected local files and writes reports directly. Claude Code interactive terminal 2.1.283 is the verified client; the static Space does not connect to your filesystem. Returned MCP summaries can reach the client's model provider.

## Reference and limits

The bundled example uses a multinomial logistic-regression classifier and the [UCI Optical Recognition of Handwritten Digits dataset](https://doi.org/10.24432/C50P49). Its original training file supplies 2,675 model-fit, 574 calibration, and 574 policy-validation rows; all 1,797 original test rows are retained. [Provenance](examples/README.txt) documents source hashes, class order, coefficients, partitions, preprocessing, and reproduction. Training-derived partitions are not claimed to be writer-independent.

Temperature fitting minimises NLL on calibration rows only. Positive temperature preserves predicted classes; held-out NLL, ECE, and acceptance outcomes can improve or worsen. ECE depends on sample size and binning. Conditional reference quantiles from synthetic examples are not pass/fail thresholds or amounts to subtract from ECE. Session locks cannot prove prior test non-use, independence, or deployment readiness.

Input caps are 5 MiB, 20,000 rows, 100 classes, and 1,000,000 logits. They are not performance guarantees. Failed fits are recorded; if scaled evaluation fails, original results remain available and the failure is included in exports.

## Local processing

Imported predictions stay in the browser. The application has no analytics or remote inference calls; opening this hosted page still creates ordinary hosting requests. Raw inputs are not placed in configuration links or browser storage. Session storage retains test-inspection markers.

Default reports omit observation rows, row IDs, and arbitrary imported provenance. Reproducing a default assessment JSON requires its matching input. Raw inclusion is explicit and includes all splits. Prediction CSV contains selected row-level results. Aggregates and small groups are not anonymisation.

## Source and attribution

This Space serves prebuilt HTML, CSS, and JavaScript without a server or remote build step. The [GitHub repository](https://github.com/m-sanchez/calibration-explorer) contains source, tests, and reproduction instructions. [manifest.json](manifest.json) records packaged-file hashes, the application revision, and numerical version.

- Application: Copyright (c) 2026 Miguel Sánchez Durán, [MIT](LICENSE).
- Numerical library: `@m-sanchez/calibrated`, Copyright (c) 2026 Miguel Sanchez, [MIT](licenses/calibrated-MIT.txt).
- Fonts: Inter, Copyright (c) 2016 The Inter Project Authors; JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors. [Inter](fonts/Inter-OFL.txt) and [JetBrains Mono](fonts/JetBrainsMono-OFL.txt) use SIL Open Font License 1.1.
- Dataset: Alpaydin, E. & Kaynak, C. (1998), *Optical Recognition of Handwritten Digits*, UCI Machine Learning Repository, DOI 10.24432/C50P49, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Partitioning, scaled features, and classifier predictions are adaptations; source images are not bundled. [Attribution details](licenses/UCI-digits-CC-BY-4.0.txt).
- Method: [Guo et al., On Calibration of Modern Neural Networks](https://proceedings.mlr.press/v70/guo17a.html).
