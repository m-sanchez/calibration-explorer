import argparse
import hashlib
import io
import json
import platform
import sys
import time
import urllib.request
import warnings
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import scipy
import sklearn
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp, softmax
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from threadpoolctl import threadpool_limits


ROOT = Path(__file__).resolve().parents[1]
SOURCE_BASE = "https://archive.ics.uci.edu/ml/machine-learning-databases/optdigits/"
SOURCE_HASHES = {
    "optdigits.tra": "e1b683cc211604fe8fd8c4417e6a69f31380e0c61d4af22e93cc21e9257ffedd",
    "optdigits.tes": "6ebb3d2fee246a4e99363262ddf8a00a3c41bee6014c373ed9d9216ba7f651b8",
}
SPLIT_SEEDS = [20261002, 20261003]
MODEL_PARAMETERS = {
    "solver": "lbfgs",
    "C": 1.0,
    "tol": 1e-10,
    "max_iter": 2000,
    "fit_intercept": True,
    "random_state": 20261002,
}


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def load_source(name, cache):
    path = cache / name
    if not path.exists():
        request = urllib.request.Request(SOURCE_BASE + name, headers={"User-Agent": "CalibrationExplorer/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
        if digest(raw) != SOURCE_HASHES[name]:
            raise ValueError(f"Source checksum mismatch for {name}; no output was written.")
        path.write_bytes(raw)
    raw = path.read_bytes()
    if digest(raw) != SOURCE_HASHES[name]:
        raise ValueError(f"Cached source checksum mismatch for {name}.")
    data = np.loadtxt(io.BytesIO(raw), delimiter=",", dtype=np.int64)
    expected_rows = 3823 if name.endswith("tra") else 1797
    if data.shape != (expected_rows, 65):
        raise ValueError(f"Unexpected data shape for {name}: {data.shape}")
    if np.any(data[:, :64] < 0) or np.any(data[:, :64] > 16):
        raise ValueError(f"Invalid pixel values in {name}.")
    if not np.array_equal(np.unique(data[:, 64]), np.arange(10)):
        raise ValueError(f"Unexpected labels in {name}.")
    metadata = {
        "file": name,
        "url": SOURCE_BASE + name,
        "sha256": digest(raw),
        "bytes": len(raw),
        "rows": expected_rows,
        "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    }
    return data[:, :64], data[:, 64], metadata


def row_id(source, row):
    return f"{source}:{row + 1:04d}"


def duplicate_audit(partitions):
    by_content = defaultdict(list)
    for split, (source, indices, features, labels) in partitions.items():
        for row in indices:
            feature_hash = digest(features[row].astype("<i8").tobytes())
            by_content[feature_hash].append({"id": row_id(source, row), "split": split, "label": int(labels[row])})
    duplicate_groups = [
        {"featureSha256": key, "members": members}
        for key, members in by_content.items() if len(members) > 1
    ]
    duplicate_groups.sort(key=lambda group: group["featureSha256"])
    cross_split = [group for group in duplicate_groups if len({row["split"] for row in group["members"]}) > 1]
    conflicting = [group for group in duplicate_groups if len({row["label"] for row in group["members"]}) > 1]
    return {
        "method": "SHA-256 of each 64-feature vector encoded as little-endian int64; labels excluded from hash",
        "duplicateGroups": len(duplicate_groups),
        "crossSplitDuplicateGroups": len(cross_split),
        "conflictingLabelGroups": len(conflicting),
        "excludedRows": 0,
        "policy": "Original rows are retained; exact duplicates are disclosed. No rows are silently removed.",
        "groups": duplicate_groups,
    }


def nll(logits, labels, temperature=1.0):
    scaled = logits / temperature
    return float(np.mean(logsumexp(scaled, axis=1) - scaled[np.arange(len(labels)), labels]))


def metrics(logits, labels, temperature):
    probabilities = softmax(logits / temperature, axis=1)
    confidence = probabilities.max(axis=1)
    predicted = probabilities.argmax(axis=1)
    correct = predicted == labels
    bins = np.minimum((confidence * 15).astype(int), 14)
    ece = sum(
        np.count_nonzero(bins == index) / len(labels)
        * abs(float(confidence[bins == index].mean()) - float(correct[bins == index].mean()))
        for index in range(15) if np.any(bins == index)
    )
    return {"accuracy": float(correct.mean()), "ece15EqualWidth": float(ece), "nll": nll(logits, labels, temperature)}


def prepare(cache, output):
    started = time.perf_counter()
    cache.mkdir(parents=True, exist_ok=True)
    train_x, train_y, train_meta = load_source("optdigits.tra", cache)
    test_x, test_y, test_meta = load_source("optdigits.tes", cache)
    fit, remaining = train_test_split(
        np.arange(len(train_y)), test_size=1148, random_state=SPLIT_SEEDS[0], stratify=train_y,
    )
    calibration, policy = train_test_split(
        remaining, test_size=574, random_state=SPLIT_SEEDS[1], stratify=train_y[remaining],
    )
    partitions = {
        "model_fit": ("optdigits.tra", np.sort(fit), train_x, train_y),
        "calibration": ("optdigits.tra", np.sort(calibration), train_x, train_y),
        "policy_validation": ("optdigits.tra", np.sort(policy), train_x, train_y),
        "test": ("optdigits.tes", np.arange(len(test_y)), test_x, test_y),
    }
    if len(set(fit) | set(calibration) | set(policy)) != len(train_y):
        raise ValueError("Training-derived partition membership is not disjoint and complete.")
    audit = duplicate_audit(partitions)
    model = LogisticRegression(**MODEL_PARAMETERS)
    fit_started = time.perf_counter()
    with warnings.catch_warnings(), threadpool_limits(limits=1):
        warnings.simplefilter("error", ConvergenceWarning)
        model.fit(train_x[np.sort(fit)].astype(np.float64) / 16.0, train_y[np.sort(fit)])
    fit_seconds = time.perf_counter() - fit_started
    if not np.array_equal(model.classes_, np.arange(10)):
        raise ValueError("Fitted class order does not match the declared class mapping.")
    if np.any(model.n_iter_ >= MODEL_PARAMETERS["max_iter"]):
        raise ValueError("Model fitting reached the iteration limit.")
    weights = {"classes": model.classes_.tolist(), "coef": model.coef_.tolist(), "intercept": model.intercept_.tolist()}
    weights_hash = digest(canonical_bytes(weights))
    rows = []
    logits_by_split = {}
    labels_by_split = {}
    for split, (source, indices, features, labels) in partitions.items():
        if split == "model_fit":
            continue
        scaled = features[indices].astype(np.float64) / 16.0
        with threadpool_limits(limits=1):
            logits = model.decision_function(scaled)
            probabilities = model.predict_proba(scaled)
        np.testing.assert_allclose(softmax(logits, axis=1), probabilities, rtol=1e-12, atol=1e-14)
        if not np.isfinite(logits).all():
            raise ValueError("The model produced nonfinite logits.")
        logits_by_split[split] = logits
        labels_by_split[split] = labels[indices]
        rows.extend({"id": row_id(source, row), "logits": vector.tolist(), "label": int(labels[row]), "split": split}
                    for row, vector in zip(indices, logits))
    split_ids = {split: [row_id(source, row) for row in indices]
                 for split, (source, indices, _, _) in partitions.items()}
    provenance = {
        "dataset": "UCI Optical Recognition of Handwritten Digits",
        "datasetUrl": "https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits",
        "datasetDoi": "10.24432/C50P49",
        "datasetVersion": "Original optdigits.tra and optdigits.tes; identified by SHA-256 below",
        "attribution": "Alpaydin, E. & Kaynak, C. (1998). Optical Recognition of Handwritten Digits. UCI Machine Learning Repository.",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "changes": "Original training rows partitioned; pixel values divided by 16; trained-model logits exported; source images omitted.",
        "sources": [train_meta, test_meta],
        "model": {
            "id": "optdigits-logistic-regression-v1",
            "estimator": "sklearn.linear_model.LogisticRegression",
            "revision": "sha256:" + weights_hash,
            "parameters": MODEL_PARAMETERS,
            "iterations": model.n_iter_.tolist(),
            "weights": weights,
            "weightHashEncoding": "SHA-256 of UTF-8 JSON, sorted keys, compact separators, classes/coef/intercept fields",
            "logitDefinition": "decision_function scores; softmax probabilities; columns follow model.classes_",
        },
        "preprocessing": {"dtype": "float64", "transform": "64 original integer features divided by 16", "learnedTransforms": False},
        "classMapping": [{"index": index, "label": str(index)} for index in range(10)],
        "splitMethod": {
            "name": "Two deterministic stratified train_test_split calls within optdigits.tra; official optdigits.tes preserved",
            "seeds": SPLIT_SEEDS,
            "firstHoldoutSize": 1148,
            "secondHoldoutSize": 574,
            "rowIdConvention": "source filename followed by original one-based row number",
            "rowOrder": "original source row order within each split",
            "counts": {split: len(ids) for split, ids in split_ids.items()},
            "membershipSha256": digest(canonical_bytes(split_ids)),
            "modelFitRowIds": split_ids["model_fit"],
            "classCounts": {split: np.bincount(labels[indices], minlength=10).tolist()
                            for split, (_, indices, _, labels) in partitions.items()},
        },
        "duplicateAudit": audit,
        "generation": {
            "script": "scripts/prepare_digits.py",
            "scriptSha256": digest(Path(__file__).read_bytes()),
            "command": "python scripts/prepare_digits.py",
            "requirements": "scripts/requirements-reference.txt",
            "versions": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "scikit-learn": sklearn.__version__},
            "fitThreads": 1,
        },
        "limitations": [
            "The source documents different writers in the original training and test sets. Training-derived subsets have no per-row writer IDs and are not claimed to be writer-independent.",
            "This is a small historical benchmark and a linear baseline, not evidence about modern models or deployment safety.",
            "Exact feature duplicates are audited; absence of exact matches does not establish absence of related observations.",
            "Floating-point model coefficients can vary across libraries and machines; use the recorded artifact for exact replay.",
            "Hyperparameters and split seeds were fixed before metric inspection; this model is not selected for a favourable recalibration result.",
        ],
    }
    artifact = {"schemaVersion": 1, "name": "Handwritten digits · real classifier", "classes": [str(index) for index in range(10)],
                "provenance": provenance, "rows": rows}
    raw = canonical_bytes(artifact) + b"\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw)
    bounds = (float(np.log(0.05)), float(np.log(20.0)))
    result = minimize_scalar(lambda value: nll(logits_by_split["calibration"], labels_by_split["calibration"], float(np.exp(value))),
                             method="bounded", bounds=bounds, options={"xatol": 1e-12})
    candidates = [bounds[0], float(result.x), bounds[1]]
    best = min(candidates, key=lambda value: nll(logits_by_split["calibration"], labels_by_split["calibration"], float(np.exp(value))))
    temperature = float(np.exp(best))
    print(json.dumps({
        "output": str(output), "bytes": len(raw), "artifactSha256": digest(raw), "modelRevision": weights_hash,
        "rows": len(rows), "splitCounts": provenance["splitMethod"]["counts"],
        "fitSeconds": round(fit_seconds, 3), "totalSeconds": round(time.perf_counter() - started, 3),
        "duplicateAudit": {key: audit[key] for key in ("duplicateGroups", "crossSplitDuplicateGroups", "conflictingLabelGroups", "excludedRows")},
        "independentReference": {"temperature": temperature, "optimizerSuccess": bool(result.success),
                                 "boundaryOptimum": best in (bounds[0], bounds[1]),
                                 "testBefore": metrics(logits_by_split["test"], labels_by_split["test"], 1.0),
                                 "testAfter": metrics(logits_by_split["test"], labels_by_split["test"], temperature)},
    }, indent=2, allow_nan=False))


def main():
    parser = argparse.ArgumentParser(description="Regenerate the saved UCI optdigits prediction case study.")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache" / "optdigits")
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "examples" / "optdigits.json")
    args = parser.parse_args()
    prepare(args.cache, args.output)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Prediction generation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
