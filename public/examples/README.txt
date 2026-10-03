UCI Optical Recognition of Handwritten Digits

Attribution: Alpaydin, E. & Kaynak, C. (1998). Optical Recognition of Handwritten Digits. UCI Machine Learning Repository. https://doi.org/10.24432/C50P49
Dataset source: https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits
Dataset license: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/

This artifact contains predictions from a locally trained multinomial logistic regression baseline. It is not an existing Hugging Face model. The generation script fixes its hyperparameters and stratified partitions before inspecting evaluation metrics.

The 3,823 original training rows are divided into 2,675 model-fit rows, 574 calibration rows, and 574 policy-validation rows. All 1,797 original test rows are retained. Only calibration, policy-validation, and test predictions are included in rows. Original training membership, source hashes, preprocessing, model coefficients, class order, and software versions are recorded in provenance.

The 64 integer features are divided by 16. Ten decision-function logits correspond to digit labels 0 through 9 in that order. Softmax of those scores is checked against the trained estimator's predicted probabilities. The source images themselves are not bundled.

The source documents 30 writers contributing training data and 13 different writers contributing test data. It supplies no per-row writer IDs in these files. The training-derived subsets are not claimed to be writer-independent. Exact-content duplicate groups and any conflicting labels are disclosed in the artifact; no rows are silently removed. No exact-match audit can establish complete independence of related observations.

From the repository root, create a Python 3.11 environment, install scripts/requirements-reference.txt, and run:

python scripts/prepare_digits.py

The script downloads and validates the original files into the ignored .cache/optdigits directory. Subsequent runs reuse those files. It writes public/examples/optdigits.json and prints a separate SciPy reference assessment. The calibration partition alone fits temperature; the reference assessment does not choose an acceptance threshold. The original test set is never used for model or temperature fitting.

The source files are identified by SHA-256, not a fabricated dataset version. The model revision is the SHA-256 of the canonical classes/coefficients/intercepts JSON. Retrieval timestamps may differ after a fresh download, and floating-point coefficients can differ across platforms. The saved artifact permits exact replay; numerical reproduction across environments uses tolerances.

This small historical benchmark and linear model illustrate a workflow. They do not establish results for modern models or guarantee safe deployment. The example is retained whether recalibration helps or hurts. Exploration after viewing test results must not be described as an untouched final evaluation.
