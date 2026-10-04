# Version 0.2.0 client and browser evidence

Recorded on 4 October 2026. Independent human participants: zero. These were agent-operated checks on Windows with public reference data and synthetic fixtures. The [artifact manifest](release-0.2.0-evidence/artifact-hashes.json) records the exact copied bytes; captured reports were not regenerated or relabelled.

## Final local MCP client

Claude Code had updated from 2.1.283 to **2.1.289** before this final confidence-only check. It loaded the four-row [confidence template](../../public/templates/confidence.csv), assessed exploration, saved [HTML](release-0.2.0-evidence/claude-confidence.html) and [JSON](release-0.2.0-evidence/claude-confidence.json), and read the matching HTML resource. The record reports app 0.2.0, four observations, accuracy 0.5, NLL `null`, `testViewed: false`, and no source observations. No test-review permission was needed for this non-test report.

Its MCP/core source hash is `d4f43524e5b0a1e86c64745c1974cfff3676639d9e06b75bda10112f124fef9c`, matching the merged release source `b4d3107c008c9b39828254035d936764e58902f3`. The earlier digits run, including actual accept/decline controls, remains separately recorded under [Claude Code 2.1.283](mcp-audit.md).

## Local browser observations

The in-app Chromium browser opened the local 0.2.0 candidate at `http://127.0.0.1:4183/`. These observations precede the final static package build; they are not a deployed-host check.

| Action | Observed result |
| --- | --- |
| Fit the digits reference | Temperature 0.72598; 574 calibration rows. |
| Select scaled policy-validation bin 15 | Linked details changed to 487 rows, about 99.2% confidence and 100% accuracy. |
| Preview and download before test review | The downloaded [HTML report](release-0.2.0-evidence/browser-before-test.html) matched the iframe `srcdoc` byte for byte and retained `testViewed: false`. |
| Import the [test-only confidence fixture](release-0.2.0-evidence/browser-test-only-input.csv) | Preview hid correctness. Starting analysis showed the unopened-test choice without metrics or exports. |
| Explicitly inspect test results | Four rows and 50% accuracy appeared with the exploratory-after-test-inspection status. |
| Save assessment JSON and selected prediction CSV | [JSON](release-0.2.0-evidence/browser-test-only.json) retained `testViewed: true`, `changedAfterTest: true` and no source observations. [CSV](release-0.2.0-evidence/browser-test-only-predictions.csv) contained the four selected test rows. Both saved files were read back. |

The browser reports retain their embedded candidate source hash `55e4a9c8e8316f9b6fe6c6010cdb4ab17b6bb5938252df0e2ad3c5e64509fc7c`. The [released static manifest](https://github.com/m-sanchez/calibration-explorer/releases/download/v0.2.0/calibration-explorer-0.2.0-manifest.json) instead records the clean-build hash `9ce40339840b8e81d3c709af90b81d4e9c5108b53872625f0f932cfaebc0d05f`. Both are preserved as distinct evidence. The numerical distribution hash in these reports is unchanged at `3331be184fa4cb43dd85f42d2dc67abffb03d47b1bbf574c466e80758d057dd2`.

## Published Space payload

After publication, all **22 public files** under the Space's `resolve/main` endpoint returned HTTP 200 and matched the release payload byte counts and SHA-256 hashes. The API reported Space commit `6b7e39ed9b73e6d292e9df1510f96a04336ff0f7` and runtime stage `RUNNING`. The manifest hash was `5f995359962f0083d56d182f42b71892d433620fb7de43f589e93c08406ccd31`, identifying app source `b4d3107c008c9b39828254035d936764e58902f3`. [Per-file verification](release-0.2.0-evidence/hugging-face-verification.json) records the check time and results. This HTTP check does not execute the application.

## Released browser workflow

A separate tab then followed the reference workflow on the [published Space](https://huggingface.co/spaces/m-sanchez/calibration-explorer). Original policy-validation bin 15 selected 412 rows. Fitting used 574 calibration rows and returned T = 0.7259783904070843. The illustrative 80% policy accepted 529 policy-validation rows with two mistakes; it was locked before explicitly reviewing the 1,797 test rows. Test accuracy remained 94.9%, with displayed NLL 0.1760 to 0.1575 and ECE 0.0365 to 0.0101.

The actual [downloaded HTML](release-0.2.0-evidence/released-reference-assessment.html) matched the report preview byte for byte. It records the locked-before-test status and released browser source hash `9ce40339840b8e81d3c709af90b81d4e9c5108b53872625f0f932cfaebc0d05f`. This released-host observation is separate from the earlier local candidate checks above.

The [36-second silent step capture](../assets/reference-workflow-0.2.0/reference-workflow-step-by-step.webm) holds six actual screenshots sequentially, with [captions](../assets/reference-workflow-0.2.0/reference-workflow-step-by-step.vtt), [text](../assets/reference-workflow-0.2.0/reference-workflow-text.txt) and original PNGs linked from the [walkthrough](../reference-workflow.md). It is not a real-time recording. The [capture manifest](../assets/reference-workflow-0.2.0/manifest.json) records source/Space commits, captions, processing and screenshot hashes; [file hashes](../assets/reference-workflow-0.2.0/artifact-hashes.json) cover the copied media package. All 360 encoded frames decoded successfully, and the six step frames were compared with their source screenshots.

The [short reference walkthrough](../reference-workflow.md) provides a text alternative for following the workflow. These checks establish observed software behaviour for the stated cases, not independent user understanding, external adoption, or assistive-technology accessibility. The published v0.2.0 tag and release assets remain unchanged.
