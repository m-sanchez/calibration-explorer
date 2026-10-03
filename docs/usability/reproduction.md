# Independent reproduction checklist

**Outsider status: pending.** These are instructions and maintainer-checked reference values, not a completed external replication. Use public data here. Own-data replay is optional and must stay private. A helper failure, missing download or inability to install is a finding to record, not a step to mark complete.

## Identify the build

Baseline verified on 3 October 2026:

| Item | Fixed reference |
| --- | --- |
| [Public app](https://huggingface.co/spaces/m-sanchez/calibration-explorer) | Version 0.1.0 |
| [App release source](https://github.com/m-sanchez/calibration-explorer/tree/164eece9b2ed3a038d8ae645088b0ab70e1c33db) | `164eece9b2ed3a038d8ae645088b0ab70e1c33db` |
| [Space payload manifest](https://huggingface.co/spaces/m-sanchez/calibration-explorer/resolve/ba916202731f6a3250ab22bac13c1230bc9c6a35/manifest.json) | Space revision `ba916202731f6a3250ab22bac13c1230bc9c6a35` |
| [Numerical source](https://github.com/m-sanchez/calibrated/tree/6e74b92dfc5c545a1cd926f96bd5bc44ae6c887b) | Version 2.0.1; exact Git dependency `6e74b92dfc5c545a1cd926f96bd5bc44ae6c887b` |
| Bundled input SHA-256 | `18f281567b4a749dabe3819a427d32d228b85a7226c7785c10a99d88cf0d46d7` |

GitHub main was `05fc84d86038907e07afc9f9b7fcbecd0a2bbb0e` when this protocol was written; that later change updates the README card. The live Space can change. Record its actual version and [current manifest](https://huggingface.co/spaces/m-sanchez/calibration-explorer/resolve/main/manifest.json); if its source differs, reproduce the pinned source locally and report that distinction. The checks below deliberately do not depend on an npm registry release.

## Run a fresh source checkout

Use Git, Node 24.9 or newer, npm and Python 3.11 or newer. Run one command at a time and stop on a nonzero exit. Record actual versions and install/build time; a slow network is not an app task failure. Commands work in PowerShell and a POSIX shell; use `python3` if that is your Python 3 command.

```sh
git clone https://github.com/m-sanchez/calibration-explorer.git calibration-reproduction
cd calibration-reproduction
git checkout --detach 164eece9b2ed3a038d8ae645088b0ab70e1c33db
git rev-parse HEAD
node --version
npm --version
python --version
npm ci
npm test
npm run build
node scripts/create-review-evidence.ts
python -m unittest discover -s tests -p test_apply_temperature.py
npm run preview -- --port 4173
```

Open http://127.0.0.1:4173. Keep that terminal running. Use a second terminal in the checkout for later commands. Installation builds the exact Git-pinned numerical dependency; no sibling checkout, user token, paid service or private data is required. Do not repair failures by replacing the dependency with whatever npm currently calls latest. Record the command and redacted error instead.

The baseline checkout predates this study folder. Save a copy of the protocol's `verify_reference.py` outside it before checking out, or obtain that file from the same study revision you recorded. Give its full path when running it below. The checker uses only Python's standard library and does not import app code.

## Reproduce the browser workflow

- [ ] In a fresh session, load the digits example. Confirm 2,945 rows: calibration 574, policy validation 574, test 1,797. The 2,675 model-fit rows are not bundled.
- [ ] Use policy validation, all observations, 15 equal-width bins. Fit on calibration data. Do not inspect test while deciding the policy.
- [ ] Keep the fixed illustrative threshold at 80%, lock it, then inspect test. If test was inspected earlier, preserve and report the exploratory status; do not reset it to suggest an untouched test.
- [ ] Confirm the table below. Accuracy remains unchanged; this particular fit has T<1 and sharpens confidence. It does not retrain the model or establish improvement on future data.
- [ ] On Export, leave optional raw inclusion off. Save HTML, experiment JSON and prediction CSV. Check the files exist on disk; open HTML, parse JSON and open CSV. Record any browser saving failure even if a notification says the file is ready.
- [ ] Compare their split, slice, temperature and metrics. Default HTML/JSON omit raw observations; the CSV contains the selected test rows and IDs. The three formats intentionally contain different detail.

| Reference value | Expected |
| --- | ---: |
| Fitted temperature | 0.7259783904070843 |
| Accuracy before and after | 0.9488035614913745 |
| Test NLL before / after | 0.17595188348336863 / 0.15752642621016594 |
| Test ECE before / after | 0.03654894805641917 / 0.01007905702195184 |
| Test accepted / abstained / accepted errors | 1,635 / 162 / 31 |
| Policy-validation accepted / abstained / errors | 529 / 45 / 2 |

Compare machine-readable values, allowing absolute difference 1e-6 for T and 1e-7 for baseline aggregate metrics; counts must match exactly. UI rounding is expected. ECE requires the stated binning. This demonstrates one fixed dataset and threshold, not general calibration or optimal policy selection.

## Replay and recompute outside the app

Create a private working directory outside Git if using anything except the public reference. For the bundled reference only:

```sh
python -c "from pathlib import Path; Path('.cache/reproduction').mkdir(parents=True, exist_ok=True)"
python scripts/apply_temperature.py review/digits-experiment.json public/examples/optdigits.json --split test --output .cache/reproduction/replayed.json
```

The helper refuses to overwrite an existing output; choose a fresh filename on a repeat run. It applies the saved T and verifies input bytes/class order. It does **not** refit, choose a policy, filter a group slice or prove split independence.

Run the study checker from its saved location (replace the first path):

```sh
python /path/to/verify_reference.py review/digits-experiment.json public/examples/optdigits.json --csv review/digits-predictions.csv --replay .cache/reproduction/replayed.json
```

Then run it again with the actual browser-downloaded JSON and CSV paths in place of the `review/` paths, using a replay generated from that browser JSON. This distinguishes generated evidence from verified browser exports. An independent standard-library calculation must match NLL, equal-width ECE, accuracy, threshold counts and each CSV/replay confidence within 1e-10. Expected output includes `"status": "passed"`; otherwise preserve the failure. Generated timestamps and app commit fields may differ when evidence is rerun, so whole report file hashes need not match.

This checks calculations at the fitted T independently of the JavaScript implementation. It does not independently optimise T. For that separate check, clone the [pinned numerical source](https://github.com/m-sanchez/calibrated/tree/6e74b92dfc5c545a1cd926f96bd5bc44ae6c887b), install its dependencies and the recorded NumPy/SciPy versions, then run `python validation/verify_scipy.py`. Rebuilding the original classifier is a further task documented in [data provenance](../../public/examples/README.txt), and is not required for this first usability round.

## Return a redacted result

- [ ] Record outsider identifier, date, browser/OS, actual Node/Python versions, app/Space/source revisions and whether any maintainer helped.
- [ ] Separate source build, generated reference, browser downloads, independent calculations and optional independent optimisation: passed / failed / not attempted for each.
- [ ] Include elapsed time, point of abandonment and exact redacted failure where relevant. Never attach private predictions, row IDs, reports or local usernames.
- [ ] State what was reproduced and what was not. Do not call a maintainer-assisted attempt unassisted or a single successful environment universal compatibility.
