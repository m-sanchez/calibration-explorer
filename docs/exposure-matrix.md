# Observation exposure matrix

The browser and local MCP use `AssessmentWorkflow` for the same policy and test-inspection transitions. Loading and validation can read file bytes internally; inspection here means exposing test outcomes through the analysis interface or an output.

| Browser action | MCP action | Test inspection |
| --- | --- | --- |
| Import preview with hidden test outcomes | `load_predictions`; new-run metadata resource | No |
| Calibration metrics and aggregate preview/report | `assess_predictions` calibration; `create_report`; report resource | No |
| Policy-validation metrics and aggregate preview/report | `assess_predictions` policy_validation; `create_report` | No |
| Confidence-only exploration and aggregate report | `assess_predictions` exploration; `create_report` | No |
| Selected non-test prediction CSV | `create_report` with selected-split CSV and client disclosure | No |
| Explicit test split/review choice | `review_test` with accepted client form | Yes |
| All-source JSON with explicit disclosure | `create_report` with `includeRows` and accepted client form | Yes |
| Cancelled test or all-source disclosure | Declined/cancelled client form | No new inspection |
| Threshold/fit change after test review | `set_policy` or `fit_temperature` after review | Remains exploratory; relocking does not erase history |
| Reload the same file in the existing history scope | Another handle for the same exact fingerprint | Preserves inspection |

`tests/exposure-matrix.test.ts` applies this matrix to the shared controller, assessment, CSV and immutable preview snapshot. It does not simulate DOM interactions. `tests/mcp.test.ts` separately exercises actual stdio tools and resources, including non-test reports while test remains unopened, raw-data accept/decline, test-only files, missing client elicitation, conflicting revisions and file boundaries. Browser rendering and the named interactive client require their own observed checks.

The browser retains inspection markers for its browser session. MCP retains them for its server process. These are separate histories, and neither establishes prior external access or independent observations. No independent human usability or assistive-technology validation is claimed.
